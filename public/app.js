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
  localBoard: null,
  localBoardDirty: false,
  syncInFlight: false,
  syncRetryTimer: null,
  syncRetryDelay: 1000,
  syncStatus: 'synced',
  toastTimer: null,
  watchingPlayerId: '',
  hubTab: 'game',
  watchMode: 'live',
  watchReplayTimer: null,
  watchReplayIndex: 0,
  undoHistory: [],
  confirmAction: null,
  reviewPlayerId: '',
  replayTimer: null,
  replayIndex: 0
};

const el = {
  title: document.querySelector('#title'),
  createView: document.querySelector('#createView'),
  lobbyView: document.querySelector('#lobbyView'),
  playView: document.querySelector('#playView'),
  gameHub: document.querySelector('#gameHub'),
  hubGameTab: document.querySelector('#hubGameTab'),
  hubWatchTab: document.querySelector('#hubWatchTab'),
  hubScoreboardTab: document.querySelector('#hubScoreboardTab'),
  hubGamePanel: document.querySelector('#hubGamePanel'),
  hubWatchPanel: document.querySelector('#hubWatchPanel'),
  hubScoreboardPanel: document.querySelector('#hubScoreboardPanel'),
  hubDetailPanel: document.querySelector('#hubDetailPanel'),
  hubGameSummary: document.querySelector('#hubGameSummary'),
  hubWatchLocked: document.querySelector('#hubWatchLocked'),
  hubWatchStage: document.querySelector('#hubWatchStage'),
  hubPrevPlayer: document.querySelector('#hubPrevPlayer'),
  hubNextPlayer: document.querySelector('#hubNextPlayer'),
  hubWatchName: document.querySelector('#hubWatchName'),
  hubWatchProgress: document.querySelector('#hubWatchProgress'),
  hubWatchBoard: document.querySelector('#hubWatchBoard'),
  hubLiveToggle: document.querySelector('#hubLiveToggle'),
  hubResetReplay: document.querySelector('#hubResetReplay'),
  hubPrevStep: document.querySelector('#hubPrevStep'),
  hubPlayReplay: document.querySelector('#hubPlayReplay'),
  hubNextStep: document.querySelector('#hubNextStep'),
  scoreList: document.querySelector('#scoreList'),
  closeHub: document.querySelector('#closeHub'),
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
  syncStatus: document.querySelector('#syncStatus'),
  result: document.querySelector('#result'),
  toggleScores: document.querySelector('#toggleScores'),
  rankBadge: document.querySelector('#rankBadge'),
  rewindMistake: document.querySelector('#rewindMistake'),
  giveUp: document.querySelector('#giveUp'),
  toast: document.querySelector('#toast'),
  finishOverlay: document.querySelector('#finishOverlay'),
  finishMessage: document.querySelector('#finishMessage'),
  dismissFinish: document.querySelector('#dismissFinish'),
  confirmOverlay: document.querySelector('#confirmOverlay'),
  confirmTitle: document.querySelector('#confirmTitle'),
  confirmMessage: document.querySelector('#confirmMessage'),
  cancelConfirm: document.querySelector('#cancelConfirm'),
  acceptConfirm: document.querySelector('#acceptConfirm'),
  reviewTitle: document.querySelector('#reviewTitle'),
  reviewTimeline: document.querySelector('#reviewTimeline'),
  reviewBoard: document.querySelector('#reviewBoard'),
  detailSummary: document.querySelector('#detailSummary'),
  closeReview: document.querySelector('#closeReview'),
  playReplay: document.querySelector('#playReplay'),
  previousReplay: document.querySelector('#previousReplay'),
  nextReplay: document.querySelector('#nextReplay'),
  resetReplay: document.querySelector('#resetReplay')
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

const undoButton = document.createElement('button');
undoButton.type = 'button';
undoButton.className = 'undo-number';
undoButton.setAttribute('aria-label', 'Undo last local edit');
undoButton.textContent = '↶';
undoButton.addEventListener('click', undoLocalEdit);
el.numbers.append(undoButton);

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
  openHub('scoreboard');
});

