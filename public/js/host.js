const $ = (id) => document.getElementById(id);

// Login DOM
const loginView     = $('loginView');
const loginInput    = $('loginInput');
const loginBtn      = $('loginBtn');
const loginError    = $('loginError');

// Main lobby DOM
const hostMain      = $('hostMain');
const bottomNav     = $('bottomNav');
const roomCodeEl    = $('roomCode');
const joinUrlEl     = $('joinUrl');
const qrCodeEl      = $('qrCode');
const shareCard     = $('shareCard');
const lensGrid      = $('lensGrid');
const lensCount     = $('lensCount');
const snapBtn       = $('snapBtn');
const snapHint      = $('snapHint');
const statusTicker  = $('statusTicker');
const previewSection = $('preview');
const gifPreview    = $('gifPreview');
const gifMeta       = $('gifMeta');
const downloadLink  = $('downloadLink');
const newSnapBtn    = $('newSnapBtn');

// Filter panel DOM
const filterPanel   = $('filterPanel');
const presetRow     = $('presetRow');
const sliderGrid    = $('sliderGrid');
const filterReset   = $('filterReset');
const openAdvanced  = $('openAdvanced');
const advancedModal = $('advancedModal');
const closeAdvanced = $('closeAdvanced');
const resetCurve    = $('resetCurve');
const curveEditor   = $('curveEditor');
const curvePath     = $('curvePath');
const curveHandles  = $('curveHandles');

// Playback panel DOM (two sliders — pre-snap above the SNAP button, and
// post-capture inside the preview section — kept in sync via setSpeed).
const speedSlider        = $('speedSlider');
const speedValue         = $('speedValue');
const speedSliderPreview = $('speedSliderPreview');
const speedValuePreview  = $('speedValuePreview');

// Sequence editor DOM
const sequenceEditor = $('sequenceEditor');
const sequenceStrip  = $('sequenceStrip');
const resetSequence  = $('resetSequence');
const rebuildGif     = $('rebuildGif');

const SNAP_TIMEOUT_MS = 5000;
const MIN_CAMERAS = 1;
const MIN_VISIBLE_SLOTS = 2;
const MAX_VISIBLE_SLOTS = 10;
const USERNAME_KEY = 'cameroom_username';
const FILTER_EMIT_THROTTLE_MS = 100;
const SPEED_DEFAULT_MS = 100;
const SPEED_MIN_MS = 50;
const SPEED_MAX_MS = 500;

let socket = null;
let username = null;
let lobby = [];                  // [{ position, username }] — server-assigned
let displayOrder = [];           // [position, position, ...] — host's reorder, drives GIF sequence
let expectedAtSnap = 0;
let received = new Map();        // position -> ArrayBuffer (JPEG)
let snapTimeout = null;

// ===== Filter state =====
const DEFAULT_FILTER = {
  preset: 'RAW',
  brightness: 1, contrast: 1, saturation: 1, hueRotate: 0, blur: 0,
  grain: 0, vignette: 0, vignetteFeather: 0.5,
  curve: null
};
let filterState = { ...DEFAULT_FILTER };

const PRESETS = {
  RAW:    { brightness: 1,    contrast: 1,    saturation: 1,    hueRotate: 0,   blur: 0,   grain: 0,    vignette: 0,   vignetteFeather: 0.5, curve: null },
  MONO:   { brightness: 1,    contrast: 1.2,  saturation: 0,    hueRotate: 0,   blur: 0,   grain: 0.05, vignette: 0,   vignetteFeather: 0.5, curve: null },
  NOIR:   { brightness: 0.92, contrast: 1.45, saturation: 0,    hueRotate: 0,   blur: 0,   grain: 0.15, vignette: 0.55, vignetteFeather: 0.6, curve: null },
  VIVID:  { brightness: 1,    contrast: 1.2,  saturation: 1.5,  hueRotate: 0,   blur: 0,   grain: 0,    vignette: 0,   vignetteFeather: 0.5, curve: null },
  WARM:   { brightness: 1.02, contrast: 1.05, saturation: 1.1,  hueRotate: -14, blur: 0,   grain: 0,    vignette: 0,   vignetteFeather: 0.5, curve: null },
  COLD:   { brightness: 1,    contrast: 1.1,  saturation: 0.88, hueRotate: 14,  blur: 0,   grain: 0,    vignette: 0,   vignetteFeather: 0.5, curve: null },
  FADED:  { brightness: 1.08, contrast: 0.78, saturation: 0.6,  hueRotate: 0,   blur: 0,   grain: 0.08, vignette: 0,   vignetteFeather: 0.5, curve: null },
  DREAM:  { brightness: 1.05, contrast: 1,    saturation: 1.2,  hueRotate: 0,   blur: 1,   grain: 0,    vignette: 0.3, vignetteFeather: 0.7, curve: null }
};

