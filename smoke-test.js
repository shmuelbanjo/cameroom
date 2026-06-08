/**
 * Wigglecam protocol smoke test.
 *
 * Spins up live socket.io-client connections against the server (defaults to
 * http://localhost:3000) and walks the room lifecycle: auth gate, room create,
 * sequential position assignment, LOBBY_UPDATE shape, SNAP fanout to joiners
 * only, binary PHOTO_RECEIVED routing tagged with the joiner's username, and
 * disconnect cleanup.
 *
 * Run: `npm run test` (with the server already running)
 */
const { io } = require('socket.io-client');
const SERVER = process.env.SMOKE_SERVER || 'http://localhost:3000';

const results = [];
const check = (name, ok) => {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
};

function client(username) {
  return io(SERVER, { auth: { username }, forceNew: true, reconnection: false });
}

(async () => {
  // --- Auth gate ---
  const anonResult = await new Promise((r) => {
    const anon = io(SERVER, { forceNew: true, reconnection: false });
    anon.on('connect',       () => r({ rejected: false }));
    anon.on('connect_error', (e) => r({ rejected: true, message: e.message }));
    setTimeout(() => r({ rejected: false, message: 'TIMEOUT' }), 2000);
  });
  check('Anonymous connect rejected with "Invalid Username"',
    anonResult.rejected === true && anonResult.message === 'Invalid Username');

  // --- Authed clients ---
  const host = client('smoketest_host');
  const j1   = client('mira');
  const j2   = client('kai');
  await Promise.all([host, j1, j2].map((s) => new Promise((r) => s.on('connect', r))));

  // --- Room create ---
  const { ok: createOk, roomCode } = await new Promise((r) => host.emit('CREATE_ROOM', r));
  check('CREATE_ROOM returns 4-digit code', createOk && /^\d{4}$/.test(roomCode));

  // --- LOBBY_UPDATE arrives with username + position ---
  const lobbyAfterJ1 = new Promise((r) => host.once('LOBBY_UPDATE', ({ joiners }) => r(joiners)));
  const j1Ack = await new Promise((r) => j1.emit('JOIN_ROOM', { roomCode }, r));
  check('J1 ack: position 1', j1Ack.ok && j1Ack.position === 1);
  const lobby1 = await lobbyAfterJ1;
  check('LOBBY_UPDATE after J1 contains {position:1, username:"mira"}',
    Array.isArray(lobby1) && lobby1.length === 1 &&
    lobby1[0].position === 1 && lobby1[0].username === 'mira');

  const lobbyAfterJ2 = new Promise((r) => host.once('LOBBY_UPDATE', ({ joiners }) => r(joiners)));
  const j2Ack = await new Promise((r) => j2.emit('JOIN_ROOM', { roomCode }, r));
  check('J2 ack: position 2', j2Ack.ok && j2Ack.position === 2);
  const lobby2 = await lobbyAfterJ2;
  check('LOBBY_UPDATE after J2 has both joiners ordered by position',
    lobby2.length === 2 &&
    lobby2[0].position === 1 && lobby2[0].username === 'mira' &&
    lobby2[1].position === 2 && lobby2[1].username === 'kai');

  // --- Invalid room ---
  const stray = client('stray');
  await new Promise((r) => stray.on('connect', r));
  const badAck = await new Promise((r) => stray.emit('JOIN_ROOM', { roomCode: '9999' }, r));
  check('Invalid room rejected', !badAck.ok && badAck.error === 'ROOM_NOT_FOUND');
  stray.disconnect();

  // --- SNAP fanout ---
  let hostGotSnap = false;
  host.on('SNAP_NOW', () => { hostGotSnap = true; });
  const snapCount = await new Promise((r) => {
    let n = 0;
    const onSnap = () => { if (++n === 2) r(n); };
    j1.on('SNAP_NOW', onSnap);
    j2.on('SNAP_NOW', onSnap);
    host.emit('TRIGGER_SNAP');
    setTimeout(() => r(n), 1500);
  });
  check('Both joiners received SNAP_NOW', snapCount === 2);
  check('Host did not receive SNAP_NOW', !hostGotSnap);

  // --- Photo route carries username + position ---
  const got = [];
  host.on('PHOTO_RECEIVED', (d) => got.push(d));
  j1.emit('SUBMIT_PHOTO', Buffer.from([0xFF, 0xD8, 0xFF, 0x01]));
  j2.emit('SUBMIT_PHOTO', Buffer.from([0xFF, 0xD8, 0xFF, 0x02]));
  await new Promise((r) => setTimeout(r, 300));
  check('Host received 2 photos', got.length === 2);
  const byPos = Object.fromEntries(got.map((g) => [g.position, g]));
  check('Photo from position 1 tagged username "mira"', byPos[1] && byPos[1].username === 'mira');
  check('Photo from position 2 tagged username "kai"',  byPos[2] && byPos[2].username === 'kai');

  // --- Disconnect cleanup ---
  const lobbyAfterDC = new Promise((r) => host.once('LOBBY_UPDATE', ({ joiners }) => r(joiners)));
  j1.disconnect();
  const lobby3 = await lobbyAfterDC;
  check('LOBBY_UPDATE after J1 disconnect: only kai remains', lobby3.length === 1 && lobby3[0].username === 'kai');

  const closed = await new Promise((r) => {
    j2.once('ROOM_CLOSED', () => r(true));
    setTimeout(() => r(false), 1000);
    host.disconnect();
  });
  check('Host disconnect emits ROOM_CLOSED to remaining joiner', closed);
  j2.disconnect();

  // --- Summary ---
  const fails = results.filter((r) => !r.ok).length;
  console.log('\n' + (fails === 0 ? 'ALL PASS' : fails + ' FAILED') + '  (' + results.length + ' checks)');
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