el.closeHub.addEventListener('click', () => {
  closeHub();
});

el.gameHub.addEventListener('click', (event) => {
  if (event.target === el.gameHub) {
    closeHub();
  }
});

for (const tab of [el.hubGameTab, el.hubWatchTab, el.hubScoreboardTab]) {
  tab.addEventListener('click', () => {
    setHubTab(tab.dataset.hubTab);
  });
}

el.board.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell || !el.board.contains(cell) || cell.disabled) return;
  state.selected = Number(cell.dataset.index);
  updateBoardSelection();
});

el.dismissFinish.addEventListener('click', () => {
  hide(el.finishOverlay);
});

el.rewindMistake.addEventListener('click', () => {
  openConfirm({
    title: 'Rewind mistake',
    message: 'Rewind to before your first incorrect move? This costs 30 points.',
    confirmText: 'Rewind',
    action: rewindMistake
  });
});

el.giveUp.addEventListener('click', () => {
  openConfirm({
    title: 'Give up',
    message: 'Stop playing at your current progress and watch the rest of the game?',
    confirmText: 'Give up',
    action: giveUp
  });
});

el.cancelConfirm.addEventListener('click', closeConfirm);
el.acceptConfirm.addEventListener('click', async () => {
  const action = state.confirmAction;
  closeConfirm();
  if (action) {
    await action();
  }
});

el.closeReview.addEventListener('click', () => {
  stopReplay();
  state.reviewPlayerId = '';
  setHubTab('scoreboard');
});

el.playReplay.addEventListener('click', playReplay);
el.previousReplay.addEventListener('click', () => stepReplay(-1));
el.nextReplay.addEventListener('click', () => stepReplay(1));
el.resetReplay.addEventListener('click', resetReplay);

el.hubPrevPlayer.addEventListener('click', () => selectWatchedPlayer(-1));
el.hubNextPlayer.addEventListener('click', () => selectWatchedPlayer(1));
el.hubLiveToggle.addEventListener('click', toggleWatchLive);
el.hubResetReplay.addEventListener('click', resetWatchReplay);
el.hubPrevStep.addEventListener('click', () => stepWatchReplay(-1));
el.hubNextStep.addEventListener('click', () => stepWatchReplay(1));
el.hubPlayReplay.addEventListener('click', playWatchReplay);

window.addEventListener('online', () => {
  queueBoardSync({ immediate: true });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    queueBoardSync({ immediate: true });
  }
});

renderRoute();

