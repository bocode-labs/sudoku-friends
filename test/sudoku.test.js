import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIFFICULTIES,
  countSolutions,
  countFilledCells,
  generatePuzzle,
  isCompleteAndCorrect,
  isValidSolution,
  ratePuzzleDifficulty
} from '../src/sudoku.js';

test('difficulty levels expose the supported analyzer ratings', () => {
  assert.deepEqual(Object.keys(DIFFICULTIES), ['easy', 'medium', 'hard', 'expert']);
});

test('rates puzzle difficulty with solution and uniqueness data', () => {
  const puzzle = generatePuzzle('easy');
  const rating = ratePuzzleDifficulty(puzzle.grid);

  assert.equal(rating.difficulty, 'easy');
  assert.equal(rating.hasSolution, true);
  assert.equal(rating.hasUniqueSolution, true);
  assert.equal(typeof rating.score, 'number');
});

test('generates valid puzzles for every requested difficulty rating', () => {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const puzzle = generatePuzzle(difficulty);
    const rating = ratePuzzleDifficulty(puzzle.grid);

    assert.equal(puzzle.solution.length, 81);
    assert.equal(puzzle.grid.length, 81);
    assert.equal(isValidSolution(puzzle.solution), true);
    assert.equal(rating.difficulty, difficulty);
    assert.equal(rating.hasSolution, true);
    assert.equal(rating.hasUniqueSolution, true);
    assert.ok(countFilledCells(puzzle.grid) > 0);

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
