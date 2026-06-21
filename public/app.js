const basePath = detectBasePath(location.pathname);
const routePath = stripBasePath(location.pathname);

const state = {
  code: routePath.startsWith('/g/') ? routePath.split('/').pop() : null,
  hostToken: '',
  playerId: '',
  selected: null,
  snapshot: null,
  snapshotReceivedAt: 0,
  events: null,
  timerTick: null,
  renderedPuzzleKey: '',
  renderedWatchPuzzleKey: '',
  renderedBoardKey: '',
  renderedWatchBoardKey: '',
  localBoard: null,
  pendingMoves: new Map(),
  moveSeq: 0,
  toastTimer: null,
  watchingPlayerId: ''
};

const el = {
  title: document.querySelector('#title'),
  createView: document.querySelector('#createView'),
  lobbyView: document.querySelector('#lobbyView'),
  playView: document.querySelector('#playView'),
  scores: document.querySelector('#scores'),
  scoreList: document.querySelector('#scoreList'),
  closeScores: document.querySelector('#closeScores'),
  difficulty: document.querySelector('#difficulty'),
  hostName: document.querySelector('#hostName'),
  createGame: document.querySelector('#createGame'),
  shareUrl: document.querySelector('#shareUrl'),
  copyShareUrl: document.querySelector('#copyShareUrl'),
  playerName: document.querySelector('#playerName'),
  joinGame: document.querySelector('#joinGame'),
  startGame: document.querySelector('#startGame'),
  waitingText: document.querySelector('#waitingText'),
  waitingPlayers: document.querySelector('#waitingPlayers'),
  waitingPlayersCount: document.querySelector('#waitingPlayersCount'),
  board: document.querySelector('#board'),
  numbers: document.querySelector('#numbers'),
  result: document.querySelector('#result'),
  toggleScores: document.querySelector('#toggleScores'),
  rankIndicator: document.querySelector('#rankIndicator'),
  toast: document.querySelector('#toast'),
  watchView: document.querySelector('#watchView'),
  watchPlayer: document.querySelector('#watchPlayer'),
  watchBoard: document.querySelector('#watchBoard'),
  watchProgress: document.querySelector('#watchProgress'),
  finishOverlay: document.querySelector('#finishOverlay'),
  finishMessage: document.querySelector('#finishMessage'),
  dismissFinish: document.querySelector('#dismissFinish')
};

for (let value = 1; value <= 9; value += 1) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = String(value);
  button.addEventListener('click', () => submitValue(value));
  el.numbers.append(button);
}

const deleteButton = document.createElement('button');
deleteButton.type = 'button';
deleteButton.className = 'delete-number';
deleteButton.setAttribute('aria-label', 'Remove selected number');
deleteButton.textContent = '×';
deleteButton.addEventListener('click', () => submitValue(0));
el.numbers.append(deleteButton);

el.createGame.addEventListener('click', async () => {
  if (!el.hostName.value.trim()) {
    el.hostName.focus();
    showToast('Enter your name to host a game.');
    return;
  }
  const res = await api('/api/games', {
    method: 'POST',
    body: { difficulty: el.difficulty.value, name: el.hostName.value }
  });
  state.code = res.game.code;
  state.hostToken = res.game.hostToken;
  localStorage.setItem(`sf:hostToken:${state.code}`, state.hostToken);
  if (res.player) {
    state.playerId = res.player.id;
    localStorage.setItem(`sf:playerId:${state.code}`, state.playerId);
  }
  history.replaceState(null, '', withBasePath(`/g/${state.code}`));
  renderRoute();
});

el.copyShareUrl.addEventListener('click', async () => {
  await copyShareUrl();
});

el.joinGame.addEventListener('click', async () => {
  const res = await api(`/api/games/${state.code}/players`, {
    method: 'POST',
    body: { name: el.playerName.value }
  });
  state.playerId = res.player.id;
  localStorage.setItem(`sf:playerId:${state.code}`, state.playerId);
  state.events?.close();
  state.events = null;
  connectEvents();
  await loadState();
});

el.startGame.addEventListener('click', async () => {
  await api(`/api/games/${state.code}/start`, {
    method: 'POST',
    body: { hostToken: state.hostToken }
  });
});

