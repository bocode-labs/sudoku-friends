export const DIFFICULTIES = {
  easy: { givens: 42 },
  medium: { givens: 36 },
  hard: { givens: 30 },
  expert: { givens: 24 }
};

const SIZE = 9;
const CELLS = 81;

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

  const solution = emptyGrid();
  fillGrid(solution);
  const grid = [...solution];
  removeCells(grid, CELLS - DIFFICULTIES[difficulty].givens);
  return { grid, solution };
}

function emptyGrid() {
  return Array.from({ length: CELLS }, () => 0);
}

function fillGrid(grid) {
  const empty = grid.findIndex((value) => value === 0);
  if (empty === -1) {
    return true;
  }

  for (const value of shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    if (canPlace(grid, empty, value)) {
      grid[empty] = value;
      if (fillGrid(grid)) {
        return true;
      }
      grid[empty] = 0;
    }
  }

  return false;
}

function removeCells(grid, removeCount) {
  for (const index of shuffled([...Array(CELLS).keys()]).slice(0, removeCount)) {
    grid[index] = 0;
  }
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

function shuffled(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