const SLIDER_DEFS = [
  { key: 'brightness',       label: 'BRIGHT',     min: 0,    max: 2,   step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'contrast',         label: 'CONTRAST',   min: 0,    max: 2,   step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'saturation',       label: 'SATURATE',   min: 0,    max: 2,   step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'hueRotate',        label: 'HUE',        min: -180, max: 180, step: 5,    format: (v) => `${v|0}°` },
  { key: 'blur',             label: 'BLUR',       min: 0,    max: 5,   step: 0.1,  format: (v) => `${v.toFixed(1)}px` },
  { key: 'grain',            label: 'GRAIN',      min: 0,    max: 1,   step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'vignette',         label: 'VIGNETTE',   min: 0,    max: 1,   step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'vignetteFeather',  label: 'V.FEATHER',  min: 0,    max: 1,   step: 0.05, format: (v) => `${Math.round(v * 100)}%` }
];

// Curve control points (image domain 0-255): [Shadows, Darks, Lights, Highlights]
// X positions fixed; Y values draggable.
const CURVE_X = [32, 96, 160, 224];
let curveY = [32, 96, 160, 224];   // identity

// ===== Playback state =====
let playbackSpeed = SPEED_DEFAULT_MS;
let gifSequence = [];       // array of positions, set after first build, editable in preview

// ---------- Login flow ----------

loginBtn.addEventListener('click', handleLogin);
loginInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });

function handleLogin() {
  const value = (loginInput.value || '').trim();
  if (!value) {
    loginError.textContent = '// ERR_NO_HANDLE // ENTER A NAME';
    loginError.hidden = false;
    return;
  }
  localStorage.setItem(USERNAME_KEY, value);
  enterSession(value);
}

function enterSession(name) {
  username = name;
  loginView.classList.add('hidden');
  hostMain.classList.remove('hidden');
  bottomNav.classList.remove('hidden');

  socket = io({ auth: { username: name } });
  attachSocketListeners();

  socket.emit('CREATE_ROOM', ({ ok, roomCode }) => {
    if (!ok) { setTicker('FATAL // ROOM_CREATE_FAILED'); return; }
    roomCodeEl.textContent = roomCode;

    const url = `${location.origin}/join?room=${roomCode}`;
    joinUrlEl.textContent = url;

    qrCodeEl.replaceChildren();
    new QRCode(qrCodeEl, {
      text: url,
      width: 72,
      height: 72,
      correctLevel: QRCode.CorrectLevel.M
    });
    shareCard.classList.remove('hidden');

    setTicker(`READY // ${name.toUpperCase()} // ROOM_${roomCode} // AWAITING LENSES`);
    renderLensGrid();
  });
}