el.toggleScores.addEventListener('click', () => {
  show(el.scores);
});

el.closeScores.addEventListener('click', () => {
  hide(el.scores);
});

el.scores.addEventListener('click', (event) => {
  if (event.target === el.scores) {
    hide(el.scores);
  }
});

el.board.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell || !el.board.contains(cell) || cell.disabled) return;
  state.selected = Number(cell.dataset.index);
  updateBoardSelection();
});

el.watchPlayer.addEventListener('change', () => {
  state.watchingPlayerId = el.watchPlayer.value;
  renderWatch();
});

el.dismissFinish.addEventListener('click', () => {
  hide(el.finishOverlay);
});

renderRoute();

async function renderRoute() {
  if (!state.code) {
    show(el.createView);
    hide(el.lobbyView, el.playView);
    el.title.textContent = 'Play together';
    renderScores([]);
    renderRankIndicator([]);
    return;
  }

  state.hostToken = localStorage.getItem(`sf:hostToken:${state.code}`) || '';
  state.playerId = localStorage.getItem(`sf:playerId:${state.code}`) || '';
  hide(el.createView);
  show(el.lobbyView);
  el.shareUrl.value = `${location.origin}${withBasePath(`/g/${state.code}`)}`;
  el.title.textContent = `Lobby ${state.code}`;
  connectEvents();
  await loadState();
}

async function loadState() {
  if (!state.code) return;
  const suffix = state.playerId ? `?playerId=${encodeURIComponent(state.playerId)}` : '';
  applyServerSnapshot(await api(`/api/games/${state.code}${suffix}`));
  renderSnapshot();
}

function applyServerSnapshot(snapshot) {
  state.snapshot = snapshot;
  state.snapshotReceivedAt = Date.now();
  reconcilePendingMoves(snapshot.player?.board || null);
  state.localBoard = snapshot.player?.board ? boardForDisplay(snapshot.player.board) : null;
}

function reconcilePendingMoves(serverBoard) {
  if (!serverBoard) {
    state.pendingMoves.clear();
    return;
  }
  for (const [cell, move] of state.pendingMoves) {
    if (serverBoard[cell] === move.value) {
      state.pendingMoves.delete(cell);
    }
  }
}

function boardForDisplay(serverBoard) {
  const board = serverBoard.slice();
  for (const [cell, move] of state.pendingMoves) {
    board[cell] = move.value;
  }
  return board;
}

function renderSnapshot() {
  const snapshot = state.snapshot;
  if (!snapshot) return;

  const isHost = Boolean(state.hostToken);
  const hasPlayer = Boolean(snapshot.player);
  const players = playersForDisplay(snapshot);
  el.title.textContent = snapshot.game.status === 'playing' ? 'Sudoku Friends' : `Lobby ${snapshot.game.code}`;
  el.startGame.classList.toggle('hidden', !isHost || snapshot.game.status !== 'lobby');
  el.waitingText.classList.toggle('hidden', snapshot.game.status !== 'lobby' || isHost);
  document.querySelector('#joinForm').classList.toggle('hidden', hasPlayer);
  renderWaitingPlayers(snapshot.waitingPlayers || snapshot.players);
  renderScores(players);
  renderRankIndicator(players);
  maybeShowFinishDialog(snapshot);
  updateTimerTick(snapshot.game.status === 'playing');

  if (snapshot.game.status !== 'playing') {
    show(el.lobbyView);
    hide(el.playView);
    hide(el.rankIndicator, el.watchView);
    return;
  }

  hide(el.lobbyView);
  show(el.playView);
  renderBoard(snapshot.game.puzzle, state.localBoard || snapshot.player?.board || snapshot.game.puzzle, el.board);
  renderWatch();
}

function renderWaitingPlayers(players) {
  el.waitingPlayers.replaceChildren();
  el.waitingPlayersCount.textContent = String(players.length);
  if (players.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'waiting-empty muted';
    empty.textContent = 'No players have joined yet.';
    el.waitingPlayers.append(empty);
    return;
  }

  players.forEach((player) => {
    const row = document.createElement('div');
    row.className = `waiting-player${player.id === state.playerId ? ' is-current' : ''}`;

    const avatar = document.createElement('span');
    avatar.className = 'waiting-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initialsFor(player.name);

    const name = document.createElement('strong');
    name.textContent = player.name;

    row.append(avatar, name);
    el.waitingPlayers.append(row);
  });
}

