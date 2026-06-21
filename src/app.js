import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, deserialize, SCORE_TOTAL, serialize } from './db.js';
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
    db.prepare(
      'insert into games (code, host_token, difficulty, puzzle, solution) values (?, ?, ?, ?, ?)'
    ).run(code, hostToken, difficulty, serialize(grid), serialize(solution));

    return res.status(201).json({
      game: {
        code,
        hostToken,
        difficulty,
        shareUrl: `${routeBasePath(req)}/g/${code}`
      }
    });
  });

  routes.post('/api/games/:code/players', (req, res) => {
    const game = findGame(db, req.params.code);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const name = String(req.body?.name || '').trim().slice(0, 32);
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const player = {
      id: randomUUID(),
      name
    };
    const board = deserialize(game.puzzle);
    db.prepare('insert into players (id, game_id, name, board) values (?, ?, ?, ?)').run(
      player.id,
      game.id,
      name,
      serialize(board)
    );
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
    if (!Number.isInteger(cell) || cell < 0 || cell > 80 || !Number.isInteger(value) || value < 1 || value > 9) {
      return res.status(400).json({ error: 'Move must include cell 0-80 and value 1-9' });
    }
    if (puzzle[cell] !== 0) {
      return res.status(409).json({ error: 'Cannot edit a given cell' });
    }

    const board = deserialize(player.board);
    board[cell] = value;
    const solution = deserialize(game.solution);
    const complete = board.every((boardValue) => boardValue !== 0);
    const correct = complete ? isCompleteAndCorrect(board, solution) : undefined;
    const score = calculateScore(board, puzzle, correct);

    db.prepare(
      'update players set board = ?, score = ?, completed = ?, correct = ? where id = ?'
    ).run(serialize(board), score, complete ? 1 : 0, correct === undefined ? null : correct ? 1 : 0, player.id);
    db.prepare('insert into moves (player_id, cell, value) values (?, ?, ?)').run(player.id, cell, value);

    broadcast(streams, db, game.code);

    const body = {
      accepted: true,
      complete,
      progress: { filled: score, total: SCORE_TOTAL }
    };
    if (complete) {
      body.correct = correct;
    }
    return res.json(body);
  });

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

  const players = db
    .prepare('select id, name, score, completed, correct from players where game_id = ? order by joined_at asc')
    .all(game.id)
    .map((player) => ({
      id: player.id,
      name: player.name,
      progress: { filled: player.score, total: SCORE_TOTAL },
      completed: Boolean(player.completed),
      correct: player.correct === null ? null : Boolean(player.correct)
    }));

  const player = playerId
    ? db.prepare('select id, board from players where id = ? and game_id = ?').get(playerId, game.id)
    : null;

  return {
    game: {
      code: game.code,
      difficulty: game.difficulty,
      status: game.status,
      puzzle: game.status === 'playing' ? deserialize(game.puzzle) : null
    },
    player: player ? { id: player.id, board: deserialize(player.board) } : null,
    players
  };
}

function calculateScore(board, puzzle, correct) {
  const entered = board.reduce((total, value, index) => total + (puzzle[index] === 0 && value !== 0 ? 1 : 0), 0);
  return entered + (correct ? 10 : 0);
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