function attachSocketListeners() {
  socket.on('LOBBY_UPDATE', ({ joiners }) => {
    const prevCount = lobby.length;
    lobby = joiners;
    // Preserve existing manual order; append newcomers; drop disconnected.
    const present = new Set(joiners.map((j) => j.position));
    displayOrder = displayOrder.filter((p) => present.has(p));
    joiners.forEach((j) => { if (!displayOrder.includes(j.position)) displayOrder.push(j.position); });

    lensCount.textContent = `${joiners.length} CONNECTED // CAP ${MAX_VISIBLE_SLOTS}`;
    renderLensGrid();

    // If a new joiner came in, re-push the current filter so they sync.
    if (joiners.length > prevCount && filterState.preset !== 'RAW') {
      socket.emit('FILTER_UPDATE', filterState);
    }

    const ready = joiners.length >= MIN_CAMERAS;
    snapBtn.disabled = !ready;
    snapHint.textContent = ready
      ? `— PRESS TO SHUTTER ${joiners.length} LENS${joiners.length === 1 ? '' : 'ES'} —`
      : `— NEED ${MIN_CAMERAS} LENS // GOT ${joiners.length} —`;

    setTicker(ready
      ? `STAND_BY // ${joiners.length} LENSES SYNCED`
      : `WAITING // ${joiners.length}/${MIN_CAMERAS}`);
  });

  socket.on('PHOTO_RECEIVED', ({ position, username: who, photo }) => {
    received.set(position, photo);
    snapHint.textContent = `— CAPTURING ${received.size}/${expectedAtSnap} —`;
    const tag = who ? who.toUpperCase() : `POS_${String(position).padStart(2, '0')}`;
    setTicker(`FRAME_IN // ${tag} // ${received.size}/${expectedAtSnap}`);
    renderLensGrid();
    if (received.size >= expectedAtSnap) finalizeSnap();
  });

  socket.on('connect_error', (err) => {
    setTicker(`AUTH_FAIL // ${(err.message || 'ERROR').toUpperCase()}`);
    snapBtn.disabled = true;
  });

  socket.on('disconnect', () => {
    setTicker('FATAL // SERVER_LOST // RELOAD');
    snapBtn.disabled = true;
  });
}

// ---------- Lens grid ----------

function renderLensGrid() {
  lensGrid.replaceChildren();
  const lobbyByPos = new Map(lobby.map((j) => [j.position, j]));
  const desired = Math.max(MIN_VISIBLE_SLOTS, displayOrder.length + 1);
  const total = Math.min(MAX_VISIBLE_SLOTS, desired);
  for (let i = 0; i < total; i++) {
    const pos = displayOrder[i];
    const joiner = pos !== undefined ? lobbyByPos.get(pos) : null;
    lensGrid.appendChild(joiner
      ? lensCard(joiner, received.get(joiner.position), i)
      : placeholderCard(i));
  }
}

function moveLens(position, delta) {
  const idx = displayOrder.indexOf(position);
  const target = idx + delta;
  if (idx < 0 || target < 0 || target >= displayOrder.length) return;
  const tmp = displayOrder[target];
  displayOrder[target] = displayOrder[idx];
  displayOrder[idx] = tmp;
  renderLensGrid();
  setTicker(`REORDERED // SEQUENCE: ${displayOrder.map((p) => '#' + String(p).padStart(2,'0')).join(' → ')}`);
}

