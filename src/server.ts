import express = require('express');
import uuid = require('uuid');
import fs = require('fs');
import path = require('path');
import _ = require('lodash');

let app = express();

interface Game {
    id: string;
    status: 'created' | 'ready' | 'started' | 'finished'; // ready when 2+ players; started after first move
    createdAt: Date;
    playerIds: string[];
    moves: { timestamp: Date, move: string }[];
    events: string[]
}

const GAMES_DATA_LOCATION = path.join(__dirname, '../data/games.json'); // up, out of the build folder
const TIME_PER_MOVE = 30;
const END_STARTED_STALE_GAMES_AFTER_SECONDS = 60;
const END_CREATED_GAMES_AFTER_SECONDS = 60; // more?

function timeDiffSeconds(t1: Date, t2: Date) {
    return (t2.getTime() - t1.getTime()) / 1000;
}

class Games {
    games: Game[];

    constructor() {
        try {
            this.games = JSON.parse(fs.readFileSync(GAMES_DATA_LOCATION, 'utf-8')) as Game[]
        } catch (e) {
            console.error(e);
            console.warn('Could not load games state; initialzing an empty list.')
            this.games = []
        }
    }

    list() {
        return this.games;
    }

    create() {
        let id = uuid();
        let game: Game = { id, status: 'created', playerIds: [], createdAt: new Date(), moves: [], events:[] };
        game.events.push('Game created.');
        this.games.push(game)
        this.save();
        return id;
    }

    private findGame(gameId: string) {
        let game = _.find(this.games, (g) => g.id === gameId)
        if (!game) {
            throw new Error('Game not found');
        }
        return game;
    }

    getSecondsSinceCreated(gameId: string) {
        let game = this.findGame(gameId);
        return ((new Date()).getTime() - (new Date(game.createdAt)).getTime()) / 1000;
    }

    getSecondsSinceLastMove(gameId: string) {
        let game = this.findGame(gameId);
        if (!game.moves.length) {
            return null;
        }
        let lastMoveTimestamp = new Date(game.moves[game.moves.length - 1].timestamp);
        return ((new Date()).getTime() - lastMoveTimestamp.getTime()) / 1000;
    }

    private ensureGameNotStale(gameId: string) {
        let timeSinceLastMove = this.getSecondsSinceLastMove(gameId);
        if (!timeSinceLastMove) {
            // no move has been played, meaning game hasn't started, meaning it's not stale,
            // just waiting for first move.
            //
            // it'll be eventually killed after too much waiting.
            return;
        }
        if (timeSinceLastMove > TIME_PER_MOVE) {
            throw new Error('Too much time has passed since the last move; game will automatically end soon.')
        }
    }

    joinGame(gameId: string, playerId: string) {
        this.ensureGameNotStale(gameId);
        let game = this.findGame(gameId);
        if (game.playerIds.length === 4) {
            throw new Error('Game is full.');
        }
        game.playerIds.push(playerId);
        game.status = 'ready';
        game.events.push(`Player "${playerId}" joined game.`);
        this.save();
        return game;
    }

    makeMove(gameId: string, playerId: string, move: string) {
        this.ensureGameNotStale(gameId);
        let game = this.findGame(gameId);
        if (game.status === 'created') {
            throw new Error('Game is not ready yet.')
        }
        if (game.status === 'ready') game.status = 'started';
        game.moves.push({ timestamp: new Date(), move });
        game.events.push(`Player "${playerId}" played move "${move}".`);
        this.save();
        return game;
    }

    endGame(gameId: string, reason: string) {
        let game = this.findGame(gameId);
        game.status = 'finished';
        game.events.push(reason);
        this.save();
    }

    save() {
        fs.writeFileSync(GAMES_DATA_LOCATION, JSON.stringify(this.games))
    }
}

let games = new Games();

function getUserId(req: express.Request): string {
    let userId = req.query.userId;
    if (!userId) throw new Error("No used id provided")
    return userId as string;
}

function getGameId(req: express.Request): string {
    let gameId = req.params.gameId;
    if (!gameId) throw new Error('No game id provided');
    return gameId;
}

function getMove(req: express.Request): string {
    let move = req.params.move;
    if (!move) throw new Error('No move provided');
    return move;
}

app.get('/', (req, res) => {
    let userId = getUserId(req);
    res.end('User id: ' + userId);
});

app.get('/games', (_req, res) => {
    res.json(games.list())
})

app.get('/games/create', (_req, res) => {
    res.json(games.create())
})

app.get('/games/:gameId/join', (req, res) => {
    let userId = getUserId(req);
    let gameId = getGameId(req);
    let game = games.joinGame(gameId, userId);
    res.json(game);
})

app.get('/games/:gameId/move/:move', (req, res) => {
    let userId = getUserId(req);
    let gameId = getGameId(req);
    let move = getMove(req);
    let game = games.makeMove(gameId, userId, move);
    return res.json(game);
})

app.listen(8080)
console.log('http://localhost:8080')

setInterval(() => {
    games.games.forEach(game => {
        if (game.status === 'finished') {
            return; // ignore finished games
        }
        else if ((game.status === 'created' || game.status === 'ready') && games.getSecondsSinceCreated(game.id) > END_CREATED_GAMES_AFTER_SECONDS) {
            games.endGame(game.id, 'Automatically ended game because no one started it for too long.');
        }
         else if (game.status === 'started') {
            let timeSinceLastmove = games.getSecondsSinceLastMove(game.id)
            if (!timeSinceLastmove) {
                throw new Error('Game is started, but no moves have been played. This should never happen.')
            }
            if (timeSinceLastmove > END_STARTED_STALE_GAMES_AFTER_SECONDS) {
                games.endGame(game.id, 'Automatically ended game because it was stale.');
            }
        }
    })
}, 5 * 1000)