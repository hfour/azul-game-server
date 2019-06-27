import express = require('express');
import uuid = require('uuid');
import fs = require('fs');
import path = require('path');
import _ = require('lodash');

let app = express();

interface Game {
    id: string;
    status: 'created';
    createdAt: Date;
    playerIds: string[];
    moves: string[];
}

const GAMES_DATA_LOCATION = path.join(__dirname, '../data/games.json'); // up, out of the build folder

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
        this.games.push({ id, status: 'created', playerIds: [], createdAt: new Date(), moves: [] })
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

    joinGame(gameId: string, playerId: string) {
        let game = this.findGame(gameId);
        game.playerIds.push(playerId);
        this.save();
        return game;
    }

    makeMove(gameId: string, playerId: string, move: string) {
        let game = this.findGame(gameId);
        game.moves.push(move);
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