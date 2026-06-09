const $ = (id) => document.getElementById(id);

// Login DOM
const loginView     = $('loginView');
const loginInput    = $('loginInput');
const loginBtn      = $('loginBtn');
const loginError    = $('loginError');

// Join form + camera DOM
const joinForm      = $('join-form');
const cameraView    = $('camera-view');
const roomInput     = $('roomInput');
const joinBtn       = $('joinBtn');
const joinError     = $('joinError');
const bottomNav     = $('bottomNav');

const video         = $('video');
const canvas        = $('canvas');
const connectedRoom = $('connectedRoom');
const positionBadge = $('positionBadge');
const streamRes     = $('streamRes');
const frameStatus   = $('frameStatus');
const statusTicker  = $('statusTicker');
const batchLetter   = $('batchLetter');
const flash         = $('flash');

const wiggleResult   = $('wiggleResult');
const wigglePreview  = $('wigglePreview');
const wiggleMeta     = $('wiggleMeta');
const wiggleDownload = $('wiggleDownload');

const vignetteOverlay = $('vignetteOverlay');
const grainOverlay    = $('grainOverlay');

// ----- Filter state (host pushes via FILTER_APPLY) -----
const DEFAULT_FILTER = {
  brightness: 1, contrast: 1, saturation: 1, hueRotate: 0, blur: 0,
  grain: 0, vignette: 0, vignetteFeather: 0.5,
  curve: null   // null = identity; otherwise 256-entry array (0..255)
};
let currentFilter = { ...DEFAULT_FILTER };

const SVG_GRAIN = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">' +
  '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/></filter>' +
  '<rect width="100%" height="100%" filter="url(#n)" opacity="0.55"/></svg>'
);
if (grainOverlay) {
  grainOverlay.style.backgroundImage = `url("${SVG_GRAIN}")`;
  grainOverlay.style.backgroundRepeat = 'repeat';
}

function buildCssFilter(f) {
  return [
    `brightness(${f.brightness})`,
    `contrast(${f.contrast})`,
    `saturate(${f.saturation})`,
    `hue-rotate(${f.hueRotate}deg)`,
    `blur(${f.blur}px)`
  ].join(' ');
}

function applyLiveFilter() {
  if (video) video.style.filter = buildCssFilter(currentFilter);
  if (vignetteOverlay) {
    const inner = Math.max(0, 1 - currentFilter.vignetteFeather);
    vignetteOverlay.style.background =
      `radial-gradient(ellipse at center, rgba(0,0,0,0) ${inner * 100}%, rgba(0,0,0,${currentFilter.vignette}) 100%)`;
    vignetteOverlay.style.opacity = currentFilter.vignette > 0 ? '1' : '0';
  }
  if (grainOverlay) grainOverlay.style.opacity = String(currentFilter.grain);
}

const USERNAME_KEY = 'cameroom_username';

let socket = null;
let username = null;
let stream = null;
let roomCodeJoined = null;

// Auto-fill room code from ?room=XXXX (applies whenever the join form is reached)
const params = new URLSearchParams(location.search);
if (params.has('room')) {
  roomInput.value = params.get('room').replace(/\D/g, '').slice(0, 4);
}

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
  joinForm.classList.remove('hidden');

  socket = io({ auth: { username: name } });
  attachSocketListeners();
}

