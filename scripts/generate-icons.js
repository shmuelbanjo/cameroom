// Zero-dependency PNG icon generator for the CameRoom PWA.
// Renders raw RGBA -> deflate -> PNG chunks; no native binaries needed.
//
// Output:
//   public/icons/icon-192.png     (Android home/launcher)
//   public/icons/icon-512.png     (Android splash)
//   public/icons/apple-touch-icon.png  180x180 (iOS home screen)
//
// Design: solid black square (analog camera body) with a centered white
// lens ring + inner white pupil + a single white shutter-release dot in
// the upper-right corner. Matches the Analog Script aesthetic.
//
// Run: node scripts/generate-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- CRC32 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, draw) {
  const stride = size * 4 + 1;          // +1 filter byte per row
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;                // filter: None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const o = y * stride + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8]  = 8;   // bit depth
  ihdr[9]  = 6;   // colour type: RGBA
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- Icon design ----
// All coords normalized to 0..1 against `size`. Returns [r,g,b,a].
function drawCameraLens(x, y, size) {
  const cx = size / 2, cy = size / 2;
  const dx = x - cx, dy = y - cy;
  const r  = Math.sqrt(dx * dx + dy * dy) / (size / 2);

  // Ring geometry (lens iris)
  const RING_OUTER  = 0.66;
  const RING_INNER  = 0.50;
  const PUPIL       = 0.18;

  // Shutter dot (top-right)
  const shutterCx = size * 0.78;
  const shutterCy = size * 0.22;
  const shutterR  = size * 0.055;
  const dsx = x - shutterCx, dsy = y - shutterCy;
  const insideShutter = (dsx * dsx + dsy * dsy) <= shutterR * shutterR;

  // Default: black body
  let on = false;

  if (r <= RING_OUTER && r >= RING_INNER) on = true;   // lens ring
  if (r <= PUPIL) on = true;                            // pupil highlight
  if (insideShutter) on = true;                         // shutter dot

  return on ? [255, 255, 255, 255] : [0, 0, 0, 255];
}

// ---- Emit ----
const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
  { size: 180, name: 'apple-touch-icon.png' }
];

for (const { size, name } of targets) {
  const png = encodePng(size, drawCameraLens);
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  console.log(`Wrote ${name}  ${size}x${size}  ${png.length} bytes`);
}
