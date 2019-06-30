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
const USERS_DATA_LOCATION = path.join(__dirname, '../data/users.json');
const TIME_PER_MOVE = 30;
const END_STARTED_STALE_GAMES_AFTER_SECONDS = 60;
const END_CREATED_GAMES_AFTER_SECONDS = 60; // more?

function timeDiffSeconds(t1: Date, t2: Date) {
    return (t2.getTime() - t1.getTime()) / 1000;
}

function now() {
    return new Date();
}

// Tile colors
const BLACK: TILE_COLOR = 'BLACK';
const AQUA: TILE_COLOR  = 'AQUA';
const BLUE: TILE_COLOR  = 'BLUE';
const YELLOW: TILE_COLOR  = 'YELLOW';
const RED: TILE_COLOR  = 'RED';

type TILE_COLOR = 'BLACK' | 'AQUA' | 'BLUE' | 'YELLOW' | 'RED';

interface AzulGameState {
    currentPlayerIndex: number;
    bag: string[]; // todo: change types to LINE_COLOR
    center: string[];
    factories: string[][];
    patternLines: string[][][];
    walls: boolean[][][];
    floorLines: [][];
}

interface GrabPlaceMove { from: number, color: TILE_COLOR, toLine: number;  }

class Azul {
    static wallOrdering = [
        [BLUE, YELLOW, RED, BLACK, AQUA],
        [AQUA, BLUE, YELLOW, RED, BLACK],
        [BLACK, AQUA, BLUE, YELLOW, RED],
        [RED, BLACK, AQUA, BLUE, YELLOW],
        [YELLOW, RED, BLACK, AQUA, BLUE]
    ]

    static newBoard(numPlayers: number): AzulGameState {
        let bag = Azul.newShuffledBag();
        let center: string[] = [];
        let factories: string[][] = [];
        let takeNFromBag = (n: number) => bag.splice(0, n); // destructive (has side-effects), be careful
        if (numPlayers === 2) {
            factories = _.times(5, () => takeNFromBag(4));
        } else if (numPlayers === 3) {
            factories = _.times(7, () => takeNFromBag(4));
        } else if (numPlayers === 4) {
            factories = _.times(9, () => takeNFromBag(4));
        } else {
            throw new Error('Number of players is not between 2 and 4; this should never happen.')
        }
        let patternLines: Array<string[][]> = []; // i know i know..
        _.times(numPlayers, () => {
            let linesForOnePlayer = [[], [], [], [], []]; // leftmost is the line with 1 tile; rightmost with 5
            patternLines.push(linesForOnePlayer);
        })
        let walls: Array<boolean[][]> = [];
        _.times(numPlayers, () => {
            walls.push([
                [false, false, false, false, false],
                [false, false, false, false, false],
                [false, false, false, false, false],
                [false, false, false, false, false],
                [false, false, false, false, false]
            ])
        })
        let floorLines: Array<[]> =_.times(numPlayers, () => [])
        return {
            currentPlayerIndex: 0, bag, center, factories, patternLines, walls, floorLines
        }
    }

    static newShuffledBag() {
        let bag: string[] = []
        _.times(20, () => {
            bag = bag.concat([BLACK, AQUA, BLUE, YELLOW, RED])
        })
        return _.shuffle(bag);
    }

    static parseMove(move: string): GrabPlaceMove {
        // examples:
        // "0_RED_3" means "from center, take all red, and put to line 4"
        // "2_BLACK_1" means "from second factory, pick all black, and put to line 2"
        let underscoresCount = (move.match(/_/g) || []).length;
        if (underscoresCount !== 2) {
            throw new Error(`Parsing move error: command should contain exactly 2 underscores, counted ${underscoresCount}.`);
        }
        let [from, color, toLine] = move.split('_');
        color = color.toUpperCase();
        let fromN = Number.parseInt(from, 10);
        let toLineN = Number.parseInt(toLine, 10);
        if (!_.range(0, 10).includes(fromN)) {
            throw new Error(`Parsing move error: from -> "${from}" is not a number between 0 and 9.`);
        }
        if (![BLACK, AQUA, BLUE, YELLOW, RED].includes(color as TILE_COLOR)) {
            throw new Error(`Parsing move error: color -> "${color}" is not one of ${BLACK}, ${AQUA}, ${BLUE}, ${YELLOW} or ${RED}.`);
        }
        if (!_.range(0, 5).includes(toLineN)) {
            throw new Error(`Parsing move error: toLine -> "${toLine}" is not a number between 0 and 4.`);
        }
        // todo: validate possible values for all three values
        return { from: fromN, color: color as TILE_COLOR, toLine: toLineN };
    }

    static createFromExistingBoard(board: AzulGameState): Azul {
        return new Azul(board);
    }