async function renderRoute() {
  if (!state.code) {
    show(el.createView);
    hide(el.lobbyView, el.playView);
    el.title.textContent = 'Play together';
    renderScores([]);
    renderRankBadge([]);
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
  const serverBoard = snapshot.player?.board || null;
  if (!serverBoard) {
    state.localBoard = null;
    state.localBoardDirty = false;
    state.undoHistory = [];
    setSyncStatus('synced');
    return;
  }

  if (isCurrentPlayerLocked()) {
    state.undoHistory = [];
    markBoardSynced(serverBoard);
    return;
  }

  const persisted = loadPersistedBoard();
  if (persisted?.dirty) {
    state.localBoard = persisted.board;
    state.localBoardDirty = true;
  }

  if (state.localBoardDirty && state.localBoard) {
    if (boardsEqual(state.localBoard, serverBoard)) {
      markBoardSynced(serverBoard);
    } else {
      setSyncStatus(state.syncInFlight ? 'saving' : navigator.onLine === false ? 'offline' : 'retrying');
      queueBoardSync();
    }
    return;
  }

  state.localBoard = persisted?.board || serverBoard.slice();
  state.localBoardDirty = Boolean(persisted?.dirty);
  if (!state.localBoardDirty) {
    clearPersistedBoard();
    setSyncStatus('synced');
  }
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
  renderRankBadge(players);
  renderHub();
  maybeShowFinishDialog(snapshot);
  updateTimerTick(snapshot.game.status === 'playing');

  if (snapshot.game.status !== 'playing') {
    show(el.lobbyView);
    hide(el.playView);
    return;
  }

  hide(el.lobbyView);
  show(el.playView);
  renderBoard(snapshot.game.puzzle, state.localBoard || snapshot.player?.board || snapshot.game.puzzle, el.board);
  renderGameActions(snapshot);
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

function renderBoard(puzzle, board, target, { wrongCells = new Set() } = {}) {
  const puzzleKey = puzzle.join('');
  const boardKey = board.join('');
  const wrongKey = [...wrongCells].sort((left, right) => left - right).join(',');
  if (
    target.dataset.puzzleKey === puzzleKey &&
    target.dataset.boardKey === boardKey &&
    target.dataset.wrongKey === wrongKey &&
    target.children.length === 81
  ) {
    if (target === el.board) {
      updateBoardSelection();
    }
    return;
  }

  if (target.dataset.puzzleKey !== puzzleKey || target.children.length !== 81) {
    target.replaceChildren();
    board.forEach((_, index) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.index = String(index);
      target.append(cell);
    });
    target.dataset.puzzleKey = puzzleKey;
  }
  target.dataset.boardKey = boardKey;
  target.dataset.wrongKey = wrongKey;

  board.forEach((value, index) => {
    const cell = target.children[index];
    cell.textContent = value === 0 ? '' : String(value);
    cell.disabled = target !== el.board || puzzle[index] !== 0 || isCurrentPlayerLocked();
    cell.classList.toggle('given', puzzle[index] !== 0);
    cell.classList.toggle('selected', target === el.board && state.selected === index);
    cell.classList.toggle('wrong-replay', wrongCells.has(index));
  });
  clearInvalidSelection(puzzle);
}

function isCurrentPlayerLocked() {
  const current = state.snapshot?.players.find((player) => player.id === state.playerId);
  return Boolean(current?.correct || current?.gaveUp);
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
    status.className = player.correct ? 'status solved' : player.gaveUp ? 'status gave-up' : 'status';
    status.textContent = player.correct ? 'Solved' : player.gaveUp ? 'Gave up' : player.completed ? 'Full' : `${player.progress.percent}%`;

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
    if (canReviewSnapshot()) {
      const reviewButton = document.createElement('button');
      reviewButton.type = 'button';
      reviewButton.className = 'review-button';
      reviewButton.textContent = 'Details';
      reviewButton.addEventListener('click', () => showReview(player.id));
      row.append(reviewButton);
    }
    el.scoreList.append(row);
  });
}

function renderRankBadge(players) {
  const currentIndex = players.findIndex((player) => player.id === state.playerId);
  if (currentIndex === -1) {
    el.rankBadge.textContent = '';
    el.toggleScores.classList.remove('has-rank');
    return;
  }
  const current = players[currentIndex];
  el.rankBadge.textContent = ordinal(currentIndex + 1);
  el.toggleScores.classList.add('has-rank');
  el.toggleScores.setAttribute(
    'aria-label',
    `Toggle rankings, current rank ${ordinal(currentIndex + 1)}, ${current.points || 0} points`
  );
}

function renderGameActions(snapshot) {
  const current = snapshot.players.find((player) => player.id === state.playerId);
  const locked = Boolean(current?.correct || current?.gaveUp);
  el.rewindMistake.disabled = locked || !state.playerId;
  el.giveUp.disabled = locked || !state.playerId;
  [...el.numbers.querySelectorAll('button')].forEach((button) => {
    if (button.classList.contains('undo-number')) {
      button.disabled = locked || state.undoHistory.length === 0;
      return;
    }
    button.disabled = locked;
  });
}

function openHub(tab = 'game') {
  document.body.classList.add('hub-open');
  show(el.gameHub);
  setHubTab(tab);
}

