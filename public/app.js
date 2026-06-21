const basePath = detectBasePath(location.pathname);
const routePath = stripBasePath(location.pathname);

const state = {
  code: routePath.startsWith('/g/') ? routePath.split('/').pop() : null,
  hostToken: '',
  playerId: '',
  selected: null,
  snapshot: null,
  events: null
};

const el = {
  title: document.querySelector('#title'),
  createView: document.querySelector('#createView'),
  lobbyView: document.querySelector('#lobbyView'),
  playView: document.querySelector('#playView'),
  scores: document.querySelector('#scores'),
  scoreList: document.querySelector('#scoreList'),
  difficulty: document.querySelector('#difficulty'),
  createGame: document.querySelector('#createGame'),
  shareUrl: document.querySelector('#shareUrl'),
  copyShareUrl: document.querySelector('#copyShareUrl'),
  playerName: document.querySelector('#playerName'),
  joinGame: document.querySelector('#joinGame'),
  startGame: document.querySelector('#startGame'),
  waitingText: document.querySelector('#waitingText'),
  board: document.querySelector('#board'),
  numbers: document.querySelector('#numbers'),
  result: document.querySelector('#result'),
  toggleScores: document.querySelector('#toggleScores')
};

for (let value = 1; value <= 9; value += 1) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = String(value);
  button.addEventListener('click', () => submitValue(value));
  el.numbers.append(button);
}

el.createGame.addEventListener('click', async () => {
  const res = await api('/api/games', {
    method: 'POST',
    body: { difficulty: el.difficulty.value }
  });
  state.code = res.game.code;
  state.hostToken = res.game.hostToken;
  localStorage.setItem(`sf:hostToken:${state.code}`, state.hostToken);
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
  el.scores.classList.toggle('hidden-local');
});

renderRoute();

async function renderRoute() {
  if (!state.code) {
    show(el.createView);
    hide(el.lobbyView, el.playView);
    el.title.textContent = 'Play together';
    renderScores([]);
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
  state.snapshot = await api(`/api/games/${state.code}${suffix}`);
  renderSnapshot();
}

function renderSnapshot() {
  const snapshot = state.snapshot;
  if (!snapshot) return;

  const isHost = Boolean(state.hostToken);
  const hasPlayer = Boolean(snapshot.player);
  el.title.textContent = snapshot.game.status === 'playing' ? 'Sudoku Friends' : `Lobby ${snapshot.game.code}`;
  el.startGame.classList.toggle('hidden', !isHost || snapshot.game.status !== 'lobby');
  el.waitingText.classList.toggle('hidden', snapshot.game.status !== 'lobby' || isHost);
  document.querySelector('#joinForm').classList.toggle('hidden', hasPlayer);
  renderScores(snapshot.players);

  if (snapshot.game.status !== 'playing') {
    show(el.lobbyView);
    hide(el.playView);
    return;
  }

  hide(el.lobbyView);
  show(el.playView);
  renderBoard(snapshot.game.puzzle, snapshot.player?.board || snapshot.game.puzzle);
}

function renderBoard(puzzle, board) {
  el.board.replaceChildren();
  board.forEach((value, index) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.textContent = value === 0 ? '' : String(value);
    if (puzzle[index] !== 0) {
      cell.classList.add('given');
      cell.disabled = true;
    } else {
      cell.addEventListener('click', () => {
        state.selected = index;
        renderBoard(puzzle, board);
      });
    }
    if (state.selected === index) {
      cell.classList.add('selected');
    }
    el.board.append(cell);
  });
}

function renderScores(players) {
  el.scoreList.replaceChildren();
  for (const player of players) {
    const row = document.createElement('div');
    row.className = 'score-row';
    const status = player.completed ? (player.correct ? 'correct' : 'full') : '';
    row.innerHTML = `<strong></strong><span></span>`;
    row.querySelector('strong').textContent = player.name;
    row.querySelector('span').textContent = `${player.progress.filled}/${player.progress.total} ${status}`.trim();
    el.scoreList.append(row);
  }
}

async function submitValue(value) {
  if (state.selected === null || !state.playerId) return;
  const res = await api(`/api/games/${state.code}/moves`, {
    method: 'POST',
    body: { playerId: state.playerId, cell: state.selected, value }
  });
  if (res.complete) {
    el.result.textContent = res.correct ? 'Solved correctly.' : 'Board is full, but not correct.';
  } else {
    el.result.textContent = '';
  }
  await loadState();
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
      el.copyShareUrl.textContent = 'Copy';
    }, 1400);
  }
}

function connectEvents() {
  if (!state.code || state.events) return;
  const suffix = state.playerId ? `?playerId=${encodeURIComponent(state.playerId)}` : '';
  state.events = new EventSource(withBasePath(`/api/games/${state.code}/events${suffix}`));
  state.events.addEventListener('state', (event) => {
    state.snapshot = JSON.parse(event.data);
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
