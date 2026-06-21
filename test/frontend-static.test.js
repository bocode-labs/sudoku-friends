import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('postgame hub replaces inline watch and legacy scores modal markup', () => {
  assert.match(indexHtml, /id="gameHub"/);
  assert.match(indexHtml, /id="hubGameTab"/);
  assert.match(indexHtml, /id="hubWatchTab"/);
  assert.match(indexHtml, /id="hubScoreboardTab"/);
  assert.match(indexHtml, /id="hubLiveToggle"/);
  assert.match(indexHtml, /id="hubPrevPlayer"/);
  assert.match(indexHtml, /id="hubNextPlayer"/);
  assert.doesNotMatch(indexHtml, /id="watchView"/);
  assert.doesNotMatch(indexHtml, /id="watchPlayer"/);
  assert.doesNotMatch(indexHtml, /id="reviewPanel"/);
});