function lensCard(joiner, photoBuf, idx) {
  const { position, username } = joiner;
  const tilt = idx % 2 === 0 ? '-rotate-1' : 'rotate-1';
  const card = document.createElement('div');
  card.className = `bg-surface-container-lowest border-2 border-primary p-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${tilt} relative`;

  const window_ = document.createElement('div');
  window_.className = 'bg-black aspect-square border-2 border-primary overflow-hidden flex items-center justify-center relative';

  if (photoBuf) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(new Blob([photoBuf], { type: 'image/jpeg' }));
    img.className = 'w-full h-full object-cover';
    window_.appendChild(img);
    const stamp = document.createElement('span');
    stamp.className = 'absolute top-1 right-1 font-stamp-accent text-stamp-accent bg-on-primary text-primary px-1.5 py-0.5 -rotate-6';
    stamp.textContent = 'OK';
    window_.appendChild(stamp);
  } else {
    const idMark = document.createElement('span');
    idMark.className = 'font-stamp-accent text-on-primary text-[11px] uppercase tracking-widest opacity-60';
    idMark.textContent = `LENS #${String(position).padStart(2, '0')}`;
    window_.appendChild(idMark);
    const dotRing = document.createElement('div');
    dotRing.className = 'absolute inset-3 border border-white/30 rounded-full';
    window_.appendChild(dotRing);
  }

  // Sequence-order index badge (top-left): shows where this lens sits in the GIF sequence.
  const seqIdx = displayOrder.indexOf(position);
  if (seqIdx >= 0) {
    const seqBadge = document.createElement('span');
    seqBadge.className = 'absolute top-1 left-1 font-stamp-accent text-stamp-accent bg-primary text-on-primary px-1.5 py-0.5';
    seqBadge.textContent = String(seqIdx + 1);
    window_.appendChild(seqBadge);
  }
  card.appendChild(window_);

  const caption = document.createElement('div');
  caption.className = 'pt-2 flex justify-between items-center gap-1';

  const name = document.createElement('span');
  name.className = 'font-label-sm text-label-sm uppercase font-bold truncate flex-1 min-w-0';
  name.title = username || `#${String(position).padStart(2, '0')}`;
  name.textContent = (username || `LENS_${String(position).padStart(2, '0')}`).toUpperCase();
  caption.appendChild(name);

  const idTag = document.createElement('span');
  idTag.className = 'font-label-sm text-[10px] text-on-surface-variant uppercase shrink-0';
  idTag.textContent = `#${String(position).padStart(2, '0')}`;
  caption.appendChild(idTag);

  card.appendChild(caption);

  // Reorder controls
  const isFirst = seqIdx === 0;
  const isLast  = seqIdx === displayOrder.length - 1;
  const reorder = document.createElement('div');
  reorder.className = 'mt-1 grid grid-cols-2 gap-1';
  const prevBtn = document.createElement('button');
  prevBtn.className = `border border-primary bg-surface text-primary py-1 font-label-sm text-[11px] uppercase tracking-widest font-bold ${isFirst ? 'opacity-30 cursor-not-allowed' : 'active:translate-x-px active:translate-y-px'}`;
  prevBtn.textContent = '◀ PREV';
  prevBtn.disabled = isFirst;
  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLens(position, -1); });
  reorder.appendChild(prevBtn);
  const nextBtn = document.createElement('button');
  nextBtn.className = `border border-primary bg-surface text-primary py-1 font-label-sm text-[11px] uppercase tracking-widest font-bold ${isLast ? 'opacity-30 cursor-not-allowed' : 'active:translate-x-px active:translate-y-px'}`;
  nextBtn.textContent = 'NEXT ▶';
  nextBtn.disabled = isLast;
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLens(position, 1); });
  reorder.appendChild(nextBtn);
  card.appendChild(reorder);

  return card;
}

function placeholderCard(idx) {
  const tilt = idx % 2 === 0 ? '-rotate-1' : 'rotate-1';
  const card = document.createElement('div');
  card.className = `bg-surface-container-lowest border-2 border-dashed border-on-surface-variant p-2 ${tilt} opacity-60`;

  const window_ = document.createElement('div');
  window_.className = 'bg-surface-container border-2 border-dashed border-on-surface-variant aspect-square flex flex-col items-center justify-center';

  const plus = document.createElement('span');
  plus.className = 'material-symbols-outlined text-on-surface-variant text-3xl';
  plus.textContent = 'add';
  window_.appendChild(plus);

  const txt = document.createElement('p');
  txt.className = 'font-label-sm text-label-sm text-on-surface-variant text-center uppercase mt-1 leading-tight';
  txt.textContent = 'AWAITING\nLENS...';
  txt.style.whiteSpace = 'pre-line';
  window_.appendChild(txt);

  card.appendChild(window_);

  const caption = document.createElement('div');
  caption.className = 'pt-2 h-5';
  card.appendChild(caption);
  return card;
}

// ---------- Snap ----------

snapBtn.addEventListener('click', () => {
  if (!socket) return;
  received = new Map();
  expectedAtSnap = lobby.length;
  snapBtn.disabled = true;
  snapHint.textContent = `— CAPTURING 0/${expectedAtSnap} —`;
  setTicker(`SHUTTER // FAN_OUT // T-${SNAP_TIMEOUT_MS}MS`);

  socket.emit('TRIGGER_SNAP');

  clearTimeout(snapTimeout);
  snapTimeout = setTimeout(finalizeSnap, SNAP_TIMEOUT_MS);
});

