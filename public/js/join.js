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
  socket.on('SNAP_NOW', () => {
    // === HOT PATH: synchronous pixel grab. ===
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    // Locked Polaroid lookup — flatten the live frame straight into B&W before encode.
    ctx.filter = 'grayscale(100%) contrast(125%) brightness(100%)';
    ctx.drawImage(video, 0, 0, w, h);
    ctx.filter = 'none';
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
