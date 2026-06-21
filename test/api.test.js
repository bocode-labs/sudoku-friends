import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import Database from 'better-sqlite3';
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

const SOLUTION = [
  1, 2, 3, 4, 5, 6, 7, 8, 9,
  4, 5, 6, 7, 8, 9, 1, 2, 3,
  7, 8, 9, 1, 2, 3, 4, 5, 6,
  2, 3, 4, 5, 6, 7, 8, 9, 1,
  5, 6, 7, 8, 9, 1, 2, 3, 4,
  8, 9, 1, 2, 3, 4, 5, 6, 7,
  3, 4, 5, 6, 7, 8, 9, 1, 2,
  6, 7, 8, 9, 1, 2, 3, 4, 5,
  9, 1, 2, 3, 4, 5, 6, 7, 8
];

function rowZeroPuzzle() {
  return SOLUTION.map((value, index) => (index < 9 ? 0 : value));
}

function replacePuzzle(db, code, puzzle = rowZeroPuzzle(), solution = SOLUTION) {
  const game = db.prepare('select id from games where code = ?').get(code);
  db.prepare('update games set puzzle = ?, solution = ? where id = ?').run(
    JSON.stringify(puzzle),
    JSON.stringify(solution),
    game.id
  );
  db.prepare('update players set board = ? where game_id = ?').run(JSON.stringify(puzzle), game.id);
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
    assert.equal(beforeStart.body.players[0].progress.filled, 0);
    assert.equal(beforeStart.body.players[0].progress.percent, 0);

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
    assert.equal(moved.body.progress.total, started.body.game.puzzle.filter((value) => value === 0).length);

    const removed = await post(t.app, `/api/games/${created.body.game.code}/moves`, {
      playerId: joined.body.player.id,
      cell: editableIndex,
      value: 0
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.complete, false);
    assert.equal(removed.body.progress.filled, 0);
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
    assert.equal(final.body.progress.filled, emptyCells.length);
    assert.equal(final.body.progress.total, emptyCells.length);
    assert.equal(final.body.progress.percent, 100);
  } finally {
    t.cleanup();
  }
});

test('only correctly finished players can receive watch board snapshots', async () => {
  const t = makeTestApp();
  try {
    const created = await post(t.app, '/api/games', { difficulty: 'easy' });
    const code = created.body.game.code;
    const ada = await post(t.app, `/api/games/${code}/players`, { name: 'Ada' });
    const grace = await post(t.app, `/api/games/${code}/players`, { name: 'Grace' });
    replacePuzzle(t.db, code);

    const start = await post(t.app, `/api/games/${code}/start`, {
      hostToken: created.body.game.hostToken
    });
    assert.equal(start.status, 200);

    const unfinished = await get(t.app, `/api/games/${code}?playerId=${ada.body.player.id}`);
    assert.equal(unfinished.status, 200);
    assert.equal(unfinished.body.watch.canWatch, false);
    assert.deepEqual(unfinished.body.watch.boards, []);

    const graceMove = await post(t.app, `/api/games/${code}/moves`, {
      playerId: grace.body.player.id,
      cell: 0,
      value: SOLUTION[0]
    });
    assert.equal(graceMove.status, 200);

    for (let cell = 0; cell < 9; cell += 1) {
      const move = await post(t.app, `/api/games/${code}/moves`, {
        playerId: ada.body.player.id,
        cell,
        value: SOLUTION[cell]
      });
      assert.equal(move.status, 200);
    }

    const finished = await get(t.app, `/api/games/${code}?playerId=${ada.body.player.id}`);
    assert.equal(finished.body.watch.canWatch, true);
    assert.deepEqual(
      finished.body.watch.boards.find((board) => board.playerId === grace.body.player.id)?.board.slice(0, 9),
      [SOLUTION[0], 0, 0, 0, 0, 0, 0, 0, 0]
    );

    const graceSnapshot = await get(t.app, `/api/games/${code}?playerId=${grace.body.player.id}`);
    assert.equal(graceSnapshot.body.watch.canWatch, false);
    assert.deepEqual(graceSnapshot.body.watch.boards, []);
  } finally {
    t.cleanup();
  }
});

test('delete moves accept numeric zero and string zero values', async () => {
  const t = makeTestApp();
  try {
    const created = await post(t.app, '/api/games', { difficulty: 'easy' });
    const code = created.body.game.code;
    const joined = await post(t.app, `/api/games/${code}/players`, { name: 'Ada' });
    replacePuzzle(t.db, code);

    const start = await post(t.app, `/api/games/${code}/start`, {
      hostToken: created.body.game.hostToken
    });
    assert.equal(start.status, 200);

    const setMove = await post(t.app, `/api/games/${code}/moves`, {
      playerId: joined.body.player.id,
      cell: 0,
      value: SOLUTION[0]
    });
    assert.equal(setMove.status, 200);
    assert.equal(setMove.body.progress.filled, 1);

    const numericDelete = await post(t.app, `/api/games/${code}/moves`, {
      playerId: joined.body.player.id,
      cell: 0,
      value: 0
    });
    assert.equal(numericDelete.status, 200);
    assert.equal(numericDelete.body.progress.filled, 0);

    const secondSetMove = await post(t.app, `/api/games/${code}/moves`, {
      playerId: joined.body.player.id,
      cell: 0,
      value: SOLUTION[0]
    });
    assert.equal(secondSetMove.status, 200);

    const stringDelete = await post(t.app, `/api/games/${code}/moves`, {
      playerId: joined.body.player.id,
      cell: 0,
      value: '0'
    });
    assert.equal(stringDelete.status, 200);
    assert.equal(stringDelete.body.progress.filled, 0);
  } finally {
    t.cleanup();
  }
});