function closeHub() {
  stopReplay();
  stopWatchReplay();
  document.body.classList.remove('hub-open');
  hide(el.gameHub);
}

function setHubTab(tab) {
  state.hubTab = tab;
  if (tab !== 'watch') {
    stopWatchReplay();
  }
  if (tab !== 'detail') {
    stopReplay();
  }
  renderHub();
}

function renderHub() {
  if (!state.snapshot) return;
  const tab = state.hubTab || 'game';
  const isDetail = tab === 'detail';

  el.hubGameTab.classList.toggle('is-active', tab === 'game');
  el.hubWatchTab.classList.toggle('is-active', tab === 'watch');
  el.hubScoreboardTab.classList.toggle('is-active', tab === 'scoreboard' || isDetail);
  el.hubGameTab.setAttribute('aria-selected', String(tab === 'game'));
  el.hubWatchTab.setAttribute('aria-selected', String(tab === 'watch'));
  el.hubScoreboardTab.setAttribute('aria-selected', String(tab === 'scoreboard' || isDetail));

  el.hubGamePanel.classList.toggle('hidden', tab !== 'game');
  el.hubWatchPanel.classList.toggle('hidden', tab !== 'watch');
  el.hubScoreboardPanel.classList.toggle('hidden', tab !== 'scoreboard');
  el.hubDetailPanel.classList.toggle('hidden', !isDetail);

  renderGameSummary();
  renderWatch();
  if (isDetail && state.reviewPlayerId) {
    renderActiveReview();
  }
}

function renderGameSummary() {
  const snapshot = state.snapshot;
  const current = currentPlayer();
  el.hubGameSummary.replaceChildren();

  if (!snapshot?.game || !current) {
    el.hubGameSummary.append(emptyState('Join this game to see your summary here.'));
    return;
  }

  const title = document.createElement('h3');
  title.textContent = current.correct ? 'Solved correctly' : current.gaveUp ? 'Gave up' : 'Game in progress';

  const message = document.createElement('p');
  message.className = 'muted';
  message.textContent =
    current.correct || current.gaveUp
      ? 'Your result is locked in. Use Watch or Scoreboard to review the rest of the game.'
      : 'Finish the puzzle correctly, or give up, to unlock watching and player details.';

  const stats = document.createElement('div');
  stats.className = 'summary-stats';
  stats.append(
    metaItem('Filled', `${current.progress.filled}/${current.progress.total}`),
    metaItem('Progress', `${current.progress.percent}%`),
    metaItem('Time', formatDuration(current.timer?.elapsedSeconds || 0)),
    metaItem('Points', String(current.points || 0))
  );

  el.hubGameSummary.append(title, message, stats);
}

function renderWatch() {
  const snapshot = state.snapshot;
  const current = currentPlayer();
  el.hubWatchLocked.replaceChildren();

  if (!snapshot?.watch?.canWatch || !(current?.correct || current?.gaveUp) || !snapshot.game.puzzle) {
    hide(el.hubWatchStage);
    show(el.hubWatchLocked);
    el.hubWatchLocked.append(emptyState('Watch unlocks after you solve correctly or give up.'));
    state.watchingPlayerId = '';
    return;
  }

  const watchablePlayers = snapshot.players.filter((player) => player.id !== state.playerId);
  if (watchablePlayers.length === 0) {
    hide(el.hubWatchStage);
    show(el.hubWatchLocked);
    el.hubWatchLocked.append(emptyState('No other players to watch yet.'));
    return;
  }

  if (!watchablePlayers.some((player) => player.id === state.watchingPlayerId)) {
    state.watchingPlayerId = watchablePlayers[0].id;
  }

  const board = state.watchMode === 'live' ? liveWatchBoard(state.watchingPlayerId) : replayWatchBoard(state.watchingPlayerId);
  const player = snapshot.players.find((item) => item.id === state.watchingPlayerId);
  if (!board || !player) {
    hide(el.hubWatchStage);
    show(el.hubWatchLocked);
    el.hubWatchLocked.append(emptyState('This player is not available to watch.'));
    return;
  }

  el.hubWatchName.textContent = player.name;
  el.hubWatchProgress.textContent = `${player.progress.filled}/${player.progress.total} · ${player.progress.percent}%`;
  el.hubLiveToggle.classList.toggle('is-active', state.watchMode === 'live');
  el.hubLiveToggle.textContent = state.watchMode === 'live' ? 'Live on' : 'Live';
  el.hubPrevStep.disabled = state.watchMode === 'live';
  el.hubNextStep.disabled = state.watchMode === 'live';
  el.hubPlayReplay.disabled = state.watchMode === 'live';
  el.hubResetReplay.disabled = state.watchMode === 'live';
  const wrongCells = state.watchMode === 'live' ? new Set() : wrongCellsAt(reviewForPlayer(state.watchingPlayerId), state.watchReplayIndex);
  renderBoard(snapshot.game.puzzle, board, el.hubWatchBoard, { wrongCells });
  hide(el.hubWatchLocked);
  show(el.hubWatchStage);
}

