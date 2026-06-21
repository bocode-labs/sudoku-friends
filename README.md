# Sudoku Friends

Realtime multiplayer Sudoku for a small group of friends. It is a single Node.js service with an Express API, static mobile-first UI, SQLite persistence, and Server-Sent Events for live lobby/progress updates. It does not require any hosted services.

## Run Locally

```bash
npm install
npm test
npm start
```

Open `http://localhost:3000`, create a game, share the `/g/<code>` URL, have players join with a name, then the host presses Start. Players only receive the Sudoku after the game starts.

## Configuration

- `PORT`: HTTP port, default `3000`.
- `DATA_DIR`: directory for the SQLite database, default `./data`.

The database file is `${DATA_DIR}/sudoku-friends.sqlite`.

## Architecture

- `src/server.js`: production entrypoint.
- `src/app.js`: Express app, JSON API, SSE endpoint, static file serving.
- `src/db.js`: SQLite connection and schema.
- `src/sudoku.js`: randomized backtracking Sudoku solution generation, symmetric clue removal with a bounded solution counter to preserve a unique solution, and validation.
- `public/`: browser UI.
- `test/`: Node test runner tests for generation/validation and core API flow.

Games are created in `lobby` state with a generated puzzle and full solution persisted server-side. Players who join receive a board initialized from the givens. The `/api/games/:code/start` route requires the host token returned when the game was created; after start, all players see the same puzzle.

## SSE

Clients connect to:

```text
GET /api/games/:code/events?playerId=<playerId>
```

The server sends `state` events containing game status, the public puzzle after start, the current player's board, and all player progress rows. Browser `EventSource` automatically reconnects; the UI also recreates the connection after an error.

## Scoring Decision

The progress panel intentionally displays `n/91` as requested. The denominator is a score target, not the Sudoku cell count: `n` is the number of empty cells filled by that player plus a 10-point completion bonus only when the final full board is correct. Wrong values are never identified during play. Correctness is reported only after the player has filled every cell.

## API

- `POST /api/games` with `{ "difficulty": "easy|medium|hard|expert" }`
- `POST /api/games/:code/players` with `{ "name": "Ada" }`
- `POST /api/games/:code/start` with `{ "hostToken": "..." }`
- `GET /api/games/:code?playerId=...`
- `POST /api/games/:code/moves` with `{ "playerId": "...", "cell": 0, "value": 5 }`

## Coolify

Create a Coolify application from this repository using the Dockerfile. Configure a persistent volume mounted at `/app/data`; the Dockerfile sets `DATA_DIR=/app/data` so SQLite survives redeploys. Expose port `3000` or let Coolify map it through its proxy.
