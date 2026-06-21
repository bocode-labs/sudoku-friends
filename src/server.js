import { createApp } from './app.js';
import { createDatabase } from './db.js';

const port = Number(process.env.PORT || 3000);
const dataDir = process.env.DATA_DIR || './data';
const db = createDatabase(dataDir);
const app = createApp({ db });

app.listen(port, () => {
  console.log(`Sudoku Friends listening on :${port}`);
  console.log(`SQLite data directory: ${dataDir}`);
});
