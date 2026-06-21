import { analyze, generate, solve } from 'sudoku-core';

export const DIFFICULTIES = {
  easy: { rating: 'easy' },
  medium: { rating: 'medium' },
  hard: { rating: 'hard' },
  expert: { rating: 'expert' }
};

const SIZE = 9;
const CELLS = 81;
const MAX_GENERATION_ATTEMPTS = 3;

export function countFilledCells(grid) {
  return grid.filter((value) => value !== 0).length;
}

export function isValidSolution(grid) {
  if (!Array.isArray(grid) || grid.length !== CELLS || grid.some((value) => value < 1 || value > 9)) {
    return false;
  }

  for (let i = 0; i < SIZE; i += 1) {
    if (!validGroup(row(grid, i)) || !validGroup(column(grid, i)) || !validGroup(box(grid, i))) {
      return false;
    }
  }
  return true;
}

export function isCompleteAndCorrect(board, solution) {
  return (
    Array.isArray(board) &&
    Array.isArray(solution) &&
    board.length === CELLS &&
    solution.length === CELLS &&
    board.every((value, index) => value !== 0 && value === solution[index])
  );
}

export function generatePuzzle(difficulty = 'medium') {
  if (!DIFFICULTIES[difficulty]) {
    throw new Error(`Unknown difficulty: ${difficulty}`);
  }

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const generated = generate(DIFFICULTIES[difficulty].rating);
    const solved = solve(generated);
    const rating = normalizeAnalysis(solved.analysis);

    if (
      solved.solved === true &&
      Array.isArray(solved.board) &&
      rating.hasSolution === true &&
      rating.hasUniqueSolution === true &&
      rating.difficulty === difficulty
    ) {
      const grid = fromCoreBoard(generated);
      const solution = fromCoreBoard(solved.board);
      if (isValidSolution(solution) && countSolutions(grid, 2) === 1) {
        return { grid, solution };
      }
    }
  }

  throw new Error(`Unable to generate a unique ${difficulty} puzzle`);
}

export function ratePuzzleDifficulty(grid) {
  return analyzeCoreBoard(toCoreBoard(grid));
}

export function countSolutions(grid, limit = 2) {
  if (!Array.isArray(grid) || grid.length !== CELLS) {
    return 0;
  }

  const working = [...grid];
  return countGridSolutions(working, Math.max(1, limit));
}

function toCoreBoard(grid) {
  if (!Array.isArray(grid) || grid.length !== CELLS) {
    throw new Error('Sudoku board must contain 81 cells');
  }

  return grid.map((value) => {
    if (value === 0 || value === null || value === undefined) {
      return null;
    }
    if (Number.isInteger(value) && value >= 1 && value <= 9) {
      return value;
    }
    throw new Error('Sudoku board cells must be values from 0-9');
  });
}

function fromCoreBoard(board) {
  if (!Array.isArray(board) || board.length !== CELLS) {
    throw new Error('Sudoku board must contain 81 cells');
  }

  return board.map((value) => value ?? 0);
}

function analyzeCoreBoard(board) {
  return normalizeAnalysis(analyze(board));
}

function normalizeAnalysis(rating = {}) {
  return {
    hasSolution: rating.hasSolution,
    hasUniqueSolution: rating.hasUniqueSolution,
    usedStrategies: rating.usedStrategies ?? [],
    difficulty: rating.difficulty ?? rating.level,
    score: rating.score
  };
}

function canPlace(grid, index, value) {
  const r = Math.floor(index / SIZE);
  const c = index % SIZE;
  const boxRow = Math.floor(r / 3) * 3;
  const boxCol = Math.floor(c / 3) * 3;

  for (let i = 0; i < SIZE; i += 1) {
    if (grid[r * SIZE + i] === value || grid[i * SIZE + c] === value) {
      return false;
    }
  }

  for (let dr = 0; dr < 3; dr += 1) {
    for (let dc = 0; dc < 3; dc += 1) {
      if (grid[(boxRow + dr) * SIZE + boxCol + dc] === value) {
        return false;
      }
    }
  }

  return true;
}

function countGridSolutions(grid, limit) {
  const next = findMostConstrainedCell(grid);
  if (!next) {
    return 1;
  }
  if (next.candidates.length === 0) {
    return 0;
  }

  let total = 0;
  for (const value of next.candidates) {
    grid[next.index] = value;
    total += countGridSolutions(grid, limit - total);
    grid[next.index] = 0;
    if (total >= limit) {
      return total;
    }
  }
  return total;
}

function findMostConstrainedCell(grid) {
  let best = null;
  for (let index = 0; index < CELLS; index += 1) {
    if (grid[index] !== 0) {
      continue;
    }
    const candidates = [];
    for (let value = 1; value <= SIZE; value += 1) {
      if (canPlace(grid, index, value)) {
        candidates.push(value);
      }
    }
    if (!best || candidates.length < best.candidates.length) {
      best = { index, candidates };
      if (candidates.length <= 1) {
        return best;
      }
    }
  }
  return best;
}

function row(grid, index) {
  return grid.slice(index * SIZE, index * SIZE + SIZE);
}

function column(grid, index) {
  return Array.from({ length: SIZE }, (_, rowIndex) => grid[rowIndex * SIZE + index]);
}

function box(grid, index) {
  const startRow = Math.floor(index / 3) * 3;
  const startCol = (index % 3) * 3;
  const values = [];
  for (let dr = 0; dr < 3; dr += 1) {
    for (let dc = 0; dc < 3; dc += 1) {
      values.push(grid[(startRow + dr) * SIZE + startCol + dc]);
    }
  }
  return values;
}

function validGroup(values) {
  return new Set(values).size === SIZE && values.every((value) => value >= 1 && value <= 9);
}
