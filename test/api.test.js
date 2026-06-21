import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import request from 'supertest';
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

test('creates a game, joins players, starts once, and records moves without wrong-value feedback', async () => {
  const t = makeTestApp();
  try {
    const created = await request(t.app)
      .post('/api/games')
      .send({ difficulty: 'medium' })
      .expect(201);

    assert.equal(created.body.game.difficulty, 'medium');
    assert.match(created.body.game.shareUrl, /\/g\/[A-Za-z0-9_-]+$/);

    const joined = await request(t.app)
      .post(`/api/games/${created.body.game.code}/players`)
      .send({ name: 'Ada' })
      .expect(201);

    const beforeStart = await request(t.app)
      .get(`/api/games/${created.body.game.code}?playerId=${joined.body.player.id}`)
      .expect(200);

    assert.equal(beforeStart.body.game.status, 'lobby');
    assert.equal(beforeStart.body.game.puzzle, null);
    assert.deepEqual(beforeStart.body.players[0].progress, { filled: 0, total: 91 });

    await request(t.app)
      .post(`/api/games/${created.body.game.code}/start`)
      .send({ hostToken: created.body.game.hostToken })
      .expect(200);

    const started = await request(t.app)
      .get(`/api/games/${created.body.game.code}?playerId=${joined.body.player.id}`)
      .expect(200);

    assert.equal(started.body.game.status, 'playing');
    assert.equal(started.body.game.puzzle.length, 81);
    assert.equal(started.body.game.solution, undefined);

    const editableIndex = started.body.game.puzzle.findIndex((value) => value === 0);
    const wrongValue = started.body.game.solution?.[editableIndex] === 1 ? 2 : 1;
    const moved = await request(t.app)
      .post(`/api/games/${created.body.game.code}/moves`)
      .send({ playerId: joined.body.player.id, cell: editableIndex, value: wrongValue })
      .expect(200);

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
    const created = await request(t.app).post('/api/games').send({ difficulty: 'easy' }).expect(201);
    const joined = await request(t.app)
      .post(`/api/games/${created.body.game.code}/players`)
      .send({ name: 'Lin' })
      .expect(201);
    await request(t.app)
      .post(`/api/games/${created.body.game.code}/start`)
      .send({ hostToken: created.body.game.hostToken })
      .expect(200);

    const internal = t.db.prepare('select solution from games where code = ?').get(created.body.game.code);
    const solution = JSON.parse(internal.solution);
    const game = await request(t.app)
      .get(`/api/games/${created.body.game.code}?playerId=${joined.body.player.id}`)
      .expect(200);
    const emptyCells = game.body.game.puzzle
      .map((value, index) => (value === 0 ? index : -1))
      .filter((index) => index >= 0);

    for (const cell of emptyCells.slice(0, -1)) {
      const res = await request(t.app)
        .post(`/api/games/${created.body.game.code}/moves`)
        .send({ playerId: joined.body.player.id, cell, value: solution[cell] })
        .expect(200);
      assert.equal(res.body.correct, undefined);
      assert.equal(res.body.complete, false);
    }

    const final = await request(t.app)
      .post(`/api/games/${created.body.game.code}/moves`)
      .send({
        playerId: joined.body.player.id,
        cell: emptyCells.at(-1),
        value: solution[emptyCells.at(-1)]
      })
      .expect(200);

    assert.equal(final.body.complete, true);
    assert.equal(final.body.correct, true);
    assert.equal(final.body.progress.filled, emptyCells.length + 10);
    assert.equal(final.body.progress.total, 91);
  } finally {
    t.cleanup();
  }
});
