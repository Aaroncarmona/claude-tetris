# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A classic Tetris implementation in vanilla JavaScript, HTML5 Canvas, and CSS. No dependencies, no build step, no package.json.

## Running the game

There is no build/lint/test tooling. To run:

```bash
open index.html              # macOS, works directly
# or serve locally (recommended for consistent module/canvas behavior)
python3 -m http.server 8000
npx serve .
```

Then visit `http://localhost:8000`. There are no automated tests in this repo.

## Architecture

Four files, no modules/bundler — everything is loaded via plain `<script>` tags in `index.html`:

- **`index.html`** — DOM structure: main `<canvas id="board">` (300×600), a `<canvas id="next-canvas">` for the next-piece preview, the score/lines/level panel, the pause/game-over overlay, and the multiplayer modal/badge/notice elements.
- **`style.css`** — dark/retro arcade visual theme.
- **`game.js`** — all game logic (single file, no classes, module-level `let` state), plus the multiplayer UI wiring at the bottom.
- **`webrtc.js`** — `TetrisRTC`, the serverless WebRTC transport used by multiplayer (loaded before `game.js`).

### Core model (`game.js`)

- **Board**: `ROWS × COLS` matrix (`board[row][col]`), each cell is `0` (empty) or a color index `1–7` identifying the locked piece.
- **Pieces**: defined in `PIECES` as square matrices (see the array near the top of `game.js`). Rotation is done via `rotateCW`, which transposes + reverses rows — there is no separate rotation-state table (no SRS), just this one clockwise transform applied to the current shape.
- **Collision** (`collide`): checks board bounds and overlap with already-locked cells.
- **Wall kicks** (`tryRotate`): after rotating, tries offsets `[0, -1, 1, -2, 2]` on the x-axis until a non-colliding position is found, otherwise discards the rotation.
- **Locking** (`lockPiece` → `merge` + `clearLines` + `spawn`): merges the current piece into `board`, clears completed rows (shifting rows down and unshifting an empty row at the top), then spawns the next piece.
- **Game loop** (`loop`, driven by `requestAnimationFrame`): accumulates elapsed time in `dropAccum`; once it exceeds `dropInterval`, the piece drops one row (or locks if it can't).
- **Scoring**: `LINE_SCORES = [0, 100, 300, 500, 800]` multiplied by `level`; hard drop adds 2 points per cell dropped, soft drop adds 1 point per row.
- **Level/speed**: level increases every 10 cleared lines; `dropInterval = max(100, 1000 - (level - 1) * 90)` ms.
- **Ghost piece** (`ghostY`): projects the current piece straight down to its landing row, drawn at `globalAlpha = 0.2`.
- **Game over**: triggered in `spawn()` when a freshly spawned piece immediately collides.

### Tunable constants (all in `game.js`)

`COLS`, `ROWS`, `BLOCK` (cell size in px), `COLORS`, `LINE_SCORES`, `dropInterval`. If `COLS`/`ROWS`/`BLOCK` change, update the `width`/`height` of `<canvas id="board">` in `index.html` to match (`COLS × BLOCK` and `ROWS × BLOCK`).

### Multiplayer P2P (`webrtc.js` + MP block in `game.js`)

100% serverless: no signaling backend, no TURN — only Google's public STUN servers (`stun.l.google.com:19302` through `stun4`, `webrtc.js`) to resolve ICE candidates. Session negotiation (SDP offer/answer) is exchanged manually as Base64-encoded JSON text codes that players paste to each other (WhatsApp, Telegram, etc.) — there's no way to automate this without a server, so it's inherent to being serverless. ICE gathering is non-trickle: `waitForIceGathering` blocks until `iceGatheringState === 'complete'` or a 4s timeout, then the full local SDP (with candidates already embedded) is encoded into the code.

- **`TetrisRTC`** (`webrtc.js`) exposes `createHost()`/`createGuest()`, each returning `{ pc, channel/getChannel, createOfferCode/acceptOfferAndCreateAnswerCode, acceptAnswerCode, close }`. `close()` tears down the data channel and `RTCPeerConnection` — call it whenever a session is abandoned or replaced to avoid leaking peer connections.
- **Data channel**: single reliable/ordered channel named `'tetris'`, created by the host; the guest receives it via `pc.ondatachannel`.
- **Message protocol** (`{ type, ...data }` JSON over the channel, handled in `handleRemoteMessage`): `start` (host broadcasts initial snapshot), `state` (full board/piece snapshot sent on every input/gravity tick by whoever holds the turn), `turn-change` (sent by `lockPiece` when a piece locks), `game-over`, `pause` (mirrors local pause state to the other player), `restart-request` (guest asks the host for a rematch).
- **Turn model**: single shared board; only the current turn holder runs the game loop (`setMyTurn`) and sends `state`. The other player's board is a read-only mirror driven by incoming `state`/`turn-change` messages.
- **Connection lifecycle**: `mpArmConnectTimer`/`mpClearConnectTimer` bound the handshake to `MP_CONNECT_TIMEOUT` (20s); `oniceconnectionstatechange` (wired via `onStateChange`) drives `onIceStateChange`, which tears down on `failed` and routes `disconnected`/`closed` to `onChannelClose`. `mpTeardown()` is the single cleanup path — call it before starting a new session (regenerating a code, switching host/guest tabs) so `RTCPeerConnection`s never accumulate.
- **UI feedback**: `mpSetStatus` writes inside the modal; `mpNotify` writes there while the modal is open and falls back to the `#mp-notice` floating banner once the modal auto-hides after connecting — use `mpNotify` for anything that can happen post-connection (disconnects, rematch requests).
- Global `keydown` ignores input while the MP modal is open or while an `<input>`/`<textarea>` is focused, so players can paste codes containing spaces without triggering game controls.

## Controls

`←`/`→` move, `↑` or `X` rotate CW, `↓` soft drop, `Space` hard drop, `P` pause/resume.
