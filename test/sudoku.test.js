import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIFFICULTIES,
  countFilledCells,
  generatePuzzle,
  isCompleteAndCorrect,
  isValidSolution
} from '../src/sudoku.js';

test('generates valid puzzles for every difficulty with stable givens', () => {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const puzzle = generatePuzzle(difficulty);

    assert.equal(puzzle.solution.length, 81);
    assert.equal(puzzle.grid.length, 81);
    assert.equal(isValidSolution(puzzle.solution), true);
    assert.equal(countFilledCells(puzzle.grid), DIFFICULTIES[difficulty].givens);

    for (let i = 0; i < 81; i += 1) {
      if (puzzle.grid[i] !== 0) {
        assert.equal(puzzle.grid[i], puzzle.solution[i]);
      }
    }
  }
});

test('accepts only completely correct boards', () => {
  const puzzle = generatePuzzle('easy');
  const almost = [...puzzle.solution];
  almost[0] = 0;
  const wrong = [...puzzle.solution];
  wrong[0] = wrong[0] === 1 ? 2 : 1;

  assert.equal(isCompleteAndCorrect(puzzle.solution, puzzle.solution), true);
  assert.equal(isCompleteAndCorrect(almost, puzzle.solution), false);
  assert.equal(isCompleteAndCorrect(wrong, puzzle.solution), false);
});
