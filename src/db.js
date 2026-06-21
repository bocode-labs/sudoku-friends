import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createDatabase(dataDir = process.env.DATA_DIR || './data') {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'sudoku-friends.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    create table if not exists games (
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

    create table if not exists players (
      id text primary key,
      game_id integer not null references games(id) on delete cascade,
      name text not null,
      board text not null,
      score integer not null default 0,
      finish_points integer not null default 0,
      completed integer not null default 0,
      correct integer,
      completed_at text,
      joined_at text not null default current_timestamp
    );

    create table if not exists moves (
      id integer primary key autoincrement,
      player_id text not null references players(id) on delete cascade,
      cell integer not null,
      value integer not null,
      created_at text not null default current_timestamp
    );

    create table if not exists event_awards (
      id integer primary key autoincrement,
      game_id integer not null references games(id) on delete cascade,
      player_id text not null references players(id) on delete cascade,
      type text not null,
      unit integer not null,
      points integer not null default 20,
      awarded_at text not null default current_timestamp,
      unique(game_id, type, unit)
    );
  `);
  migrateDatabase(db);

  return db;
}

function migrateDatabase(db) {
  const playerColumns = new Set(db.prepare('pragma table_info(players)').all().map((column) => column.name));
  if (!playerColumns.has('finish_points')) {
    db.prepare('alter table players add column finish_points integer not null default 0').run();
  }
  if (!playerColumns.has('completed_at')) {
    db.prepare('alter table players add column completed_at text').run();
  }
}

export function serialize(values) {
  return JSON.stringify(values);
}

export function deserialize(value) {
  return JSON.parse(value);
}
