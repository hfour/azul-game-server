import express = require('express');
import uuid = require('uuid');
import fs = require('fs');
import path = require('path');
import _ = require('lodash');

let app = express();

interface Game {
    id: string;
    status: 'created' | 'ready' | 'started'; // ready when 2+ players; started after first move
    createdAt: Date;
    playerIds: string[];
    moves: { timestamp: Date, move: string }[];
    events: string[]
}

const GAMES_DATA_LOCATION = path.join(__dirname, '../data/games.json'); // up, out of the build folder
const TIME_PER_MOVE = 30;

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

    private getSecondsSinceLastMove(gameId: string) {
        let game = this.findGame(gameId);
        if (!game.moves.length) {
            return 0;
        }
        let lastMoveTimestamp = game.moves[game.moves.length - 1].timestamp;
        return ((new Date()).getTime() - lastMoveTimestamp.getTime()) / 1000;
    }

    private ensureGameNotStale(gameId: string) {
        if (this.getSecondsSinceLastMove(gameId) > TIME_PER_MOVE) {
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