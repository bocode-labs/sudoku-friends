import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, deserialize, serialize } from './db.js';
import { DIFFICULTIES, generatePuzzle, isCompleteAndCorrect } from './sudoku.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

export function createApp({ db = createDatabase() } = {}) {
  const app = express();
  const streams = new Map();

  app.locals.db = db;
  app.use(express.json());
  app.use(express.static(publicDir));
  app.use('/sudoku', express.static(publicDir));

  const routes = createRoutes({ db, streams });
  app.use(routes);
  app.use('/sudoku', routes);

  return app;
}

function createRoutes({ db, streams }) {
  const routes = express.Router();

  function handleBoardSync(req, res) {
    const game = findGame(db, req.params.code);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    if (game.status !== 'playing') {
      return res.status(409).json({ error: 'Game has not started' });
    }

    const player = db.prepare('select * from players where id = ? and game_id = ?').get(req.body?.playerId, game.id);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    if (player.correct) {
      return res.status(409).json({ error: 'Solved boards are locked' });
    }

    const puzzle = deserialize(game.puzzle);
    const board = validateBoard(req.body?.board, puzzle);
    if (board.error) {
      return res.status(board.status).json({ error: board.error });
    }

    const result = savePlayerBoard(db, game, player, board.value, deserialize(player.board));
    broadcast(streams, db, game.code);

    return res.json(responseForSave(result));
  }

  routes.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  routes.post('/api/games', (req, res) => {
    const difficulty = req.body?.difficulty || 'medium';
    if (!DIFFICULTIES[difficulty]) {
      return res.status(400).json({ error: 'Invalid difficulty' });
    }

    const { grid, solution } = generatePuzzle(difficulty);
    const code = createCode();
    const hostToken = randomUUID();
    const hostName = playerNameFrom(req.body?.name);
    const createGame = db.transaction(() => {
      const gameResult = db
        .prepare('insert into games (code, host_token, difficulty, puzzle, solution) values (?, ?, ?, ?, ?)')
        .run(code, hostToken, difficulty, serialize(grid), serialize(solution));
      if (!hostName) {
        return null;
      }
      return createPlayer(db, gameResult.lastInsertRowid, hostName, grid);
    });
    const player = createGame();

    const body = {
      game: {
        code,
        hostToken,
        difficulty,
        shareUrl: `${routeBasePath(req)}/g/${code}`
      }
    };
    if (player) {
      body.player = player;
    }
    return res.status(201).json(body);
  });

  routes.post('/api/games/:code/players', (req, res) => {
    const game = findGame(db, req.params.code);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const name = playerNameFrom(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const player = createPlayer(db, game.id, name, deserialize(game.puzzle));
    broadcast(streams, db, game.code);

    return res.status(201).json({ player });
  });

  routes.post('/api/games/:code/start', (req, res) => {
    const game = findGame(db, req.params.code);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    if (req.body?.hostToken !== game.host_token) {
      return res.status(403).json({ error: 'Host token is required' });
    }
    if (game.status === 'lobby') {
      db.prepare("update games set status = 'playing', started_at = current_timestamp where id = ?").run(game.id);
    }
    broadcast(streams, db, game.code);
    return res.json({ ok: true });
  });

  routes.get('/api/games/:code', (req, res) => {
    const state = snapshot(db, req.params.code, req.query.playerId);
    if (!state) {
      return res.status(404).json({ error: 'Game not found' });
    }
    return res.json(state);
  });

  routes.post('/api/games/:code/moves', (req, res) => {
    const game = findGame(db, req.params.code);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    if (game.status !== 'playing') {
      return res.status(409).json({ error: 'Game has not started' });
    }

    const player = db.prepare('select * from players where id = ? and game_id = ?').get(req.body?.playerId, game.id);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const cell = Number(req.body?.cell);
    const value = Number(req.body?.value);
    const puzzle = deserialize(game.puzzle);
    if (!Number.isInteger(cell) || cell < 0 || cell > 80 || !Number.isInteger(value) || value < 0 || value > 9) {
      return res.status(400).json({ error: 'Move must include cell 0-80 and value 0-9' });
    }
    if (puzzle[cell] !== 0) {
      return res.status(409).json({ error: 'Cannot edit a given cell' });
    }

    const previousBoard = deserialize(player.board);
    if (player.correct) {
      return res.status(409).json({ error: 'Solved boards are locked' });
    }
    const board = previousBoard.slice();
    board[cell] = value;
    const result = savePlayerBoard(db, game, player, board, previousBoard, { cell, value });

    broadcast(streams, db, game.code);

    return res.json(responseForSave(result));
  });

  routes.put('/api/games/:code/board', handleBoardSync);
  routes.post('/api/games/:code/board', handleBoardSync);

  routes.get('/api/games/:code/events', (req, res) => {
    const game = findGame(db, req.params.code);
    if (!game) {
      return res.status(404).end();
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();

    const client = { res, playerId: req.query.playerId };
    const clients = streams.get(game.code) || new Set();
    clients.add(client);
    streams.set(game.code, clients);
    sendEvent(res, snapshot(db, game.code, req.query.playerId));

    req.on('close', () => {
      clients.delete(client);
      if (clients.size === 0) {
        streams.delete(game.code);
      }
    });
  });

  routes.get('/g/:code', (req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });

  return routes;
}

function routeBasePath(req) {
  const forwardedPrefix = req.get('x-forwarded-prefix');
  if (forwardedPrefix) {
    return forwardedPrefix.endsWith('/') ? forwardedPrefix.slice(0, -1) : forwardedPrefix;
  }
  return req.baseUrl === '/' ? '' : req.baseUrl;
}

function snapshot(db, code, playerId) {
  const game = findGame(db, code);
  if (!game) {
    return null;
  }

  const playerRows = db
    .prepare(
      'select id, name, board, finish_points, completed, correct, completed_at, joined_at from players where game_id = ? order by joined_at asc'
    )
    .all(game.id);
  const waitingPlayers = playerRows.map((player) => ({
    id: player.id,
    name: player.name
  }));
  const players = playerRows
    .map((player) => {
      const awards = db
        .prepare('select type, unit, points, awarded_at as awardedAt from event_awards where player_id = ? order by awarded_at asc, id asc')
        .all(player.id);
      const awardPoints = awards.reduce((total, award) => total + award.points, 0);
      return {
        id: player.id,
        name: player.name,
        progress: progressFor(deserialize(player.board), deserialize(game.puzzle)),
        timer: timerFor(game.started_at, player.completed_at, game.status),
        points: player.finish_points + awardPoints,
        finishPoints: player.finish_points,
        finishRank: finishRank(db, game.id, player.id),
        awards,
        completed: Boolean(player.completed),
        correct: player.correct === null ? null : Boolean(player.correct)
      };
    })
    .sort((left, right) => {
      if (right.points !== left.points) return right.points - left.points;
      if (left.finishRank && right.finishRank) return left.finishRank - right.finishRank;
      if (left.finishRank) return -1;
      if (right.finishRank) return 1;
      return right.progress.percent - left.progress.percent;
    });

  const player = playerId
    ? db.prepare('select id, board from players where id = ? and game_id = ?').get(playerId, game.id)
    : null;
  const canWatch = Boolean(
    playerId &&
      db.prepare('select 1 from players where id = ? and game_id = ? and correct = 1').get(playerId, game.id)
  );

  return {
    game: {
      code: game.code,
      difficulty: game.difficulty,
      status: game.status,
      puzzle: game.status === 'playing' ? deserialize(game.puzzle) : null
    },
    player: player ? { id: player.id, board: deserialize(player.board) } : null,
    waitingPlayers,
    players,
    watch: {
      canWatch,
      boards: canWatch
        ? db
            .prepare('select id as playerId, board from players where game_id = ? order by joined_at asc')
            .all(game.id)
            .map((watchPlayer) => ({
              playerId: watchPlayer.playerId,
              board: deserialize(watchPlayer.board)
            }))
        : []
    }
  };
}

function playerNameFrom(value) {
  return String(value || '').trim().slice(0, 32);
}

function createPlayer(db, gameId, name, puzzle) {
  const player = {
    id: randomUUID(),
    name
  };
  db.prepare('insert into players (id, game_id, name, board) values (?, ?, ?, ?)').run(
    player.id,
    gameId,
    name,
    serialize(puzzle)
  );
  return player;
}

function progressFor(board, puzzle) {
  const total = puzzle.reduce((count, value) => count + (value === 0 ? 1 : 0), 0);
  const filled = board.reduce((count, value, index) => count + (puzzle[index] === 0 && value !== 0 ? 1 : 0), 0);
  return {
    filled,
    total,
    percent: total === 0 ? 100 : Math.floor((filled / total) * 100)
  };
}

function validateBoard(value, puzzle) {
  if (!Array.isArray(value) || value.length !== 81) {
    return { status: 400, error: 'Board must include 81 values' };
  }

  const board = value.map((cell) => {
    if (typeof cell === 'string' && cell.trim() !== '') {
      return Number(cell);
    }
    return typeof cell === 'number' ? cell : NaN;
  });
  if (board.some((cell) => !Number.isInteger(cell) || cell < 0 || cell > 9)) {
    return { status: 400, error: 'Board values must be integers from 0-9' };
  }

  const editedGiven = board.findIndex((cell, index) => puzzle[index] !== 0 && cell !== puzzle[index]);
  if (editedGiven !== -1) {
    return { status: 409, error: 'Cannot edit a given cell' };
  }

  return { value: board };
}

function savePlayerBoard(db, game, player, board, previousBoard, move = null) {
  const puzzle = deserialize(game.puzzle);
  const solution = deserialize(game.solution);
  const complete = board.every((boardValue) => boardValue !== 0);
  const correct = complete ? isCompleteAndCorrect(board, solution) : undefined;
  const completedAt = complete && correct && !player.completed_at ? timestamp() : player.completed_at;
  const finishPoints =
    complete && correct && !player.correct ? calculateFinishPoints(db, game.id, completedAt) : player.finish_points;
  const progress = progressFor(board, puzzle);

  const save = db.transaction(() => {
    db.prepare(
      'update players set board = ?, score = ?, finish_points = ?, completed = ?, correct = ?, completed_at = ? where id = ?'
    ).run(
      serialize(board),
      progress.filled,
      finishPoints,
      complete ? 1 : 0,
      correct === undefined ? null : correct ? 1 : 0,
      completedAt,
      player.id
    );
    if (move) {
      db.prepare('insert into moves (player_id, cell, value) values (?, ?, ?)').run(player.id, move.cell, move.value);
    }
    awardBoardMilestones(db, game.id, player.id, board, previousBoard, solution);
  });
  save();

  return { complete, correct, progress, board };
}

function responseForSave(result) {
  const body = {
    accepted: true,
    complete: result.complete,
    progress: result.progress,
    board: result.board
  };
  if (result.complete) {
    body.correct = result.correct;
  }
  return body;
}

function timerFor(startedAt, completedAt, status) {
  if (!startedAt || status !== 'playing') {
    return { elapsedSeconds: 0, finished: false };
  }
  const end = completedAt || timestamp();
  return {
    elapsedSeconds: Math.max(0, Math.floor((parseTimestamp(end) - parseTimestamp(startedAt)) / 1000)),
    finished: Boolean(completedAt)
  };
}

function calculateFinishPoints(db, gameId, completedAt) {
  const finishers = db
    .prepare(
      'select completed_at from players where game_id = ? and correct = 1 and completed_at is not null order by completed_at asc'
    )
    .all(gameId);
  const rank = finishers.length + 1;
  if (rank === 1) {
    return 100;
  }
  const firstCompletedAt = finishers[0].completed_at;
  const minutesLater = Math.floor((parseTimestamp(completedAt) - parseTimestamp(firstCompletedAt)) / 60000);
  return Math.max(0, 100 - 20 * (rank - 1) - minutesLater);
}

function finishRank(db, gameId, playerId) {
  const finishers = db
    .prepare(
      'select id from players where game_id = ? and correct = 1 and completed_at is not null order by completed_at asc, joined_at asc'
    )
    .all(gameId);
  const index = finishers.findIndex((player) => player.id === playerId);
  return index === -1 ? null : index + 1;
}

function awardMilestones(db, gameId, playerId, board, solution, cell, value) {
  if (value === 0 || board[cell] !== solution[cell]) {
    return;
  }

  const row = Math.floor(cell / 9);
  const col = cell % 9;
  const box = Math.floor(row / 3) * 3 + Math.floor(col / 3);
  const digit = solution[cell];
  const awards = [
    { type: 'row', unit: 0, points: 20, indices: indicesForRow(row) },
    { type: 'column', unit: 0, points: 20, indices: indicesForColumn(col) },
    { type: 'box', unit: 0, points: 20, indices: indicesForBox(box) },
    { type: 'digit', unit: digit, points: 10, indices: indicesForDigit(solution, digit) }
  ];

  for (const award of awards) {
    if (award.indices.every((index) => board[index] === solution[index])) {
      db.prepare(
        'insert or ignore into event_awards (game_id, player_id, type, unit, points) values (?, ?, ?, ?, ?)'
      ).run(gameId, playerId, award.type, award.unit, award.points);
    }
  }
}

function awardBoardMilestones(db, gameId, playerId, board, previousBoard, solution) {
  for (let cell = 0; cell < board.length; cell += 1) {
    if (board[cell] !== previousBoard[cell]) {
      awardMilestones(db, gameId, playerId, board, solution, cell, board[cell]);
    }
  }
}

function indicesForRow(row) {
  return Array.from({ length: 9 }, (_, index) => row * 9 + index);
}

function indicesForColumn(column) {
  return Array.from({ length: 9 }, (_, index) => index * 9 + column);
}

function indicesForBox(box) {
  const startRow = Math.floor(box / 3) * 3;
  const startCol = (box % 3) * 3;
  const indices = [];
  for (let dr = 0; dr < 3; dr += 1) {
    for (let dc = 0; dc < 3; dc += 1) {
      indices.push((startRow + dr) * 9 + startCol + dc);
    }
  }
  return indices;
}

function indicesForDigit(solution, digit) {
  return solution.map((value, index) => (value === digit ? index : -1)).filter((index) => index >= 0);
}

function timestamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function parseTimestamp(value) {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

function findGame(db, code) {
  return db.prepare('select * from games where code = ?').get(code);
}

function createCode() {
  return randomBytes(6).toString('base64url');
}

function broadcast(streams, db, code) {
  const clients = streams.get(code);
  if (!clients) {
    return;
  }
  for (const client of clients) {
    sendEvent(client.res, snapshot(db, code, client.playerId));
  }
}

function sendEvent(res, state) {
  res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
}