    static createFromNumPlayers(numPlayers: number): Azul {
        return new Azul(Azul.newBoard(numPlayers));
    }

    constructor(public state: AzulGameState) {}

    private encureCanPlaceOnPatternLine(lineIndex: number, color: TILE_COLOR, numOfTiles: number, ) {
        let playerIndex = this.state.currentPlayerIndex;
        let patternLineSize = lineIndex + 1;
        let line = this.state.patternLines[playerIndex][lineIndex]
        let numFreeSpaces = patternLineSize - line.length;
        if (numOfTiles > numFreeSpaces) {
            throw new Error("There isn't enough free space on the line.");
        }
        let lineIsEmpty = patternLineSize === numFreeSpaces;
        if (!lineIsEmpty && !_.includes(line, color)) {
            throw new Error('There is already a tile of different color in the line.')
        }
    }

    pickTiles(pileIndex: number, lineIndex: number, color: TILE_COLOR) {
        let pile: string[];
        let factoryIndex = pileIndex - 1;
        if (pileIndex === 0) {
            pile = _.clone(this.state.center);
        } else {
            pile = _.clone(this.state.factories[factoryIndex]);
        }
        if (!_.includes(pile, color)) {
            throw new Error(`The selected pile doesn't contain the color "${color}".`);
        }
        let pileAfterPick: string[] = []
        let pickedTiles: string[] = []
        pile.forEach(tile => {
            if (tile === color) pickedTiles.push(tile);
            else pileAfterPick.push(tile);
        })
        this.encureCanPlaceOnPatternLine(lineIndex, color, pickedTiles.length);
        // mutate center or factory
        if (pileIndex === 0) {
            this.state.center = pileAfterPick;
        } else {
            this.state.factories[factoryIndex] = pileAfterPick;
        }
        // mutate pattern line
        let line = _.clone(this.state.patternLines[this.state.currentPlayerIndex][lineIndex]);
        line = line.concat(pickedTiles);
        this.state.patternLines[this.state.currentPlayerIndex][lineIndex] = line;
    }
}

let az = Azul.createFromNumPlayers(2);
let move = Azul.parseMove('1_BLACK_4');
az.pickTiles(move.from, move.toLine, move.color);
console.log(az.state.patternLines)

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

    get(gameId: string) {
        return this.findGame(gameId);
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
        return timeDiffSeconds(new Date(game.createdAt), now());
    }

    getSecondsSinceLastMove(gameId: string) {
        let game = this.findGame(gameId);
        if (!game.moves.length) {
            return null;
        }
        let lastMoveTimestamp = new Date(game.moves[game.moves.length - 1].timestamp);
        return timeDiffSeconds(new Date(lastMoveTimestamp), now())
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

interface UsersData { [id: string]: { id: string, email: string; } }

class Users {
    private users: UsersData = {}

    constructor() {
        try {
            this.users = JSON.parse(fs.readFileSync(USERS_DATA_LOCATION, 'utf-8')) as UsersData;
        } catch (e) {
            console.error(e);
            console.warn('Could not load users state; initialzing an empty object.')
            this.users = {}
        }
    }

    save() {
        fs.writeFileSync(USERS_DATA_LOCATION, JSON.stringify(this.users))
    }

    register(email: string) {
        let id = uuid();
        let secret = uuid();
        this.users[secret] = { id, email };
        this.save();
        return { id, secret, email };
    }

    getUser(secret: string) {
        if (!this.users[secret]) {
            throw new Error('User not found.')
        }
        return this.users[secret];
    }
}

let games = new Games();
let users = new Users();

function getUser(req: express.Request) {
    let secret = req.query.secret || req.headers['x-secret'];
    if (!secret) throw new Error("No used id provided")
    return users.getUser(secret);
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
    res.redirect('/games');
});

app.get('/games', (_req, res) => {
    res.json(games.list())
})

app.get('/games/create', (_req, res) => {
    res.json(games.create())
})

app.get('/games/:gameId', (req, res) => {
    res.json(games.get(getGameId(req)));
})

app.get('/games/:gameId/join', (req, res) => {
    let user = getUser(req);
    let gameId = getGameId(req);
    let game = games.joinGame(gameId, user.id);
    res.json(game);
})

app.get('/games/:gameId/move/:move', (req, res) => {
    let user = getUser(req);
    let gameId = getGameId(req);
    let move = getMove(req);
    let game = games.makeMove(gameId, user.id, move);
    res.json(game);
})

app.get('/register', (req, res) => {
    let email = req.query.email;
    if (!email) { throw new Error('No email provided.'); }
    let user = users.register(email); // includes secret
    res.json(user);
})

app.get('/whoami', (req, res) => {
    let user = getUser(req);
    res.json(user);
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