async function finalizeSnap() {
  clearTimeout(snapTimeout);

  if (received.size < MIN_CAMERAS) {
    setTicker(`ABORT // ONLY_${received.size}_FRAMES`);
    snapHint.textContent = `— GOT ${received.size}. NEED ${MIN_CAMERAS}+. —`;
    setTimeout(resetSnapButton, 2400);
    return;
  }

  setTicker(`COMPILING // RENDERING_FRAMES... 0%`);
  snapHint.textContent = '— COMPILING —';

  try {
    await buildGif();
  } catch (err) {
    console.error(err);
    setTicker('ERROR // COMPILE_FAILED');
    snapHint.textContent = '— COMPILE FAILED. TRY AGAIN. —';
    setTimeout(resetSnapButton, 2400);
  }
}

function resetSnapButton() {
  snapBtn.disabled = lobby.length < MIN_CAMERAS;
  snapHint.textContent = lobby.length >= MIN_CAMERAS
    ? `— PRESS TO SHUTTER ${lobby.length} LENS${lobby.length === 1 ? '' : 'ES'} —`
    : `— NEED ${MIN_CAMERAS} LENS // GOT ${lobby.length} —`;
  setTicker(`READY // ${lobby.length} LENS${lobby.length === 1 ? '' : 'ES'}`);
}

// ---------- GIF assembly (gifshot, client-side, ping-pong) ----------

function pingPongSequence(positions) {
  // [1, 2, 3, 4] -> [1, 2, 3, 4, 3, 2]  (drop the endpoints on the reverse leg
  // so the GIF loop closes cleanly without a held frame)
  const seq = positions.slice();
  for (let i = positions.length - 2; i > 0; i--) seq.push(positions[i]);
  return seq;
}

async function buildGif() {
  // Extract frames in the host's chosen display order (reordered by ◀/▶ buttons).
  // Fall back to numeric position order if displayOrder is empty.
  const captured = new Set(received.keys());
  const ordered = displayOrder.filter((p) => captured.has(p));
  const positions = ordered.length ? ordered : [...captured].sort((a, b) => a - b);

  // Default ping-pong sequence; user can re-order it after the first build.
  gifSequence = pingPongSequence(positions);

  // First frame's natural dimensions drive the GIF canvas size.
  const firstImg = await bytesToImage(received.get(positions[0]));
  const gifWidth  = firstImg.naturalWidth;
  const gifHeight = firstImg.naturalHeight;

  return renderGifFromSequence(gifSequence, gifWidth, gifHeight);
}

async function renderGifFromSequence(seqPositions, gifWidth, gifHeight) {
  // Materialize each frame in the requested order as a blob URL gifshot can fetch.
  const frameUrls = seqPositions.map((p) =>
    URL.createObjectURL(new Blob([received.get(p)], { type: 'image/jpeg' }))
  );
  const sequence = frameUrls;

  return new Promise((resolve, reject) => {
    gifshot.createGIF({
      images: sequence,
      gifWidth,
      gifHeight,
      interval: playbackSpeed / 1000,   // user-controlled frame delay (default 100 ms)
      numFrames: sequence.length,
      frameDuration: 1,
      sampleInterval: 10,
      numWorkers: 2,
      progressCallback: (p) => {
        const pct = Math.round(p * 100);
        snapHint.textContent = `— COMPILING ${pct}% —`;
        setTicker(`COMPILING // RENDERING_FRAMES... ${pct}%`);
      }
    }, (obj) => {
      // Source frames done streaming — free their blob URLs.
      frameUrls.forEach((u) => URL.revokeObjectURL(u));

      if (obj.error) {
        reject(new Error(obj.errorMsg || obj.errorCode || 'gifshot error'));
        return;
      }

      // gifshot returns a base64 data URL. Round-trip into a Blob so the size
      // and download href are clean (avoids massive data URLs sitting in the DOM).
      const dataUrl = obj.image;
      const b64 = dataUrl.split(',', 2)[1] || '';
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const gifBlob = new Blob([bytes], { type: 'image/gif' });
      const gifUrl  = URL.createObjectURL(gifBlob);

      gifPreview.src = gifUrl;
      downloadLink.href = gifUrl;

      const kb = Math.round(gifBlob.size / 1024);
      gifMeta.textContent = `${sequence.length} FRAMES // ${kb} KB // ${playbackSpeed}MS`;

      document.getElementById('lensGrid').parentElement.classList.add('hidden');
      snapBtn.parentElement.classList.add('hidden');
      previewSection.hidden = false;

      renderSequenceStrip();

      // Distribute the finished wigglegram to every lens in the room.
      gifBlob.arrayBuffer().then((buf) => {
        if (socket) socket.emit('WIGGLEGRAM_READY', buf);
      });

      setTicker(`DONE // ${sequence.length}_FRAMES // ${kb}KB // SHARED`);
      resolve();
    });
  });
}