function currentPlayer() {
  return state.snapshot?.players.find((player) => player.id === state.playerId) || null;
}

function canReviewSnapshot() {
  const current = currentPlayer();
  return Boolean(state.snapshot?.review?.canReview && (current?.correct || current?.gaveUp));
}

function emptyState(message) {
  const box = document.createElement('div');
  box.className = 'empty-card';
  const title = document.createElement('strong');
  title.textContent = 'Not available yet';
  const text = document.createElement('p');
  text.className = 'muted';
  text.textContent = message;
  box.append(title, text);
  return box;
}

function watchablePlayers() {
  return state.snapshot?.players.filter((player) => player.id !== state.playerId) || [];
}

function selectWatchedPlayer(direction) {
  const players = watchablePlayers();
  if (players.length === 0) return;
  const currentIndex = Math.max(
    0,
    players.findIndex((player) => player.id === state.watchingPlayerId)
  );
  const nextIndex = (currentIndex + direction + players.length) % players.length;
  state.watchingPlayerId = players[nextIndex].id;
  state.watchReplayIndex = 0;
  renderWatch();
}

function liveWatchBoard(playerId) {
  return state.snapshot?.watch?.boards.find((watchBoard) => watchBoard.playerId === playerId)?.board || null;
}

function reviewForPlayer(playerId) {
  return state.snapshot?.review?.players.find((player) => player.playerId === playerId) || null;
}

function replayWatchBoard(playerId) {
  const review = reviewForPlayer(playerId);
  if (!review) return liveWatchBoard(playerId);
  return replayBoardAt(review, state.watchReplayIndex);
}

function toggleWatchLive() {
  state.watchMode = state.watchMode === 'live' ? 'replay' : 'live';
  stopWatchReplay();
  renderWatch();
}

function resetWatchReplay() {
  stopWatchReplay();
  state.watchMode = 'replay';
  state.watchReplayIndex = 0;
  renderWatch();
}

function stepWatchReplay(direction) {
  const review = reviewForPlayer(state.watchingPlayerId);
  if (!review) return;
  stopWatchReplay();
  state.watchMode = 'replay';
  state.watchReplayIndex = clampReplayIndex(review, state.watchReplayIndex + direction);
  renderWatch();
}

function playWatchReplay() {
  const review = reviewForPlayer(state.watchingPlayerId);
  if (!review) return;
  stopWatchReplay();
  state.watchMode = 'replay';
  if (state.watchReplayIndex >= review.replay.moves.length) {
    state.watchReplayIndex = 0;
  }
  state.watchReplayTimer = setInterval(() => {
    const activeReview = reviewForPlayer(state.watchingPlayerId);
    if (!activeReview || state.watchReplayIndex >= activeReview.replay.moves.length) {
      stopWatchReplay();
      renderWatch();
      return;
    }
    state.watchReplayIndex += 1;
    renderWatch();
  }, 180);
}