test('snapshots report editable-cell percentages, elapsed timers, finish points, and milestone awards', async () => {
  const t = makeTestApp();
  try {
    const created = await post(t.app, '/api/games', { difficulty: 'easy' });
    const code = created.body.game.code;
    const ada = await post(t.app, `/api/games/${code}/players`, { name: 'Ada' });
    const grace = await post(t.app, `/api/games/${code}/players`, { name: 'Grace' });
    replacePuzzle(t.db, code);

    const start = await post(t.app, `/api/games/${code}/start`, {
      hostToken: created.body.game.hostToken
    });
    assert.equal(start.status, 200);
    t.db.prepare("update games set started_at = datetime('now', '-125 seconds') where code = ?").run(code);

    const initial = await get(t.app, `/api/games/${code}?playerId=${ada.body.player.id}`);
    assert.equal(initial.body.players[0].progress.total, 9);
    assert.equal(initial.body.players[0].progress.percent, 0);
    assert.ok(initial.body.players[0].timer.elapsedSeconds >= 120);
    assert.equal(initial.body.players[0].timer.finished, false);

    for (const cell of [0, 1, 2, 3]) {
      const move = await post(t.app, `/api/games/${code}/moves`, {
        playerId: ada.body.player.id,
        cell,
        value: SOLUTION[cell]
      });
      assert.equal(move.status, 200);
    }

    const partial = await get(t.app, `/api/games/${code}?playerId=${ada.body.player.id}`);
    assert.deepEqual(partial.body.players[0].progress, { filled: 4, total: 9, percent: 44 });

    for (const cell of [4, 5, 6, 7, 8]) {
      const move = await post(t.app, `/api/games/${code}/moves`, {
        playerId: ada.body.player.id,
        cell,
        value: SOLUTION[cell]
      });
      assert.equal(move.status, 200);
    }

    t.db
      .prepare(
        "update players set completed_at = datetime((select started_at from games where code = ?), '+90 seconds') where id = ?"
      )
      .run(code, ada.body.player.id);
    t.db.prepare("update games set started_at = datetime('now', '-10 minutes') where code = ?").run(code);
    t.db.prepare("update players set completed_at = datetime('now', '-5 minutes') where id = ?").run(ada.body.player.id);

    for (let cell = 0; cell < 9; cell += 1) {
      const move = await post(t.app, `/api/games/${code}/moves`, {
        playerId: grace.body.player.id,
        cell,
        value: SOLUTION[cell]
      });
      assert.equal(move.status, 200);
    }

    const finished = await get(t.app, `/api/games/${code}?playerId=${ada.body.player.id}`);
    const adaSnapshot = finished.body.players.find((player) => player.id === ada.body.player.id);
    const graceSnapshot = finished.body.players.find((player) => player.id === grace.body.player.id);

    assert.equal(adaSnapshot.completed, true);
    assert.equal(adaSnapshot.correct, true);
    assert.equal(adaSnapshot.finishRank, 1);
    assert.equal(adaSnapshot.finishPoints, 100);
    assert.equal(adaSnapshot.timer.elapsedSeconds, 300);
    assert.equal(adaSnapshot.timer.finished, true);
    assert.equal(adaSnapshot.points, 250);
    assert.equal(adaSnapshot.awards.reduce((total, award) => total + award.points, 0), 150);
    assert.ok(adaSnapshot.awards.some((award) => award.type === 'row' && award.unit === 0 && award.points === 20));
    assert.ok(adaSnapshot.awards.some((award) => award.type === 'digit' && award.unit === 1 && award.points === 10));

    assert.equal(graceSnapshot.finishRank, 2);
    assert.equal(graceSnapshot.finishPoints, 75);
    assert.equal(graceSnapshot.awards.length, 0);
    assert.equal(graceSnapshot.points, 75);
  } finally {
    t.cleanup();
  }
});

test('migrates existing sqlite databases with leaderboard columns and event awards table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sudoku-friends-old-'));
  const oldDb = new Database(join(dir, 'sudoku-friends.sqlite'));
  oldDb.exec(`
    create table games (
      id integer primary key autoincrement,
      code text not null unique,
      host_token text not null,
      difficulty text not null,
      status text not null default 'lobby',
      puzzle text not null,
      solution text not null,
      created_at text not null default current_timestamp,
      started_at text
    );

    create table players (
      id text primary key,
      game_id integer not null references games(id) on delete cascade,
      name text not null,
      board text not null,
      score integer not null default 0,
      completed integer not null default 0,
      correct integer,
      joined_at text not null default current_timestamp
    );

    create table moves (
      id integer primary key autoincrement,
      player_id text not null references players(id) on delete cascade,
      cell integer not null,
      value integer not null,
      created_at text not null default current_timestamp
    );
  `);
  oldDb.close();
  const db = createDatabase(dir);
  try {
    const playerColumns = db.prepare('pragma table_info(players)').all().map((column) => column.name);
    assert.ok(playerColumns.includes('completed_at'));
    assert.ok(playerColumns.includes('finish_points'));
    assert.ok(db.prepare("select name from sqlite_master where type = 'table' and name = 'event_awards'").get());
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
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