function bytesToImage(buf) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buf], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// ---------- Reset ----------

newSnapBtn.addEventListener('click', () => {
  received = new Map();
  gifSequence = [];
  previewSection.hidden = true;
  document.getElementById('lensGrid').parentElement.classList.remove('hidden');
  snapBtn.parentElement.classList.remove('hidden');
  renderLensGrid();
  resetSnapButton();
});

// ---------- Playback controls ----------

function setSpeed(ms) {
  playbackSpeed = ms;
  if (speedSlider)        speedSlider.value = ms;
  if (speedSliderPreview) speedSliderPreview.value = ms;
  if (speedValue)         speedValue.textContent = `${ms}MS`;
  if (speedValuePreview)  speedValuePreview.textContent = `${ms}MS`;
}

[speedSlider, speedSliderPreview].forEach((el) => {
  if (!el) return;
  el.addEventListener('input', (e) => setSpeed(parseInt(e.target.value, 10)));
});
setSpeed(playbackSpeed);

// ---------- Per-frame sequence editor ----------

function renderSequenceStrip() {
  if (!sequenceStrip) return;
  sequenceStrip.replaceChildren();
  gifSequence.forEach((position, idx) => {
    const tile = document.createElement('div');
    tile.className = 'shrink-0 w-20 bg-surface-container-lowest border-2 border-primary p-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex flex-col items-stretch';

    const thumb = document.createElement('div');
    thumb.className = 'bg-black border border-primary aspect-square overflow-hidden relative';
    const buf = received.get(position);
    if (buf) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
      img.className = 'w-full h-full object-cover';
      thumb.appendChild(img);
    }
    const seqBadge = document.createElement('span');
    seqBadge.className = 'absolute top-0 left-0 font-stamp-accent text-stamp-accent bg-primary text-on-primary px-1.5 py-0.5';
    seqBadge.textContent = idx + 1;
    thumb.appendChild(seqBadge);
    const lensBadge = document.createElement('span');
    lensBadge.className = 'absolute bottom-0 right-0 font-label-sm text-[9px] bg-on-primary text-primary px-1';
    lensBadge.textContent = `#${String(position).padStart(2, '0')}`;
    thumb.appendChild(lensBadge);
    tile.appendChild(thumb);

    const ctrls = document.createElement('div');
    ctrls.className = 'mt-1 grid grid-cols-2 gap-0.5';

    const prev = document.createElement('button');
    prev.className = `border border-primary bg-surface text-primary py-0.5 font-label-sm text-[10px] uppercase tracking-widest font-bold ${idx === 0 ? 'opacity-30' : ''}`;
    prev.textContent = '◀';
    prev.disabled = idx === 0;
    prev.addEventListener('click', () => moveFrame(idx, -1));
    ctrls.appendChild(prev);

    const next = document.createElement('button');
    next.className = `border border-primary bg-surface text-primary py-0.5 font-label-sm text-[10px] uppercase tracking-widest font-bold ${idx === gifSequence.length - 1 ? 'opacity-30' : ''}`;
    next.textContent = '▶';
    next.disabled = idx === gifSequence.length - 1;
    next.addEventListener('click', () => moveFrame(idx, 1));
    ctrls.appendChild(next);

    tile.appendChild(ctrls);
    sequenceStrip.appendChild(tile);
  });
}

function moveFrame(idx, delta) {
  const target = idx + delta;
  if (target < 0 || target >= gifSequence.length) return;
  const tmp = gifSequence[target];
  gifSequence[target] = gifSequence[idx];
  gifSequence[idx] = tmp;
  renderSequenceStrip();
  setTicker(`SEQUENCE // ${gifSequence.map((p) => '#' + String(p).padStart(2,'0')).join(' → ')}`);
}