function stopWatchReplay() {
  if (state.watchReplayTimer) {
    clearInterval(state.watchReplayTimer);
    state.watchReplayTimer = null;
  }
}

function showReview(playerId) {
  const review = state.snapshot?.review?.players.find((player) => player.playerId === playerId);
  if (!review) return;
  stopReplay();
  state.reviewPlayerId = playerId;
  state.replayIndex = 0;
  setHubTab('detail');
}

function renderActiveReview() {
  const review = currentReview();
  if (!review) return;
  const player = state.snapshot?.players.find((item) => item.id === review.playerId);
  el.reviewTitle.textContent = `${review.name} details`;
  el.detailSummary.textContent = player
    ? `${player.progress.percent}% · ${formatDuration(player.timer?.elapsedSeconds || 0)} · ${player.points || 0} points`
    : '';
  renderReviewTimeline(review);
  renderReviewBoard(review, replayBoardAt(review, state.replayIndex));
}

function renderReviewTimeline(review) {
  el.reviewTimeline.replaceChildren();
  if (review.timeline.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No point events yet.';
    el.reviewTimeline.append(empty);
    return;
  }

  for (const event of review.timeline) {
    const row = document.createElement('div');
    row.className = 'timeline-row';
    const title = document.createElement('strong');
    title.textContent = event.label;
    const meta = document.createElement('span');
    meta.textContent = `${formatSignedPoints(event.points)} · total ${event.total}`;
    const time = document.createElement('small');
    time.textContent = formatTimestamp(event.createdAt);
    row.append(title, meta, time);
    el.reviewTimeline.append(row);
  }
}

function renderReviewBoard(review, board) {
  renderBoard(review.replay.puzzle, board, el.reviewBoard, { wrongCells: wrongCellsAt(review, state.replayIndex) });
}

function playReplay() {
  const review = currentReview();
  if (!review) return;
  stopReplay();
  if (state.replayIndex >= review.replay.moves.length) {
    resetReplay();
  }
  state.replayTimer = setInterval(() => {
    const activeReview = currentReview();
    if (!activeReview || state.replayIndex >= activeReview.replay.moves.length) {
      stopReplay();
      return;
    }
    state.replayIndex += 1;
    renderReviewBoard(activeReview, replayBoardAt(activeReview, state.replayIndex));
  }, 180);
}

function stepReplay(direction) {
  const review = currentReview();
  if (!review) return;
  stopReplay();
  state.replayIndex = clampReplayIndex(review, state.replayIndex + direction);
  renderReviewBoard(review, replayBoardAt(review, state.replayIndex));
}

function resetReplay() {
  const review = currentReview();
  if (!review) return;
  stopReplay();
  state.replayIndex = 0;
  renderReviewBoard(review, review.replay.puzzle);
}

function stopReplay() {
  if (state.replayTimer) {
    clearInterval(state.replayTimer);
    state.replayTimer = null;
  }
}

function currentReview() {
  return state.snapshot?.review?.players.find((player) => player.playerId === state.reviewPlayerId) || null;
}

function replayBoardAt(review, moveCount) {
  const board = review.replay.puzzle.slice();
  for (const move of review.replay.moves.slice(0, moveCount)) {
    board[move.cell] = move.value;
  }
  return board;
}

function wrongCellsAt(review, moveCount) {
  const wrongCells = new Set();
  if (!review) return wrongCells;
  for (const move of review.replay.moves.slice(0, moveCount)) {
    wrongCells.delete(move.cell);
    if (move.value !== 0 && move.wrong) {
      wrongCells.add(move.cell);
    }
  }
  return wrongCells;
}

function clampReplayIndex(review, index) {
  return Math.max(0, Math.min(review.replay.moves.length, index));
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
  if (isCurrentPlayerLocked()) return;

  const cell = state.selected;
  const previous = (state.localBoard || snapshot.player.board).slice();
  if (previous[cell] === value) return;
  state.undoHistory.push(previous);
  state.localBoard = previous.slice();
  state.localBoard[cell] = value;
  state.localBoardDirty = true;
  persistLocalBoard(true);
  setSyncStatus(navigator.onLine === false ? 'offline' : 'saving');
  el.result.textContent = '';
  renderSnapshot();
  queueBoardSync({ immediate: true });
}

