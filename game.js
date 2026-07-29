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
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
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
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
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
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
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
});

restartBtn.addEventListener('click', init);

// ---- Controles táctiles (gestos) ----
const gameContainer = document.querySelector('.game-container');

const SWIPE_H_THRESHOLD = 28; // px por columna movida
const SWIPE_V_THRESHOLD = 28; // px por paso de soft drop
const TAP_MAX_DURATION = 200; // ms
const TAP_MAX_DISTANCE = 12; // px
const FAST_DROP_MIN_DISTANCE = 80; // px hacia abajo
const FAST_DROP_MAX_DURATION = 250; // ms

let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let touchLastX = 0;
let touchLastY = 0;
let touchMoved = false;

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
  if (changed) updateHUD();
}

function handleTouchEnd(e) {
  if (paused || gameOver) return;
  const touch = e.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  const duration = performance.now() - touchStartTime;

  if (!touchMoved && Math.abs(dx) < TAP_MAX_DISTANCE && Math.abs(dy) < TAP_MAX_DISTANCE && duration < TAP_MAX_DURATION) {
    rotatePiece();
    updateHUD();
  } else if (dy >= FAST_DROP_MIN_DISTANCE && duration < FAST_DROP_MAX_DURATION) {
    hardDropAction();
    updateHUD();
  }
}

gameContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
gameContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
gameContainer.addEventListener('touchend', handleTouchEnd, { passive: true });

// ---- Botonera táctil virtual ----
function bindHoldButton(id, action, repeatDelay, repeatInterval) {
  const btn = document.getElementById(id);
  if (!btn) return;
  let timeoutId = null;
  let intervalId = null;

  const trigger = () => {
    if (paused || gameOver) return;
    action();
    updateHUD();
  };

  const start = e => {
    e.preventDefault();
    btn.classList.add('active');
    trigger();
    timeoutId = setTimeout(() => {
      intervalId = setInterval(trigger, repeatInterval);
    }, repeatDelay);
  };

  const stop = () => {
    btn.classList.remove('active');
    clearTimeout(timeoutId);
    clearInterval(intervalId);
  };

  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
}

function bindTapButton(id, action) {
  const btn = document.getElementById(id);
  if (!btn) return;

  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    btn.classList.add('active');
    if (!paused && !gameOver) {
      action();
      updateHUD();
    }
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(evt =>
    btn.addEventListener(evt, () => btn.classList.remove('active'))
  );
}

bindHoldButton('btn-left', moveLeft, 300, 120);
bindHoldButton('btn-right', moveRight, 300, 120);
bindHoldButton('btn-down', softDropAction, 200, 60);
bindTapButton('btn-rotate', rotatePiece);
bindTapButton('btn-drop', hardDropAction);

initTheme();
init();