if (resetSequence) {
  resetSequence.addEventListener('click', () => {
    const captured = new Set(received.keys());
    const ordered = displayOrder.filter((p) => captured.has(p));
    const positions = ordered.length ? ordered : [...captured].sort((a, b) => a - b);
    gifSequence = pingPongSequence(positions);
    renderSequenceStrip();
    setTicker('SEQUENCE // PING-PONG');
  });
}

if (rebuildGif) {
  rebuildGif.addEventListener('click', async () => {
    if (gifSequence.length === 0) return;
    setTicker(`REBUILDING // ${gifSequence.length}_FRAMES // ${playbackSpeed}MS`);
    rebuildGif.textContent = '↻ REBUILDING…';
    rebuildGif.disabled = true;
    try {
      const firstImg = await bytesToImage(received.get(gifSequence[0]));
      await renderGifFromSequence(gifSequence, firstImg.naturalWidth, firstImg.naturalHeight);
    } catch (err) {
      console.error(err);
      setTicker('ERROR // REBUILD_FAILED');
    } finally {
      rebuildGif.textContent = '↻ REBUILD WIGGLEGRAM';
      rebuildGif.disabled = false;
    }
  });
}

// ---------- Ticker helper ----------

function setTicker(msg) {
  statusTicker.replaceChildren();
  statusTicker.appendChild(document.createTextNode(msg));
  const caret = document.createElement('span');
  caret.className = 'caret';
  statusTicker.appendChild(caret);
}

// ---------- Filter panel ----------

let filterEmitTimer = null;
let filterLastEmit = 0;

function emitFilter() {
  if (!socket) return;
  const now = performance.now();
  const sincePrev = now - filterLastEmit;
  if (sincePrev >= FILTER_EMIT_THROTTLE_MS) {
    socket.emit('FILTER_UPDATE', filterState);
    filterLastEmit = now;
    if (filterEmitTimer) { clearTimeout(filterEmitTimer); filterEmitTimer = null; }
  } else if (!filterEmitTimer) {
    filterEmitTimer = setTimeout(() => {
      if (socket) socket.emit('FILTER_UPDATE', filterState);
      filterLastEmit = performance.now();
      filterEmitTimer = null;
    }, FILTER_EMIT_THROTTLE_MS - sincePrev);
  }
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  filterState = { ...DEFAULT_FILTER, preset: name, ...p, curve: filterState.curve };
  reflectFilterUi();
  highlightActivePreset();
  emitFilter();
  setTicker(`LOOK // ${name}`);
}

function highlightActivePreset() {
  [...presetRow.querySelectorAll('button')].forEach((b) => {
    const active = b.dataset.preset === filterState.preset;
    b.className = active
      ? 'shrink-0 bg-primary text-on-primary border-2 border-primary px-3 py-2 font-label-sm text-[11px] uppercase tracking-widest font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
      : 'shrink-0 bg-surface text-primary border-2 border-primary px-3 py-2 font-label-sm text-[11px] uppercase tracking-widest font-bold active:translate-x-px active:translate-y-px';
  });
}

function reflectFilterUi() {
  SLIDER_DEFS.forEach((def) => {
    const slider = sliderGrid.querySelector(`input[data-key="${def.key}"]`);
    const valueEl = sliderGrid.querySelector(`span[data-key="${def.key}"]`);
    if (!slider || !valueEl) return;
    slider.value = filterState[def.key];
    valueEl.textContent = def.format(filterState[def.key]);
  });
  redrawCurve();
}