function undoLocalEdit() {
  if (isCurrentPlayerLocked()) return;
  const previous = state.undoHistory.pop();
  if (!previous) return;
  state.localBoard = previous.slice();
  state.localBoardDirty = true;
  persistLocalBoard(true);
  setSyncStatus(navigator.onLine === false ? 'offline' : 'saving');
  el.result.textContent = '';
  renderSnapshot();
  queueBoardSync({ immediate: true });
}

function queueBoardSync({ immediate = false } = {}) {
  if (!state.localBoardDirty || !state.localBoard || !state.playerId || !state.code) {
    return;
  }
  if (state.syncRetryTimer) {
    clearTimeout(state.syncRetryTimer);
    state.syncRetryTimer = null;
  }
  if (navigator.onLine === false) {
    setSyncStatus('offline');
    state.syncRetryTimer = setTimeout(() => {
      state.syncRetryTimer = null;
      queueBoardSync({ immediate: true });
    }, state.syncRetryDelay);
    state.syncRetryDelay = nextRetryDelay();
    return;
  }
  state.syncRetryTimer = setTimeout(() => {
    state.syncRetryTimer = null;
    syncLocalBoard();
  }, immediate ? 0 : state.syncRetryDelay);
  if (!immediate) {
    state.syncRetryDelay = nextRetryDelay();
  }
}

async function syncLocalBoard() {
  if (state.syncInFlight || !state.localBoardDirty || !state.localBoard || !state.playerId || !state.code) {
    return;
  }
  if (navigator.onLine === false) {
    queueBoardSync();
    return;
  }

  state.syncInFlight = true;
  setSyncStatus('saving');
  const board = state.localBoard.slice();
  try {
    const res = await api(`/api/games/${state.code}/board`, {
      method: 'PUT',
      body: { playerId: state.playerId, board }
    });
    if (boardsEqual(state.localBoard, board)) {
      markBoardSynced(res.board || board);
    } else {
      queueBoardSync({ immediate: true });
    }
    if (boardsEqual(state.localBoard, board) && res.complete) {
      el.result.textContent = res.correct ? 'Solved correctly.' : 'Board is full, but not correct.';
    }
  } catch (error) {
    if (isClientSyncError(error)) {
      showToast(error.message || 'Board was rejected.');
      try {
        await reconcileFromServer();
      } catch (reconcileError) {
        showToast(reconcileError.message || 'Could not reload board.');
      }
    } else {
      setSyncStatus(navigator.onLine === false ? 'offline' : 'retrying');
      queueBoardSync();
    }
  } finally {
    state.syncInFlight = false;
    if (state.localBoardDirty && !state.syncRetryTimer) {
      queueBoardSync();
    }
    renderSyncStatus();
  }
}

function markBoardSynced(board) {
  state.localBoard = board.slice();
  state.localBoardDirty = false;
  state.syncRetryDelay = 1000;
  clearPersistedBoard();
  setSyncStatus('synced');
}

async function reconcileFromServer() {
  const suffix = state.playerId ? `?playerId=${encodeURIComponent(state.playerId)}` : '';
  const snapshot = await api(`/api/games/${state.code}${suffix}`);
  clearPersistedBoard();
  state.localBoardDirty = false;
  state.syncRetryDelay = 1000;
  state.localBoard = snapshot.player?.board ? snapshot.player.board.slice() : null;
  applyServerSnapshot(snapshot);
  renderSnapshot();
}

function isClientSyncError(error) {
  return error.status >= 400 && error.status < 500;
}

function persistLocalBoard(dirty) {
  const key = localBoardStorageKey();
  if (!key || !state.localBoard) return;
  localStorage.setItem(
    key,
    JSON.stringify({
      board: state.localBoard,
      dirty,
      updatedAt: Date.now()
    })
  );
}

