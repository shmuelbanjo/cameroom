const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 10 MB ceiling per photo. JPEG @ q=0.85 lands ~200-400 KB at 1080p, ~1-2 MB at 4K.
// 1e7 gives 4K headroom while keeping a hard cap against memory-exhaustion DoS.
const io = new Server(server, {
  maxHttpBufferSize: 1e7
});

// ===== Auth middleware =====
// Validates socket.handshake.auth.username on every connect (host + joiner alike).
// Stores the sanitized name on socket.data so handlers can read it without re-parsing.
io.use((socket, next) => {
  const raw = socket.handshake.auth?.username;
  if (typeof raw !== 'string') return next(new Error('Invalid Username'));
  const username = raw.trim();
  if (!username || username.length > 24) return next(new Error('Invalid Username'));
  socket.data.username = username;
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/join', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'join.html')));

// roomCode -> { hostId, joiners: Map<socketId, { position, username }>, nextPosition }
const rooms = new Map();

function generateRoomCode() {
  for (let i = 0; i < 1000; i++) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!rooms.has(code)) return code;
  }
  throw new Error('Could not allocate a unique room code.');
}

function lobbyOf(room) {
  return [...room.joiners.values()]
    .sort((a, b) => a.position - b.position);
}

io.on('connection', (socket) => {

  socket.on('CREATE_ROOM', (ack) => {
    const code = generateRoomCode();
    rooms.set(code, {
      hostId: socket.id,
      joiners: new Map(),
      nextPosition: 1
    });
    socket.data.role = 'host';
    socket.data.roomCode = code;
    socket.join(code);
    ack({ ok: true, roomCode: code });
  });

  socket.on('JOIN_ROOM', ({ roomCode }, ack) => {
    const room = rooms.get(roomCode);
    if (!room) { ack({ ok: false, error: 'ROOM_NOT_FOUND' }); return; }

    const position = room.nextPosition++;
    room.joiners.set(socket.id, { position, username: socket.data.username });
    socket.data.role = 'joiner';
    socket.data.roomCode = roomCode;
    socket.join(roomCode);

    ack({ ok: true, position });
    io.to(room.hostId).emit('LOBBY_UPDATE', { joiners: lobbyOf(room) });
  });

  // HOT PATH: keep this handler trivial.
  socket.on('TRIGGER_SNAP', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    // `socket.to(code)` emits to room minus this socket (the host).
    socket.to(code).emit('SNAP_NOW');
  });

  socket.on('SUBMIT_PHOTO', (photoBuf) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    const joiner = room.joiners.get(socket.id);
    if (!joiner) return;
    io.to(room.hostId).emit('PHOTO_RECEIVED', {
      position: joiner.position,
      username: joiner.username,
      photo: photoBuf
    });
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (socket.data.role === 'host') {
      socket.to(code).emit('ROOM_CLOSED');
      rooms.delete(code);
    } else {
      room.joiners.delete(socket.id);
      io.to(room.hostId).emit('LOBBY_UPDATE', { joiners: lobbyOf(room) });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Wigglecam running on http://localhost:${PORT}`);
});