function buildFilterUi() {
  // Presets
  presetRow.replaceChildren();
  Object.keys(PRESETS).forEach((name) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.dataset.preset = name;
    b.addEventListener('click', () => applyPreset(name));
    presetRow.appendChild(b);
  });
  highlightActivePreset();

  // Sliders
  sliderGrid.replaceChildren();
  SLIDER_DEFS.forEach((def) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';

    const label = document.createElement('label');
    label.className = 'font-label-sm text-[11px] uppercase tracking-widest w-20 shrink-0 font-bold';
    label.textContent = def.label;
    row.appendChild(label);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = def.min;
    input.max = def.max;
    input.step = def.step;
    input.value = filterState[def.key];
    input.dataset.key = def.key;
    input.className = 'flex-1 accent-primary';
    input.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      filterState[def.key] = v;
      filterState.preset = 'CUSTOM';
      valueEl.textContent = def.format(v);
      highlightActivePreset();
      emitFilter();
    });
    row.appendChild(input);

    const valueEl = document.createElement('span');
    valueEl.dataset.key = def.key;
    valueEl.className = 'font-label-sm text-[11px] uppercase tracking-widest w-14 shrink-0 text-right tabular-nums';
    valueEl.textContent = def.format(filterState[def.key]);
    row.appendChild(valueEl);

    sliderGrid.appendChild(row);
  });

  // Reset
  filterReset.addEventListener('click', () => {
    filterState = { ...DEFAULT_FILTER };
    curveY = CURVE_X.slice();
    reflectFilterUi();
    highlightActivePreset();
    emitFilter();
    setTicker('LOOK // RESET');
  });

  // Modal open/close
  openAdvanced.addEventListener('click', () => {
    advancedModal.classList.remove('hidden');
    redrawCurve();
  });
  closeAdvanced.addEventListener('click', () => advancedModal.classList.add('hidden'));
  advancedModal.addEventListener('click', (e) => {
    if (e.target === advancedModal) advancedModal.classList.add('hidden');
  });

  resetCurve.addEventListener('click', () => {
    curveY = CURVE_X.slice();
    filterState.curve = null;
    redrawCurve();
    emitFilter();
    setTicker('CURVE // LINEAR');
  });

  setupCurveEditor();
}

// ---------- Tone curve ----------

function buildCurveLut(points) {
  // points sorted by x: [[x0,y0], [x1,y1], ...]
  const lut = new Array(256);
  for (let x = 0; x < 256; x++) {
    let i = 0;
    while (i < points.length - 1 && points[i + 1][0] < x) i++;
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1] || points[i];
    const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
    lut[x] = Math.max(0, Math.min(255, Math.round(y0 + (y1 - y0) * t)));
  }
  return lut;
}

function allCurvePoints() {
  const pts = [[0, 0]];
  for (let i = 0; i < CURVE_X.length; i++) pts.push([CURVE_X[i], curveY[i]]);
  pts.push([255, 255]);
  return pts;
}

function isIdentityCurve() {
  return curveY.every((y, i) => y === CURVE_X[i]);
}

function redrawCurve() {
  if (!curvePath) return;
  const pts = allCurvePoints();
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${256 - y}`).join(' ');
  curvePath.setAttribute('d', d);

  curveHandles.replaceChildren();
  CURVE_X.forEach((x, i) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', x);
    c.setAttribute('cy', 256 - curveY[i]);
    c.setAttribute('r', 10);
    c.setAttribute('fill', '#000');
    c.setAttribute('stroke', '#fff');
    c.setAttribute('stroke-width', 2);
    c.style.cursor = 'ns-resize';
    c.style.touchAction = 'none';
    c.dataset.idx = i;
    curveHandles.appendChild(c);
  });
}

function setupCurveEditor() {
  if (!curveEditor) return;
  let draggingIdx = -1;

  function svgPointFromEvent(e) {
    const pt = curveEditor.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(curveEditor.getScreenCTM().inverse());
  }

  curveEditor.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (t.tagName !== 'circle') return;
    draggingIdx = parseInt(t.dataset.idx, 10);
    t.setPointerCapture(e.pointerId);
  });

  curveEditor.addEventListener('pointermove', (e) => {
    if (draggingIdx < 0) return;
    const pt = svgPointFromEvent(e);
    const newY = Math.max(0, Math.min(255, Math.round(256 - pt.y)));
    curveY[draggingIdx] = newY;
    filterState.curve = isIdentityCurve() ? null : buildCurveLut(allCurvePoints());
    redrawCurve();
    emitFilter();
  });

  const endDrag = () => { draggingIdx = -1; };
  curveEditor.addEventListener('pointerup', endDrag);
  curveEditor.addEventListener('pointercancel', endDrag);
  curveEditor.addEventListener('pointerleave', endDrag);
}

// ---------- Bootstrap ----------

buildFilterUi();

const saved = localStorage.getItem(USERNAME_KEY);
if (saved) {
  loginInput.value = saved;
  enterSession(saved);
}