function loadPersistedBoard() {
  const key = localBoardStorageKey();
  if (!key) return null;
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (!value?.dirty || !Array.isArray(value.board) || value.board.length !== 81) {
      return null;
    }
    const board = value.board.map((cell) => Number(cell));
    if (board.some((cell) => !Number.isInteger(cell) || cell < 0 || cell > 9)) {
      clearPersistedBoard();
      return null;
    }
    return { board, dirty: true };
  } catch {
    clearPersistedBoard();
    return null;
  }
}

function clearPersistedBoard() {
  const key = localBoardStorageKey();
  if (key) {
    localStorage.removeItem(key);
  }
}

function localBoardStorageKey() {
  return state.code && state.playerId ? `sf:board:${state.code}:${state.playerId}` : '';
}

function boardsEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function nextRetryDelay() {
  const delay = state.syncRetryDelay;
  return Math.min(30000, Math.max(1000, delay * 2));
}

function setSyncStatus(status) {
  state.syncStatus = status;
  renderSyncStatus();
}

function renderSyncStatus() {
  el.syncStatus.classList.remove('is-saving', 'is-offline', 'is-error');
  if (state.syncStatus === 'synced' || !state.localBoardDirty) {
    el.syncStatus.textContent = '';
    hide(el.syncStatus);
    return;
  }
  const labels = {
    saving: 'Saving...',
    offline: 'Offline - retrying',
    retrying: 'Retrying save...'
  };
  el.syncStatus.textContent = labels[state.syncStatus] || 'Retrying save...';
  el.syncStatus.classList.add(state.syncStatus === 'saving' ? 'is-saving' : 'is-offline');
  show(el.syncStatus);
}

async function rewindMistake() {
  if (!state.code || !state.playerId) return;
  try {
    await flushPendingBoard();
    const res = await api(`/api/games/${state.code}/rewind-mistake`, {
      method: 'POST',
      body: { playerId: state.playerId }
    });
    state.undoHistory = [];
    if (res.board) {
      markBoardSynced(res.board);
    }
    el.result.textContent = res.message || (res.rewound ? 'Rewound.' : 'No incorrect moves found.');
    await loadState();
  } catch (error) {
    showToast(error.message || 'Could not rewind.');
  }
}

async function giveUp() {
  if (!state.code || !state.playerId) return;
  try {
    await flushPendingBoard();
    await api(`/api/games/${state.code}/give-up`, {
      method: 'POST',
      body: { playerId: state.playerId }
    });
    state.undoHistory = [];
    clearPersistedBoard();
    state.localBoardDirty = false;
    el.result.textContent = 'You gave up. You can watch the rest of the game.';
    await loadState();
  } catch (error) {
    showToast(error.message || 'Could not give up.');
  }
}

async function flushPendingBoard() {
  if (!state.localBoardDirty) return;
  await syncLocalBoard();
}

function openConfirm({ title, message, confirmText, action }) {
  state.confirmAction = action;
  el.confirmTitle.textContent = title;
  el.confirmMessage.textContent = message;
  el.acceptConfirm.textContent = confirmText;
  show(el.confirmOverlay);
}

function closeConfirm() {
  state.confirmAction = null;
  hide(el.confirmOverlay);
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

function formatSignedPoints(points) {
  const value = Number(points) || 0;
  return value > 0 ? `+${value}` : String(value);
}

function formatTimestamp(value) {
  if (!value) return '';
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
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
    queueBoardSync({ immediate: true });
  });
  state.events.addEventListener('error', () => {
    state.events?.close();
    state.events = null;
    if (state.localBoardDirty) {
      setSyncStatus(navigator.onLine === false ? 'offline' : 'retrying');
      queueBoardSync();
    }
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
    const error = new Error(payload.error || `Request failed: ${res.status}`);
    error.status = res.status;
    throw error;
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