function renderBoard(puzzle, board, target) {
  const puzzleKey = puzzle.join('');
  const keyName = target === el.watchBoard ? 'renderedWatchPuzzleKey' : 'renderedPuzzleKey';
  const boardKey = board.join('');
  const boardKeyName = target === el.watchBoard ? 'renderedWatchBoardKey' : 'renderedBoardKey';
  if (state[keyName] === puzzleKey && state[boardKeyName] === boardKey && target.children.length === 81) {
    if (target === el.board) {
      updateBoardSelection();
    }
    return;
  }

  if (state[keyName] !== puzzleKey || target.children.length !== 81) {
    target.replaceChildren();
    board.forEach((_, index) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.index = String(index);
      target.append(cell);
    });
    state[keyName] = puzzleKey;
  }
  state[boardKeyName] = boardKey;

  board.forEach((value, index) => {
    const cell = target.children[index];
    cell.textContent = value === 0 ? '' : String(value);
    cell.disabled = target === el.watchBoard || puzzle[index] !== 0;
    cell.classList.toggle('given', puzzle[index] !== 0);
    cell.classList.toggle('selected', target === el.board && state.selected === index);
  });
  clearInvalidSelection(puzzle);
}

function updateBoardSelection() {
  [...el.board.children].forEach((cell) => {
    cell.classList.toggle('selected', Number(cell.dataset.index) === state.selected);
  });
}

function clearInvalidSelection(puzzle) {
  if (state.selected === null) return;
  if (!Number.isInteger(state.selected) || puzzle[state.selected] !== 0) {
    state.selected = null;
    updateBoardSelection();
  }
}

function renderScores(players) {
  el.scoreList.replaceChildren();
  if (players.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'score-empty muted';
    empty.textContent = 'Rankings appear once players join.';
    el.scoreList.append(empty);
    return;
  }

  players.forEach((player, index) => {
    const position = index + 1;
    const row = document.createElement('div');
    row.className = `score-row rank-${position <= 3 ? position : 'standard'}${player.id === state.playerId ? ' is-current' : ''}`;

    const badge = document.createElement('div');
    badge.className = 'score-place';
    badge.setAttribute('aria-label', `${ordinal(position)} place`);
    badge.append(rankIcon(position));

    const header = document.createElement('div');
    header.className = 'score-header';

    const identity = document.createElement('div');
    identity.className = 'score-identity';

    const name = document.createElement('strong');
    name.textContent = player.name;

    const rankLabel = document.createElement('span');
    rankLabel.textContent = ordinal(position);
    identity.append(name, rankLabel);

    const status = document.createElement('span');
    status.className = player.correct ? 'status solved' : 'status';
    status.textContent = player.correct ? 'Solved' : player.completed ? 'Full' : `${player.progress.percent}%`;

    header.append(identity, status);

    const progress = document.createElement('div');
    progress.className = 'score-progress';
    progress.setAttribute('aria-label', `${player.name} progress ${player.progress.percent}%`);
    const bar = document.createElement('span');
    bar.style.width = `${player.progress.percent}%`;
    progress.append(bar);

    const meta = document.createElement('div');
    meta.className = 'score-meta';
    meta.append(
      metaItem('Filled', `${player.progress.filled}/${player.progress.total}`),
      metaItem('Time', formatDuration(player.timer?.elapsedSeconds || 0)),
      metaItem('Points', String(player.points || 0))
    );

    if (player.correct) {
      const rank = document.createElement('div');
      rank.className = 'score-rank';
      rank.textContent = player.finishRank ? `#${player.finishRank} correct` : 'Correct';
      row.append(badge, header, progress, meta, rank);
    } else {
      row.append(badge, header, progress, meta);
    }
    el.scoreList.append(row);
  });
}

function renderRankIndicator(players) {
  const currentIndex = players.findIndex((player) => player.id === state.playerId);
  if (currentIndex === -1) {
    hide(el.rankIndicator);
    return;
  }
  const current = players[currentIndex];
  el.rankIndicator.textContent = `${ordinal(currentIndex + 1)} · ${current.points || 0} pts · ${current.progress.percent}%`;
  show(el.rankIndicator);
}

