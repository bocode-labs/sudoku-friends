import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIFFICULTIES,
  countSolutions,
  countFilledCells,
  generatePuzzle,
  isCompleteAndCorrect,
  isValidSolution
} from '../src/sudoku.js';

test('difficulty levels use the requested clue counts', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(DIFFICULTIES).map(([name, config]) => [name, config.givens])),
    {
      easy: 36,
      medium: 32,
      hard: 28,
      expert: 24
    }
  );
});

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

test('generated puzzles have a unique solution', () => {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const puzzle = generatePuzzle(difficulty);

    assert.equal(countSolutions(puzzle.grid, 2), 1, difficulty);
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
