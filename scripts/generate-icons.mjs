/**
 * Generates every app icon OpenCall ships, with no image dependencies.
 *
 * Writes raster icons with a hand-rolled PNG encoder (zlib is built into Node)
 * so the repository stays free of binary tooling, plus a Windows .ico that
 * embeds the same PNGs. Run with: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ PNG ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------------------------------------------- raster ---- */

const BG = [14, 14, 20]; // charcoal #0e0e14
const ACCENT = [76, 160, 255]; // #4ca0ff
const FG = [244, 244, 244]; // #f4f4f4

/**
 * Draws the OpenCall mark: a charcoal tile carrying an accent ring with a
 * light centre dot (a "connection" glyph that stays legible at 16 px).
 */
function render(size, { square = false, glyph = 1, transparent = false } = {}) {
  const SS = 4; // supersampling factor for antialiasing
  const rgba = Buffer.alloc(size * size * 4);
  const centre = size / 2;
  const radius = size * 0.225;

  const ringOuter = size * 0.315 * glyph;
  const ringInner = size * 0.205 * glyph;
  const dotRadius = size * 0.072 * glyph;

  const inTile = (x, y) => {
    if (square || transparent) return true;
    const dx = Math.max(Math.abs(x - centre) - (size / 2 - radius), 0);
    const dy = Math.max(Math.abs(y - centre) - (size / 2 - radius), 0);
    return Math.hypot(dx, dy) - radius <= 0;
  };

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          if (!inTile(x, y)) continue;
          const d = Math.hypot(x - centre, y - centre);
          const inRing = d >= ringInner && d <= ringOuter;
          const inDot = d <= dotRadius;
          if (transparent && !inRing && !inDot) continue;
          const colour = inRing ? ACCENT : inDot ? FG : BG;
          // premultiplied accumulation keeps the rounded edges free of fringes
          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 255;
        }
      }
      const samples = SS * SS;
      const offset = (py * size + px) * 4;
      if (a === 0) continue;
      // colour averages across covered samples, alpha across all samples —
      // uncovered samples contribute to neither, so edges stay fringe-free
      rgba[offset] = Math.round(r / (a / 255));
      rgba[offset + 1] = Math.round(g / (a / 255));
      rgba[offset + 2] = Math.round(b / (a / 255));
      rgba[offset + 3] = Math.round(a / samples);
    }
  }
  return rgba;
}

/* ---------------------------------------------------------------- .ico ---- */

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const directory = [];
  for (const { size, png } of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32BE(0, 8);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    directory.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...directory, ...entries.map((e) => e.png)]);
}

/* -------------------------------------------------------------- outputs ---- */

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  const kb = (data.length / 1024).toFixed(1);
  console.log(`  ${path.replace(root + '\\', '').replace(root + '/', '')}  ${kb} kB`);
}

console.log('Generating OpenCall icons');

const bitmap = (size, options) => encodePng(size, size, render(size, options));

const pwa = join(root, 'public', 'icons');
write(join(pwa, 'icon-192.png'), bitmap(192));
write(join(pwa, 'icon-512.png'), bitmap(512));
write(join(pwa, 'icon-maskable-512.png'), bitmap(512, { square: true, glyph: 0.62 }));
write(join(pwa, 'apple-touch-icon.png'), bitmap(180, { square: true }));
write(join(pwa, 'favicon-32.png'), bitmap(32));
write(join(root, 'public', 'favicon.png'), bitmap(256));

const tauri = join(root, 'src-tauri', 'icons');
const icoSizes = [16, 32, 48, 64, 256];
const icoEntries = icoSizes.map((size) => ({ size, png: bitmap(size) }));

write(join(tauri, '32x32.png'), bitmap(32));
write(join(tauri, '128x128.png'), bitmap(128));
write(join(tauri, '128x128@2x.png'), bitmap(256));
write(join(tauri, 'icon.png'), bitmap(512));
write(join(tauri, 'icon.ico'), encodeIco(icoEntries));
write(join(root, 'public', 'favicon.ico'), encodeIco(icoEntries));

/* Android launcher icons: legacy rasters plus the adaptive foreground layer.
   The adaptive background comes from res/values/ic_launcher_background.xml. */
const androidRes = join(root, 'android', 'app', 'src', 'main', 'res');
const legacyPx = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const adaptivePx = { mdpi: 81, hdpi: 108, xhdpi: 162, xxhdpi: 324, xxxhdpi: 432 };
for (const [dpi, px] of Object.entries(legacyPx)) {
  const dir = join(androidRes, `mipmap-${dpi}`);
  write(join(dir, 'ic_launcher.png'), bitmap(px));
  write(join(dir, 'ic_launcher_round.png'), bitmap(px, { square: true }));
  // 0.62 keeps the glyph inside the 66 dp safe zone of the 108 dp canvas.
  write(join(dir, 'ic_launcher_foreground.png'), bitmap(adaptivePx[dpi], {
    square: true,
    transparent: true,
    glyph: 0.62,
  }));
}

console.log('Done.');