function renderWatch() {
  const snapshot = state.snapshot;
  const current = snapshot?.players.find((player) => player.id === state.playerId);
  if (!snapshot?.watch?.canWatch || !current?.correct || !snapshot.game.puzzle) {
    hide(el.watchView);
    state.watchingPlayerId = '';
    return;
  }

  const watchablePlayers = snapshot.players.filter((player) => player.id !== state.playerId);
  if (watchablePlayers.length === 0) {
    hide(el.watchView);
    return;
  }

  if (!watchablePlayers.some((player) => player.id === state.watchingPlayerId)) {
    state.watchingPlayerId = watchablePlayers[0].id;
  }

  el.watchPlayer.replaceChildren(
    ...watchablePlayers.map((player) => {
      const option = document.createElement('option');
      option.value = player.id;
      option.textContent = player.name;
      option.selected = player.id === state.watchingPlayerId;
      return option;
    })
  );

  const board = snapshot.watch.boards.find((watchBoard) => watchBoard.playerId === state.watchingPlayerId);
  const player = snapshot.players.find((item) => item.id === state.watchingPlayerId);
  if (!board || !player) {
    hide(el.watchView);
    return;
  }

  renderBoard(snapshot.game.puzzle, board.board, el.watchBoard);
  el.watchProgress.textContent = `${player.progress.filled}/${player.progress.total} · ${player.progress.percent}%`;
  show(el.watchView);
}

function playersForDisplay(snapshot) {
  const players = snapshot.players.map((player) => ({
    ...player,
    progress: { ...player.progress },
    timer: tickedTimer(player.timer)
  }));
  const current = players.find((player) => player.id === state.playerId);
  if (current && snapshot.game.puzzle && state.localBoard) {
    current.progress = progressFor(state.localBoard, snapshot.game.puzzle);
  }
  return players.sort((left, right) => {
    if ((right.points || 0) !== (left.points || 0)) return (right.points || 0) - (left.points || 0);
    if (left.finishRank && right.finishRank) return left.finishRank - right.finishRank;
    if (left.finishRank) return -1;
    if (right.finishRank) return 1;
    return right.progress.percent - left.progress.percent;
  });
}

function tickedTimer(timer) {
  const copy = { ...(timer || { elapsedSeconds: 0, finished: false }) };
  if (!copy.finished && state.snapshot?.game.status === 'playing' && state.snapshotReceivedAt) {
    copy.elapsedSeconds += Math.floor((Date.now() - state.snapshotReceivedAt) / 1000);
  }
  return copy;
}

function progressFor(board, puzzle) {
  const total = puzzle.reduce((count, value) => count + (value === 0 ? 1 : 0), 0);
  const filled = board.reduce((count, value, index) => count + (puzzle[index] === 0 && value !== 0 ? 1 : 0), 0);
  return {
    filled,
    total,
    percent: total === 0 ? 100 : Math.floor((filled / total) * 100)
  };
}

function ordinal(value) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th';
  return `${value}${suffix}`;
}

