// 生成扩展图标 PNG（与 site-tweaker/icons/icon.svg 同一图案）：node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'site-tweaker', 'icons');
const SIZES = [16, 32, 48, 128];
const SAMPLES = 5; // 每像素 5x5 超采样做抗锯齿

// 图案坐标基于 128x128 画布
const BG_FROM = [0x6b, 0x6b, 0xf2];
const BG_TO = [0x9b, 0x4f, 0xe8];
const SEGMENTS = [
  [44, 40, 20, 64], [20, 64, 44, 88], // <
  [84, 40, 108, 64], [108, 64, 84, 88], // >
  [72, 32, 56, 96], // /
];

function inRoundRect(x, y) {
  const r = 30, min = 4, max = 124;
  const cx = Math.min(Math.max(x, min + r), max - r);
  const cy = Math.min(Math.max(y, min + r), max - r);
  return x >= min && x <= max && y >= min && y <= max && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function segDist(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function render(size) {
  const scale = 128 / size;
  // 小尺寸时把线条稍微加粗，保证清晰
  const half = Math.max(6, 0.85 * scale);
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const ux = (x + (sx + 0.5) / SAMPLES) * scale;
          const uy = (y + (sy + 0.5) / SAMPLES) * scale;
          if (!inRoundRect(ux, uy)) continue;
          bg++;
          if (SEGMENTS.some((s) => segDist(ux, uy, s) <= half)) fg++;
        }
      }
      const total = SAMPLES * SAMPLES;
      const i = (y * size + x) * 4;
      if (!bg) continue;
      const t = ((x + 0.5) / size + (y + 0.5) / size) / 2;
      const base = BG_FROM.map((c, k) => c + (BG_TO[k] - c) * t);
      const f = fg / bg;
      px[i] = Math.round(base[0] + (255 - base[0]) * f);
      px[i + 1] = Math.round(base[1] + (255 - base[1]) * f);
      px[i + 2] = Math.round(base[2] + (255 - base[2]) * f);
      px[i + 3] = Math.round((255 * bg) / total);
    }
  }
  return encodePng(size, size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of SIZES) {
  const file = path.join(OUT, `icon${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log('wrote', path.relative(process.cwd(), file));
}
