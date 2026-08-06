'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggleBtn = document.getElementById('theme-toggle');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let gridColor = '#22222e';

const THEME_KEY = 'tetris-theme';

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch (e) {
    return null;
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) {
    // localStorage no disponible (p. ej. modo privado); no persistir
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const isLight = theme === 'light';
  themeToggleBtn.querySelector('span').textContent = isLight ? '☀️' : '🌙';
  themeToggleBtn.setAttribute('aria-pressed', String(isLight));
  themeToggleBtn.setAttribute('aria-label', isLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid-line').trim();
}

function initTheme() {
  applyTheme(getStoredTheme() === 'light' ? 'light' : 'dark');
}

themeToggleBtn.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(next);
  storeTheme(next);
});

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
  if (mp.enabled && mp.myTurn) {
    if (gameOver) {
      mpSend('game-over', { state: snapshotState() });
    } else {
      mpSend('turn-change', { state: snapshotState() });
      setMyTurn(false);
    }
  }
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;

  // Centrar por la caja delimitadora de celdas no vacías, no por el tamaño
  // de la matriz: piezas como la T (3x3 con la última fila vacía) quedaban
  // descolgadas en la caja al centrar sobre la matriz completa.
  let minR = shape.length, maxR = -1, minC = shape[0].length, maxC = -1;
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
  const boundW = maxC - minC + 1;
  const boundH = maxR - minR + 1;
  const offX = (4 - boundW) / 2 - minC;
  const offY = (4 - boundH) / 2 - minR;

  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = mp.enabled
    ? `Puntuación compartida: ${score.toLocaleString()}`
    : `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  if (mp.enabled && !mp.myTurn) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
  if (mp.enabled) mpSend('pause', { paused });
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
      mpSyncIfActive();
    } else {
      lockPiece();
      if (gameOver) return;
    }
  }
  draw();
  if (!gameOver) animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

function moveLeft() {
  if (!collide(current.shape, current.x - 1, current.y)) current.x--;
}

function moveRight() {
  if (!collide(current.shape, current.x + 1, current.y)) current.x++;
}

function rotatePiece() {
  tryRotate();
}

function softDropAction() {
  softDrop();
}

function hardDropAction() {
  hardDrop();
}

document.addEventListener('keydown', e => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
  if (mpModal && !mpModal.classList.contains('hidden')) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  if (mp.enabled && !mp.myTurn) return;
  switch (e.code) {
    case 'ArrowLeft':
      moveLeft();
      break;
    case 'ArrowRight':
      moveRight();
      break;
    case 'ArrowDown':
      softDropAction();
      break;
    case 'ArrowUp':
    case 'KeyX':
      rotatePiece();
      break;
    case 'Space':
      e.preventDefault();
      hardDropAction();
      break;
  }
  updateHUD();
  mpSyncIfActive();
});

restartBtn.addEventListener('click', () => {
  if (mp.enabled) {
    if (!mp.isHost) {
      mpSend('restart-request', {});
      mpNotify('Solicitud de revancha enviada al anfitrión.');
      return;
    }
    init();
    mpSend('start', { state: snapshotState() });
    setMyTurn(true);
  } else {
    init();
  }
});

// ---- Controles táctiles (gestos) ----
// Todas las acciones se controlan por gesto sobre el tablero: no hay
// botonera táctil. deslizar ←→ mueve, deslizar ↓ hace soft drop, un toque
// corto rota, un deslizamiento rápido hacia abajo hace hard drop.
const gameContainer = document.querySelector('.game-container');

const SWIPE_H_THRESHOLD = 28; // px por columna movida
const SWIPE_V_THRESHOLD = 28; // px por paso de soft drop
const TAP_MAX_DURATION = 200; // ms
const TAP_MAX_DISTANCE = 12; // px
const FAST_DROP_MIN_DISTANCE = 80; // px hacia abajo
const FAST_DROP_MAX_DURATION = 250; // ms
const DOUBLE_TAP_MS = 300; // umbral para bloquear el zoom por doble-tap en iOS

let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let touchLastX = 0;
let touchLastY = 0;
let touchMoved = false;
let lastTouchEndTime = 0;

function handleTouchStart(e) {
  if (e.touches.length !== 1) return;
  const touch = e.touches[0];
  touchStartX = touchLastX = touch.clientX;
  touchStartY = touchLastY = touch.clientY;
  touchStartTime = performance.now();
  touchMoved = false;
}

function handleTouchMove(e) {
  if (e.touches.length !== 1) return;
  e.preventDefault();
  if (paused || gameOver) return;
  if (mp.enabled && !mp.myTurn) return;

  const touch = e.touches[0];
  const dx = touch.clientX - touchLastX;
  const dy = touch.clientY - touchLastY;
  let changed = false;

  if (Math.abs(dx) >= SWIPE_H_THRESHOLD) {
    if (dx > 0) moveRight(); else moveLeft();
    touchLastX = touch.clientX;
    touchMoved = true;
    changed = true;
  }
  if (dy >= SWIPE_V_THRESHOLD) {
    softDropAction();
    touchLastY = touch.clientY;
    touchMoved = true;
    changed = true;
  }
  if (changed) {
    updateHUD();
    mpSyncIfActive();
  }
}

function handleTouchEnd(e) {
  // Bloqueo de doble-tap zoom (WebKit/iOS): si el toque anterior fue hace
  // menos de DOUBLE_TAP_MS, se cancela el comportamiento nativo del segundo.
  const now = performance.now();
  if (now - lastTouchEndTime < DOUBLE_TAP_MS) e.preventDefault();
  lastTouchEndTime = now;

  if (paused || gameOver) return;
  if (mp.enabled && !mp.myTurn) return;
  const touch = e.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  const duration = performance.now() - touchStartTime;

  if (!touchMoved && Math.abs(dx) < TAP_MAX_DISTANCE && Math.abs(dy) < TAP_MAX_DISTANCE && duration < TAP_MAX_DURATION) {
    rotatePiece();
    updateHUD();
    mpSyncIfActive();
  } else if (dy >= FAST_DROP_MIN_DISTANCE && duration < FAST_DROP_MAX_DURATION) {
    hardDropAction();
    updateHUD();
    mpSyncIfActive();
  }
}

gameContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
gameContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
gameContainer.addEventListener('touchend', handleTouchEnd, { passive: false });

// Guard de doble-tap fuera del tablero (barra superior, márgenes). Excluye
// elementos interactivos para no romper el doble-clic rápido en botones del
// modal multijugador ni la selección de texto en los textareas de códigos.
let lastGlobalTouchEndTime = 0;
document.addEventListener('touchend', e => {
  if (e.target.closest('button, input, textarea, select, a')) return;
  const now = performance.now();
  if (now - lastGlobalTouchEndTime < DOUBLE_TAP_MS) e.preventDefault();
  lastGlobalTouchEndTime = now;
}, { passive: false });

// ---- Multijugador P2P (WebRTC, handshake manual, sin servidor) ----
const mpToggleBtn = document.getElementById('mp-toggle');
const mpModal = document.getElementById('mp-modal');
const mpModalClose = document.getElementById('mp-modal-close');
const mpTabHost = document.getElementById('mp-tab-host');
const mpTabGuest = document.getElementById('mp-tab-guest');
const mpHostPanel = document.getElementById('mp-host-panel');
const mpGuestPanel = document.getElementById('mp-guest-panel');
const mpHostGenerateBtn = document.getElementById('mp-host-generate');
const mpHostOfferEl = document.getElementById('mp-host-offer');
const mpHostCopyBtn = document.getElementById('mp-host-copy');
const mpHostQrEl = document.getElementById('mp-host-qr');
const mpHostAnswerEl = document.getElementById('mp-host-answer');
const mpHostConnectBtn = document.getElementById('mp-host-connect');
const mpHostScanAnswerBtn = document.getElementById('mp-host-scan-answer');
const mpGuestOfferEl = document.getElementById('mp-guest-offer');
const mpGuestJoinBtn = document.getElementById('mp-guest-join');
const mpGuestScanOfferBtn = document.getElementById('mp-guest-scan-offer');
const mpGuestAnswerEl = document.getElementById('mp-guest-answer');
const mpGuestQrEl = document.getElementById('mp-guest-qr');
const mpGuestCopyBtn = document.getElementById('mp-guest-copy');
const mpStatusEl = document.getElementById('mp-status');
const mpScanOverlay = document.getElementById('mp-scan-overlay');
const mpScanVideo = document.getElementById('mp-scan-video');
const mpScanCancelBtn = document.getElementById('mp-scan-cancel');
const mpBadge = document.getElementById('mp-status-badge');
const mpNoticeEl = document.getElementById('mp-notice');
const turnBanner = document.getElementById('turn-banner');
const mpDimmable = document.getElementById('mp-dimmable');

const MP_CONNECT_TIMEOUT = 20000;
const MP_NOTICE_DURATION = 4000;

const mp = {
  enabled: false,
  isHost: false,
  myTurn: false,
  channel: null,
};

let mpRole = null;
let hostSession = null;
let guestSession = null;
let mpConnectTimer = null;
let mpNoticeTimer = null;

function mpSetStatus(text) {
  mpStatusEl.textContent = text;
}

// Muestra un mensaje dentro del modal si está visible, o en el aviso
// flotante junto al badge si el modal ya se ocultó (p.ej. tras conectar).
function mpNotify(text) {
  if (mpModal && !mpModal.classList.contains('hidden')) {
    mpSetStatus(text);
    return;
  }
  mpNoticeEl.textContent = text;
  mpNoticeEl.classList.remove('hidden');
  clearTimeout(mpNoticeTimer);
  mpNoticeTimer = setTimeout(() => mpNoticeEl.classList.add('hidden'), MP_NOTICE_DURATION);
}

function mpClearConnectTimer() {
  clearTimeout(mpConnectTimer);
  mpConnectTimer = null;
}

function mpArmConnectTimer() {
  mpClearConnectTimer();
  mpConnectTimer = setTimeout(() => {
    mpNotify('No se pudo conectar (tiempo agotado). Genera un código nuevo e inténtalo de nuevo.');
    mpTeardown();
  }, MP_CONNECT_TIMEOUT);
}

// Cierra y descarta cualquier sesión (anfitrión o invitado) en curso,
// completada o no. Evita fugas de RTCPeerConnection al regenerar códigos,
// cambiar de pestaña o abandonar una conexión a medias.
function mpTeardown() {
  mpClearConnectTimer();
  mpStopScan();
  if (hostSession) hostSession.close();
  if (guestSession) guestSession.close();
  hostSession = null;
  guestSession = null;
  mpRole = null;
  mp.enabled = false;
  mp.isHost = false;
  mp.myTurn = false;
  mp.channel = null;
  mpBadge.classList.add('hidden');
  turnBanner.classList.add('hidden');
  mpDimmable.classList.remove('waiting');
}

function onIceStateChange(state) {
  if (state === 'connected' || state === 'completed') {
    mpClearConnectTimer();
  } else if (state === 'failed') {
    mpNotify('No se pudo conectar (red o firewall restrictivo). Genera un código nuevo e inténtalo de nuevo.');
    mpTeardown();
  } else if (state === 'disconnected' || state === 'closed') {
    onChannelClose();
  }
}

function mpSend(type, data) {
  TetrisRTC.send(mp.channel, Object.assign({ type }, data));
}

function mpSyncIfActive() {
  if (mp.enabled && mp.myTurn) mpSend('state', { state: snapshotState() });
}

function snapshotState() {
  return { board, current, next, score, lines, level, dropInterval, gameOver };
}

function applyState(state) {
  board = state.board;
  current = state.current;
  next = state.next;
  score = state.score;
  lines = state.lines;
  level = state.level;
  dropInterval = state.dropInterval;
  gameOver = state.gameOver;
  updateHUD();
  drawNext();
  draw();
}

function setMyTurn(isMine) {
  mp.myTurn = isMine;
  if (isMine) {
    turnBanner.classList.add('hidden');
    mpDimmable.classList.remove('waiting');
    dropAccum = 0;
    lastTime = performance.now();
    cancelAnimationFrame(animId);
    if (!gameOver && !paused) animId = requestAnimationFrame(loop);
  } else {
    turnBanner.classList.remove('hidden');
    mpDimmable.classList.add('waiting');
    cancelAnimationFrame(animId);
  }
}

function handleRemoteMessage(msg) {
  switch (msg.type) {
    case 'start':
      overlay.classList.add('hidden');
      applyState(msg.state);
      setMyTurn(false);
      mpSetStatus('¡Conectado! Es el turno del anfitrión.');
      break;
    case 'state':
      applyState(msg.state);
      break;
    case 'turn-change':
      applyState(msg.state);
      setMyTurn(true);
      break;
    case 'game-over':
      applyState(msg.state);
      turnBanner.classList.add('hidden');
      mpDimmable.classList.remove('waiting');
      endGame();
      break;
    case 'pause':
      if (msg.paused) {
        cancelAnimationFrame(animId);
        overlayTitle.textContent = 'PAUSA';
        overlayScore.textContent = '';
        overlay.classList.remove('hidden');
        mpNotify('Tu rival puso el juego en pausa.');
      } else {
        overlay.classList.add('hidden');
        if (!mp.myTurn) {
          turnBanner.classList.remove('hidden');
        } else if (!gameOver) {
          lastTime = performance.now();
          animId = requestAnimationFrame(loop);
        }
      }
      break;
    case 'restart-request':
      if (mp.isHost) {
        init();
        mpSend('start', { state: snapshotState() });
        setMyTurn(true);
      }
      break;
  }
}

function onChannelOpen() {
  mpClearConnectTimer();
  mp.enabled = true;
  mp.isHost = mpRole === 'host';
  mp.channel = mp.isHost ? hostSession.channel : guestSession.getChannel();
  mpBadge.textContent = mp.isHost ? '🌐 Multijugador — Anfitrión' : '🌐 Multijugador — Invitado';
  mpBadge.classList.remove('hidden');
  mpSetStatus('¡Conectado!');
  setTimeout(() => mpModal.classList.add('hidden'), 600);
  if (mp.isHost) {
    init();
    mpSend('start', { state: snapshotState() });
    setMyTurn(true);
  }
}

function onChannelClose() {
  if (!mp.enabled) return;
  mpTeardown();
  mpNotify('Conexión perdida. Volviendo a modo un jugador.');
  if (!gameOver && !paused) {
    cancelAnimationFrame(animId);
    dropAccum = 0;
    lastTime = performance.now();
    animId = requestAnimationFrame(loop);
  }
}

function mpSwitchTab(tab) {
  // Descarta cualquier sesión a medias del rol que se abandona, para no
  // dejar RTCPeerConnection huérfanas si el usuario cambia de pestaña.
  if (tab === 'host' && guestSession) mpTeardown();
  if (tab === 'guest' && hostSession) mpTeardown();
  mpStopScan();
  mpTabHost.classList.toggle('active', tab === 'host');
  mpTabGuest.classList.toggle('active', tab === 'guest');
  mpHostPanel.classList.toggle('hidden', tab !== 'host');
  mpGuestPanel.classList.toggle('hidden', tab !== 'guest');
  mpSetStatus('');
}

mpTabHost.addEventListener('click', () => mpSwitchTab('host'));
mpTabGuest.addEventListener('click', () => mpSwitchTab('guest'));

mpToggleBtn.addEventListener('click', () => mpModal.classList.remove('hidden'));
mpModalClose.addEventListener('click', () => {
  mpModal.classList.add('hidden');
  mpStopScan();
  // Si había una conexión a medias (código generado pero no abierto aún),
  // descartarla al cerrar el modal para no dejar el RTCPeerConnection vivo.
  if (!mp.enabled && (hostSession || guestSession)) mpTeardown();
});

mpHostGenerateBtn.addEventListener('click', async () => {
  if (hostSession || guestSession) mpTeardown();
  mpHostGenerateBtn.disabled = true;
  mpSetStatus('Generando código de invitación...');
  try {
    mpRole = 'host';
    hostSession = await TetrisRTC.createHost({
      onOpen: onChannelOpen,
      onClose: onChannelClose,
      onMessage: handleRemoteMessage,
      onStateChange: onIceStateChange,
    });
    const code = await hostSession.createOfferCode();
    mpHostOfferEl.value = code;
    mpRenderQr(mpHostQrEl, code);
    mpSetStatus('Comparte este código (o el QR) con tu rival y espera su respuesta.');
  } catch (err) {
    mpSetStatus('Error al generar el código: ' + err.message);
  } finally {
    mpHostGenerateBtn.disabled = false;
  }
});

mpHostConnectBtn.addEventListener('click', async () => {
  if (!hostSession) { mpSetStatus('Primero genera tu código.'); return; }
  const code = mpHostAnswerEl.value.trim();
  if (!code) { mpSetStatus('Pega el código de tu rival primero.'); return; }
  try {
    mpSetStatus('Conectando...');
    await hostSession.acceptAnswerCode(code);
    mpArmConnectTimer();
  } catch (err) {
    mpSetStatus('Código inválido: ' + err.message);
  }
});

mpGuestJoinBtn.addEventListener('click', async () => {
  const code = mpGuestOfferEl.value.trim();
  if (!code) { mpSetStatus('Pega el código del anfitrión primero.'); return; }
  if (hostSession || guestSession) mpTeardown();
  mpGuestJoinBtn.disabled = true;
  try {
    mpSetStatus('Procesando código...');
    mpRole = 'guest';
    guestSession = await TetrisRTC.createGuest({
      onOpen: onChannelOpen,
      onClose: onChannelClose,
      onMessage: handleRemoteMessage,
      onStateChange: onIceStateChange,
    });
    const answerCode = await guestSession.acceptOfferAndCreateAnswerCode(code);
    mpGuestAnswerEl.value = answerCode;
    mpRenderQr(mpGuestQrEl, answerCode);
    mpSetStatus('Envía este código (o el QR) al anfitrión y espera a que confirme.');
    mpArmConnectTimer();
  } catch (err) {
    mpSetStatus('Código inválido: ' + err.message);
  } finally {
    mpGuestJoinBtn.disabled = false;
  }
});

function mpRenderQr(canvasEl, text) {
  canvasEl.width = 220;
  canvasEl.height = 220;
  const result = QRCodeGen.render(canvasEl, text, { correctLevel: QRCodeGen.ErrorCorrectLevel.L });
  canvasEl.classList.toggle('hidden', !result.ok);
  if (!result.ok) {
    mpSetStatus('El código es demasiado largo para mostrarse como QR; usa copiar/pegar.');
  }
}

// ---- Escaneo de QR por cámara (BarcodeDetector nativo, sin dependencias) ----
// Si el navegador no soporta BarcodeDetector o se deniega el permiso de
// cámara, el copy-paste manual sigue disponible como alternativa.
let mpScanStream = null;
let mpScanRAF = null;
let mpScanTargetEl = null;
let mpScanDetector = null;

function mpScanSupported() {
  return 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

function mpStopScan() {
  if (mpScanRAF) cancelAnimationFrame(mpScanRAF);
  mpScanRAF = null;
  if (mpScanStream) {
    mpScanStream.getTracks().forEach(track => track.stop());
    mpScanStream = null;
  }
  mpScanVideo.srcObject = null;
  mpScanOverlay.classList.add('hidden');
  mpScanTargetEl = null;
}

async function mpScanTick() {
  if (!mpScanStream) return;
  try {
    const codes = await mpScanDetector.detect(mpScanVideo);
    if (codes && codes.length) {
      const target = mpScanTargetEl;
      mpStopScan();
      if (target) {
        target.value = codes[0].rawValue;
        mpSetStatus('Código QR leído correctamente.');
      }
      return;
    }
  } catch (err) {
    // Frame no decodificable todavía; se reintenta en el próximo tick.
  }
  mpScanRAF = requestAnimationFrame(mpScanTick);
}

async function mpStartScan(targetEl) {
  if (!mpScanSupported()) {
    mpSetStatus('Tu navegador no soporta escanear QR con la cámara. Usa copiar/pegar.');
    return;
  }
  mpStopScan();
  mpScanTargetEl = targetEl;
  try {
    mpScanDetector = new BarcodeDetector({ formats: ['qr_code'] });
    mpScanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    mpScanVideo.srcObject = mpScanStream;
    await mpScanVideo.play();
    mpScanOverlay.classList.remove('hidden');
    mpScanRAF = requestAnimationFrame(mpScanTick);
  } catch (err) {
    mpSetStatus('No se pudo acceder a la cámara: ' + err.message);
    mpStopScan();
  }
}

mpHostScanAnswerBtn.addEventListener('click', () => mpStartScan(mpHostAnswerEl));
mpGuestScanOfferBtn.addEventListener('click', () => mpStartScan(mpGuestOfferEl));
mpScanCancelBtn.addEventListener('click', () => mpStopScan());

function mpCopyToClipboard(textarea) {
  textarea.select();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textarea.value).catch(() => {
      try { document.execCommand('copy'); } catch (e) { /* portapapeles no disponible */ }
    });
  } else {
    try { document.execCommand('copy'); } catch (e) { /* portapapeles no disponible */ }
  }
}

mpHostCopyBtn.addEventListener('click', () => mpCopyToClipboard(mpHostOfferEl));
mpGuestCopyBtn.addEventListener('click', () => mpCopyToClipboard(mpGuestAnswerEl));

initTheme();
init();
