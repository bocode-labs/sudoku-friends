import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

function makeTestApp() {
  const dir = mkdtempSync(join(tmpdir(), 'sudoku-friends-'));
  const db = createDatabase(dir);
  const app = createApp({ db });
  return {
    app,
    db,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function appRequest(app, method, path, body) {
  const payload = body ? Buffer.from(JSON.stringify(body)) : null;
  let sent = false;
  const req = new Readable({
    read() {
      if (sent) {
        return;
      }
      sent = true;
      this.push(payload);
      this.push(null);
    }
  });
  req.method = method;
  req.url = path;
  req.headers = {
    host: 'example.test',
    ...(payload
      ? {
          'content-type': 'application/json',
          'content-length': String(payload.length)
        }
      : {})
  };
  req.connection = new PassThrough();
  req.socket = req.connection;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const headers = new Map();
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headersSent = false;
    res.writableEnded = false;
    res.setHeader = (name, value) => {
      headers.set(name.toLowerCase(), value);
    };
    res.getHeader = (name) => headers.get(name.toLowerCase());
    res.removeHeader = (name) => {
      headers.delete(name.toLowerCase());
    };
    res.writeHead = (statusCode, headerValues = {}) => {
      res.statusCode = statusCode;
      for (const [name, value] of Object.entries(headerValues)) {
        res.setHeader(name, value);
      }
      res.headersSent = true;
      return res;
    };
    res.write = (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    };
    res.end = (chunk) => {
      if (chunk) {
        res.write(chunk);
      }
      res.headersSent = true;
      res.writableEnded = true;
      const text = Buffer.concat(chunks).toString();
      resolve({
        status: res.statusCode,
        text,
        body: text ? JSON.parse(text) : {}
      });
      res.emit('finish');
    };
    res.flushHeaders = () => {
      res.headersSent = true;
    };
    res.req = req;

    app.handle(req, res, reject);
  });
}

function post(app, path, body) {
  return appRequest(app, 'POST', path, body);
}

function get(app, path) {
  return appRequest(app, 'GET', path);
}

test('creates a game, joins players, starts once, and records moves without wrong-value feedback', async () => {
  const t = makeTestApp();
  try {
    const created = await post(t.app, '/api/games', { difficulty: 'medium' });
    assert.equal(created.status, 201);

    assert.equal(created.body.game.difficulty, 'medium');
    assert.match(created.body.game.shareUrl, /\/g\/[A-Za-z0-9_-]+$/);

    const joined = await post(t.app, `/api/games/${created.body.game.code}/players`, { name: 'Ada' });
    assert.equal(joined.status, 201);

    const beforeStart = await get(t.app, `/api/games/${created.body.game.code}?playerId=${joined.body.player.id}`);
    assert.equal(beforeStart.status, 200);

    assert.equal(beforeStart.body.game.status, 'lobby');
    assert.equal(beforeStart.body.game.puzzle, null);
    assert.deepEqual(beforeStart.body.players[0].progress, { filled: 0, total: 91 });

    const start = await post(t.app, `/api/games/${created.body.game.code}/start`, {
      hostToken: created.body.game.hostToken
    });
    assert.equal(start.status, 200);

    const started = await get(t.app, `/api/games/${created.body.game.code}?playerId=${joined.body.player.id}`);
    assert.equal(started.status, 200);

    assert.equal(started.body.game.status, 'playing');
    assert.equal(started.body.game.puzzle.length, 81);
    assert.equal(started.body.game.solution, undefined);

    const editableIndex = started.body.game.puzzle.findIndex((value) => value === 0);
    const wrongValue = started.body.game.solution?.[editableIndex] === 1 ? 2 : 1;
    const moved = await post(t.app, `/api/games/${created.body.game.code}/moves`, {
      playerId: joined.body.player.id,
      cell: editableIndex,
      value: wrongValue
    });
    assert.equal(moved.status, 200);

    assert.equal(moved.body.accepted, true);
    assert.equal(moved.body.correct, undefined);
    assert.equal(moved.body.complete, false);
    assert.equal(moved.body.progress.filled, 1);
    assert.equal(moved.body.progress.total, 91);
  } finally {
    t.cleanup();
  }
});

test('reports correctness only when a player submits a full board', async () => {
  const t = makeTestApp();
  try {
    const created = await post(t.app, '/api/games', { difficulty: 'easy' });
    assert.equal(created.status, 201);
    const joined = await post(t.app, `/api/games/${created.body.game.code}/players`, { name: 'Lin' });
    assert.equal(joined.status, 201);
    const start = await post(t.app, `/api/games/${created.body.game.code}/start`, {
      hostToken: created.body.game.hostToken
    });
    assert.equal(start.status, 200);

    const internal = t.db.prepare('select solution from games where code = ?').get(created.body.game.code);
    const solution = JSON.parse(internal.solution);
    const game = await get(t.app, `/api/games/${created.body.game.code}?playerId=${joined.body.player.id}`);
    assert.equal(game.status, 200);
    const emptyCells = game.body.game.puzzle
      .map((value, index) => (value === 0 ? index : -1))
      .filter((index) => index >= 0);

    for (const cell of emptyCells.slice(0, -1)) {
      const res = await post(t.app, `/api/games/${created.body.game.code}/moves`, {
        playerId: joined.body.player.id,
        cell,
        value: solution[cell]
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.correct, undefined);
      assert.equal(res.body.complete, false);
    }

    const final = await post(t.app, `/api/games/${created.body.game.code}/moves`, {
      playerId: joined.body.player.id,
      cell: emptyCells.at(-1),
      value: solution[emptyCells.at(-1)]
    });
    assert.equal(final.status, 200);

    assert.equal(final.body.complete, true);
    assert.equal(final.body.correct, true);
    assert.equal(final.body.progress.filled, emptyCells.length + 10);
    assert.equal(final.body.progress.total, 91);
  } finally {
    t.cleanup();
  }
});

test('serves games under /sudoku with prefixed share URLs', async () => {
  const t = makeTestApp();
  try {
    const created = await post(t.app, '/sudoku/api/games', { difficulty: 'medium' });
    assert.equal(created.status, 201);

    assert.match(created.body.game.code, /^[A-Za-z0-9_-]+$/);
    assert.equal(created.body.game.shareUrl, `/sudoku/g/${created.body.game.code}`);
  } finally {
    t.cleanup();
  }
});
