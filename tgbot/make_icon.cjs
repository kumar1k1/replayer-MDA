'use strict';
// Значок «TG-бот» (tgbot/ui/icon.ico): круг с градиентом и бумажный самолётик — рисуется без внешних программ (PNG внутри ICO)
const fs = require('fs'), path = require('path'), zlib = require('zlib');
function png(S) {
  const px = Buffer.alloc(S * S * 4);
  const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const k = S / 64; const sc = (P) => P.map(([x, y]) => [x * k, y * k]);
  const wing = sc([[48.6, 17.4], [13.9, 30.7], [22.3, 36.3], [42, 26.4], [28.5, 39.4], [27.9, 45.4], [33.6, 41.9], [42.6, 48.5], [45.9, 47.0], [51.4, 20.0]]);
  const SS = 4; // сглаживание
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let a = 0, w = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const X = x + (sx + 0.5) / SS, Y = y + (sy + 0.5) / SS, dx = X - S / 2, dy = Y - S / 2;
      if (dx * dx + dy * dy <= (S * 0.47) ** 2) { a++; if (inPoly(X, Y, wing)) w++; }
    }
    const t = (x + y) / (2 * S), o = (y * S + x) * 4, fa = a / (SS * SS), fw = a ? w / a : 0;
    const r = 58 + (108 - 58) * t, g = 160 + (92 - 160) * t, b = 255 + (231 - 255) * t;
    px[o] = Math.round(r + (255 - r) * fw); px[o + 1] = Math.round(g + (255 - g) * fw); px[o + 2] = Math.round(b + (255 - b) * fw); px[o + 3] = Math.round(255 * fa);
  }
  const raw = Buffer.alloc(S * (S * 4 + 1)); for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k2 = 0; k2 < 8; k2++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(S, 0); ih.writeUInt32BE(S, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [256, 64, 48, 32, 16], imgs = sizes.map(png);
const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = 6 + 16 * sizes.length; const dir = [];
sizes.forEach((s, i) => { const d = Buffer.alloc(16); d[0] = s === 256 ? 0 : s; d[1] = s === 256 ? 0 : s; d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(imgs[i].length, 8); d.writeUInt32LE(off, 12); off += imgs[i].length; dir.push(d); });
const out = path.join(__dirname, 'ui', 'icon.ico');
fs.writeFileSync(out, Buffer.concat([head, ...dir, ...imgs]));
fs.writeFileSync(path.join(__dirname, 'ui', 'icon.png'), imgs[0]);
console.log('значок:', out);
