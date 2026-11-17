// Потоковое чтение .zip без распаковки на диск (stored / deflate, zip64). Только встроенные модули Node.
const fs = require('fs'), zlib = require('zlib');
function readAt(fd, pos, len) { const b = Buffer.alloc(len); let o = 0; while (o < len) { const n = fs.readSync(fd, b, o, len - o, pos + o); if (!n) break; o += n; } return b.subarray(0, o); }
function entries(file) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size;
  const tailLen = Math.min(size, 65557 + 20), tail = readAt(fd, size - tailLen, tailLen);
  let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('не zip: нет конца каталога');
  let cdCount = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
  if (cdOff === 0xffffffff || cdCount === 0xffff) { // zip64
    const l = e - 20; if (l >= 0 && tail.readUInt32LE(l) === 0x07064b50) {
      const z64 = Number(tail.readBigUInt64LE(l + 8)), r = readAt(fd, z64, 56);
      cdCount = Number(r.readBigUInt64LE(32)); cdSize = Number(r.readBigUInt64LE(40)); cdOff = Number(r.readBigUInt64LE(48));
    }
  }
  const cd = readAt(fd, cdOff, cdSize), out = []; let p = 0;
  for (let k = 0; k < cdCount && p + 46 <= cd.length; k++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    let lho = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nl).toString(flags & 0x800 ? 'utf8' : 'latin1');
    let x = p + 46 + nl; const xe = x + xl;
    while (x + 4 <= xe) { const id = cd.readUInt16LE(x), sz = cd.readUInt16LE(x + 2); if (id === 1) { let q = x + 4; if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; } if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; } if (lho === 0xffffffff) { lho = Number(cd.readBigUInt64LE(q)); q += 8; } } x += 4 + sz; }
    out.push({ name, method, csize, usize, lho, dir: name.endsWith('/') });
    p = xe + cl;
  }
  fs.closeSync(fd); return out;
}
// поток распакованных байт одного файла архива
function openEntry(file, ent) {
  const fd = fs.openSync(file, 'r'), h = readAt(fd, ent.lho, 30); fs.closeSync(fd);
  if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('битый локальный заголовок: ' + ent.name);
  const start = ent.lho + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  const raw = fs.createReadStream(file, { start, end: start + ent.csize - 1, highWaterMark: 1 << 20 });
  if (ent.method === 0) return raw;
  if (ent.method === 8) return raw.pipe(zlib.createInflateRaw());
  throw new Error('метод сжатия ' + ent.method + ' не поддерживается: ' + ent.name);
}
// раздачи по одной из текстового файла внутри архива
async function* handsOf(file, ent) {
  let buf = '';
  for await (const ch of openEntry(file, ent)) {
    buf += ch.toString('utf8');
    let i; while ((i = buf.indexOf('PokerStars Hand #', 1)) > 0) { const h = buf.slice(0, i); buf = buf.slice(i); if (h.startsWith('PokerStars Hand #')) yield h; else if (/PokerStars Hand #/.test(h)) yield h.slice(h.indexOf('PokerStars Hand #')); }
  }
  if (buf.startsWith('PokerStars Hand #')) yield buf;
}
module.exports = { entries, openEntry, handsOf };