function initialsFor(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

function metaItem(label, value) {
  const item = document.createElement('span');
  const labelNode = document.createElement('small');
  labelNode.textContent = label;
  const valueNode = document.createElement('b');
  valueNode.textContent = value;
  item.append(labelNode, valueNode);
  return item;
}

function rankIcon(position) {
  const icon = document.createElement('span');
  icon.className = 'rank-icon';
  icon.textContent = { 1: '🥇', 2: '🥈', 3: '🥉' }[position] || String(position);
  return icon;
}

async function submitValue(value) {
  if (state.selected === null || !state.playerId) return;
  const snapshot = state.snapshot;
  const puzzle = snapshot?.game.puzzle;
  if (!snapshot?.player?.board || !puzzle || puzzle[state.selected] !== 0) return;

  const cell = state.selected;
  const seq = state.moveSeq + 1;
  const rollbackBoard = (state.localBoard || snapshot.player.board).slice();
  state.moveSeq = seq;
  state.pendingMoves.set(cell, { seq, value, rollbackBoard });
  state.localBoard = rollbackBoard.slice();
  state.localBoard[cell] = value;
  el.result.textContent = '';
  renderSnapshot();

  try {
    const res = await api(`/api/games/${state.code}/moves`, {
      method: 'POST',
      body: { playerId: state.playerId, cell, value }
    });
    const pending = state.pendingMoves.get(cell);
    if (pending?.seq === seq && state.snapshot?.player?.board?.[cell] === value) {
      state.pendingMoves.delete(cell);
    }
    if (seq === state.moveSeq && res.complete) {
      el.result.textContent = res.correct ? 'Solved correctly.' : 'Board is full, but not correct.';
    }
  } catch (error) {
    const pending = state.pendingMoves.get(cell);
    if (pending?.seq === seq) {
      state.pendingMoves.delete(cell);
      state.localBoard = pending.rollbackBoard.slice();
      for (const [pendingCell, move] of state.pendingMoves) {
        state.localBoard[pendingCell] = move.value;
      }
      renderSnapshot();
    }
    showToast(error.message || 'Move was not saved.');
  }
}

function updateTimerTick(active) {
  if (!active) {
    clearTimerTick();
    return;
  }
  if (state.timerTick) return;
  state.timerTick = setInterval(() => {
    if (!state.snapshot || state.snapshot.game.status !== 'playing') {
      clearTimerTick();
      return;
    }
    renderSnapshot();
  }, 1000);
}

function clearTimerTick() {
  if (state.timerTick) {
    clearInterval(state.timerTick);
    state.timerTick = null;
  }
}

function maybeShowFinishDialog(snapshot) {
  if (!state.playerId || !snapshot.player) return;
  const current = snapshot.players.find((player) => player.id === state.playerId);
  if (!current?.correct) return;

  const storageKey = `sf:finishShown:${state.code}:${state.playerId}`;
  if (localStorage.getItem(storageKey)) return;
  localStorage.setItem(storageKey, '1');

  el.finishMessage.textContent = `${formatDuration(current.timer?.elapsedSeconds || 0)} · ${current.points || 0} points`;
  show(el.finishOverlay);
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remaining = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(remaining)}`;
  }
  return `${minutes}:${pad2(remaining)}`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

async function copyShareUrl() {
  const url = el.shareUrl.value;
  let copied = false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      copied = false;
    }
  }

  if (!copied) {
    el.shareUrl.removeAttribute('readonly');
    el.shareUrl.focus();
    el.shareUrl.select();
    el.shareUrl.setSelectionRange(0, url.length);
    try {
      document.execCommand('copy');
      copied = true;
    } finally {
      el.shareUrl.setAttribute('readonly', '');
    }
  }

  if (copied) {
    el.copyShareUrl.textContent = 'Copied';
    setTimeout(() => {
      setCopyButtonLabel();
    }, 1400);
  }
}

function setCopyButtonLabel() {
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '⧉';
  el.copyShareUrl.replaceChildren(icon, 'Copy');
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  el.toast.textContent = message;
  show(el.toast);
  state.toastTimer = setTimeout(() => {
    hide(el.toast);
  }, 2600);
}

function connectEvents() {
  if (!state.code || state.events) return;
  const suffix = state.playerId ? `?playerId=${encodeURIComponent(state.playerId)}` : '';
  state.events = new EventSource(withBasePath(`/api/games/${state.code}/events${suffix}`));
  state.events.addEventListener('state', (event) => {
    applyServerSnapshot(JSON.parse(event.data));
    renderSnapshot();
  });
  state.events.addEventListener('error', () => {
    state.events?.close();
    state.events = null;
    setTimeout(connectEvents, 1200);
  });
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(withBasePath(path), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || `Request failed: ${res.status}`);
  }
  return payload;
}

function detectBasePath(pathname) {
  return pathname === '/sudoku' || pathname.startsWith('/sudoku/') ? '/sudoku' : '';
}

function stripBasePath(pathname) {
  return basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) || '/' : pathname;
}

function withBasePath(path) {
  return `${basePath}${path}`;
}

function show(...nodes) {
  nodes.forEach((node) => node.classList.remove('hidden'));
}

function hide(...nodes) {
  nodes.forEach((node) => node.classList.add('hidden'));
}
