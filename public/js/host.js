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

const SNAP_TIMEOUT_MS = 5000;
const MIN_CAMERAS = 2;
const MIN_VISIBLE_SLOTS = 4;
const USERNAME_KEY = 'cameroom_username';

let socket = null;
let username = null;
let lobby = [];                  // [{ position }]
let expectedAtSnap = 0;
let received = new Map();        // position -> ArrayBuffer (JPEG)
let snapTimeout = null;

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
    lobby = joiners;
    lensCount.textContent = `${joiners.length} CONNECTED`;
    renderLensGrid();

    const ready = joiners.length >= MIN_CAMERAS;
    snapBtn.disabled = !ready;
    snapHint.textContent = ready
      ? `— PRESS TO SHUTTER ${joiners.length} LENSES —`
      : `— NEED ${MIN_CAMERAS - joiners.length} MORE LENS${MIN_CAMERAS - joiners.length === 1 ? '' : 'ES'} —`;

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
  const total = Math.max(MIN_VISIBLE_SLOTS, lobby.length);
  for (let i = 0; i < total; i++) {
    const joiner = lobby[i];
    lensGrid.appendChild(joiner
      ? lensCard(joiner, received.get(joiner.position), i)
      : placeholderCard(i));
  }
}

function lensCard(joiner, photoBuf, idx) {
  const { position, username } = joiner;
  const tilt = idx % 2 === 0 ? '-rotate-1' : 'rotate-1';
  const card = document.createElement('div');
  card.className = `bg-surface-container-lowest border-2 border-primary p-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${tilt}`;

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
    ? `— PRESS TO SHUTTER ${lobby.length} LENSES —`
    : `— NEED ${MIN_CAMERAS - lobby.length} MORE LENS${MIN_CAMERAS - lobby.length === 1 ? '' : 'ES'} —`;
  setTicker(`READY // ${lobby.length} LENSES`);
}

// ---------- GIF assembly (gifshot, client-side, ping-pong) ----------

async function buildGif() {
  // Extract frames ordered by camera position (1, 2, 3, ..., N)
  const positions = [...received.keys()].sort((a, b) => a - b);

  // First frame's natural dimensions drive the GIF canvas size.
  const firstImg = await bytesToImage(received.get(positions[0]));
  const gifWidth  = firstImg.naturalWidth;
  const gifHeight = firstImg.naturalHeight;

  // Materialize each frame as a blob URL gifshot can fetch.
  const frameUrls = positions.map((p) =>
    URL.createObjectURL(new Blob([received.get(p)], { type: 'image/jpeg' }))
  );

  // Ping-pong sequence: 1..N then N-1..2 (endpoints dropped, loop closes cleanly).
  // For N=4 this yields [1, 2, 3, 4, 3, 2] — exactly the smooth 3D wiggle order.
  const sequence = frameUrls.slice();
  for (let i = frameUrls.length - 2; i > 0; i--) sequence.push(frameUrls[i]);

  return new Promise((resolve, reject) => {
    gifshot.createGIF({
      images: sequence,
      gifWidth,
      gifHeight,
      interval: 0.1,              // 100 ms between frames
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
      gifMeta.textContent = `${sequence.length} FRAMES // ${kb} KB`;

      document.getElementById('lensGrid').parentElement.classList.add('hidden');
      snapBtn.parentElement.classList.add('hidden');
      previewSection.hidden = false;

      setTicker(`DONE // ${sequence.length}_FRAMES // ${kb}KB`);
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
  previewSection.hidden = true;
  document.getElementById('lensGrid').parentElement.classList.remove('hidden');
  snapBtn.parentElement.classList.remove('hidden');
  renderLensGrid();
  resetSnapButton();
});

// ---------- Ticker helper ----------

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