function attachSocketListeners() {
  socket.on('FILTER_APPLY', (f) => {
    currentFilter = { ...DEFAULT_FILTER, ...f };
    applyLiveFilter();
  });

  socket.on('SNAP_NOW', () => {
    // === HOT PATH: synchronous pixel grab with active filter baked in. ===
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Layer 1 — CSS-equivalent filter ops on the raw frame
    ctx.filter = buildCssFilter(currentFilter);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.filter = 'none';

    // Layer 2 — vignette (radial darkening)
    if (currentFilter.vignette > 0) {
      const cx = w / 2, cy = h / 2;
      const rOuter = Math.sqrt(cx * cx + cy * cy);
      const rInner = rOuter * Math.max(0, 1 - currentFilter.vignetteFeather);
      const g = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${currentFilter.vignette})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // Layer 3 — grain (procedural noise mixed via 'overlay')
    if (currentFilter.grain > 0) {
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const oCtx = off.getContext('2d');
      const id = oCtx.createImageData(w, h);
      const px = id.data;
      for (let i = 0; i < px.length; i += 4) {
        const n = 128 + (((Math.random() - 0.5) * 255) | 0);
        px[i] = px[i+1] = px[i+2] = n;
        px[i+3] = 255;
      }
      oCtx.putImageData(id, 0, 0);
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = currentFilter.grain;
      ctx.drawImage(off, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Layer 4 — per-pixel tone-curve LUT pass (only if host shipped a curve)
    if (currentFilter.curve && currentFilter.curve.length === 256) {
      const lut = currentFilter.curve;
      const id = ctx.getImageData(0, 0, w, h);
      const px = id.data;
      for (let i = 0; i < px.length; i += 4) {
        px[i]   = lut[px[i]];
        px[i+1] = lut[px[i+1]];
        px[i+2] = lut[px[i+2]];
      }
      ctx.putImageData(id, 0, 0);
    }
    // === END HOT PATH ===

    flash.classList.add('on');
    setTimeout(() => flash.classList.remove('on'), 160);

    frameStatus.textContent = 'FRAME LOCKED // ENCODING...';
    setTicker('SHUTTER FIRED // ENCODING JPEG');

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const buf = await blob.arrayBuffer();
      socket.emit('SUBMIT_PHOTO', buf);
      frameStatus.textContent = `UPLINK // ${Math.round(blob.size / 1024)} KB`;
      setTicker(`FRAME SENT // ${Math.round(blob.size / 1024)}KB`);
    }, 'image/jpeg', 0.85);
  });

  socket.on('WIGGLEGRAM_DROP', ({ gif }) => {
    // Host stitched the wigglegram and pushed it to everyone in the room.
    if (stream) stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob([gif], { type: 'image/gif' });
    const url = URL.createObjectURL(blob);
    wigglePreview.src = url;
    wiggleDownload.href = url;
    wiggleMeta.textContent = `${Math.round(blob.size / 1024)} KB // FROM HOST`;
    cameraView.classList.add('hidden');
    bottomNav.classList.add('hidden');
    wiggleResult.classList.remove('hidden');
    setTicker(`WIGGLEGRAM RECEIVED // ${Math.round(blob.size / 1024)}KB`);
  });

  socket.on('ROOM_CLOSED', () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setTicker('SESSION CLOSED // HOST LEFT');
    alert('Host ended the session.');
    location.href = '/';
  });

  socket.on('disconnect', () => {
    setTicker('LINK LOST // RECONNECTING...');
  });
}

// ---------- Join a room ----------

joinBtn.addEventListener('click', joinRoom);
roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });

async function joinRoom() {
  if (!socket) return;
  const code = roomInput.value.trim();
  if (!/^\d{4}$/.test(code)) {
    showJoinError('// ERR_BAD_CODE // 4 DIGITS REQUIRED');
    return;
  }
  joinBtn.disabled = true;

  socket.emit('JOIN_ROOM', { roomCode: code }, async ({ ok, error, position }) => {
    if (!ok) {
      showJoinError(error === 'ROOM_NOT_FOUND' ? '// ERR // ROOM NOT FOUND' : '// ERR // JOIN FAILED');
      joinBtn.disabled = false;
      return;
    }

    roomCodeJoined = code;
    connectedRoom.textContent = code;
    positionBadge.textContent = String(position).padStart(2, '0');
    batchLetter.textContent = String.fromCharCode('A'.charCodeAt(0) + ((position - 1) % 26));

    try {
      await startCamera();
    } catch (err) {
      showJoinError('// ERR_CAMERA // ' + (err.message || err.name || 'UNKNOWN').toUpperCase());
      socket.disconnect();
      joinBtn.disabled = false;
      return;
    }

    joinForm.classList.add('hidden');
    cameraView.classList.remove('hidden');
    bottomNav.classList.remove('hidden');
    setTicker(`${username.toUpperCase()} // LENS #${String(position).padStart(2, '0')}`);
  });
}

// Zero-latency hack: warm the rear camera the moment we're in. SNAP_NOW = one drawImage().
async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: false
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    if (video.readyState >= 2) resolve();
    else video.onloadedmetadata = () => resolve();
  });
  await video.play();
  streamRes.textContent = `${video.videoWidth}x${video.videoHeight}`;
}

// ---------- Helpers ----------

function showJoinError(msg) {
  joinError.textContent = msg;
  joinError.hidden = false;
}

function setTicker(msg) {
  statusTicker.replaceChildren();
  statusTicker.appendChild(document.createTextNode(msg));
  const caret = document.createElement('span');
  caret.className = 'caret';
  statusTicker.appendChild(caret);
}

// ---------- Auto-login if username already saved ----------

const saved = localStorage.getItem(USERNAME_KEY);
if (saved) {
  loginInput.value = saved;
  enterSession(saved);
}
