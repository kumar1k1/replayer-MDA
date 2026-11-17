// Потоковое чтение .zip без распаковки на диск (stored / deflate, zip64). Только встроенные модули Node.
const fs = require('fs'), zlib = require('zlib');
function readAt(fd, pos, len) { const b = Buffer.alloc(len); let o = 0; while (o < len) { const n = fs.readSync(fd, b, o, len - o, pos + o); if (!n) break; o += n; } return b.subarray(0, o); }
// src — путь к файлу или { file, off, len } (zip, лежащий внутри другого zip без сжатия)
const S = (src) => typeof src === 'string' ? { file: src, off: 0, len: null } : src;
function entries(src0) {
  const src = S(src0), fd = fs.openSync(src.file, 'r'), size = src.len == null ? fs.fstatSync(fd).size : src.len, B = src.off;
  const tailLen = Math.min(size, 65557 + 20), tail = readAt(fd, B + size - tailLen, tailLen);
  let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('не zip: нет конца каталога');
  let cdCount = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
  if (cdOff === 0xffffffff || cdCount === 0xffff) { // zip64
    const l = e - 20; if (l >= 0 && tail.readUInt32LE(l) === 0x07064b50) {
      const z64 = Number(tail.readBigUInt64LE(l + 8)), r = readAt(fd, B + z64, 56);
      cdCount = Number(r.readBigUInt64LE(32)); cdSize = Number(r.readBigUInt64LE(40)); cdOff = Number(r.readBigUInt64LE(48));
    }
  }
  const cd = readAt(fd, B + cdOff, cdSize), out = []; let p = 0;
  for (let k = 0; k < cdCount && p + 46 <= cd.length; k++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    let lho = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nl).toString(flags & 0x800 ? 'utf8' : 'latin1');
    let x = p + 46 + nl; const xe = x + xl;
    while (x + 4 <= xe) { const id = cd.readUInt16LE(x), sz = cd.readUInt16LE(x + 2); if (id === 1) { let q = x + 4; if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; } if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; } if (lho === 0xffffffff) { lho = Number(cd.readBigUInt64LE(q)); q += 8; } } x += 4 + sz; }
    out.push({ name, method, csize, usize, lho: B + lho, file: src.file, dir: name.endsWith('/') });
    p = xe + cl;
  }
  fs.closeSync(fd); return out;
}
// поток распакованных байт одного файла архива
function dataStart(ent) { const fd = fs.openSync(ent.file, 'r'), h = readAt(fd, ent.lho, 30); fs.closeSync(fd); if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('битый локальный заголовок: ' + ent.name); return ent.lho + 30 + h.readUInt16LE(26) + h.readUInt16LE(28); }
// все файлы, включая вложенные zip (рекурсивно); у вложенных name = 'внешний.zip/внутренний'.
// Вложенный zip без сжатия читается на месте; сжатый — распаковывается во временный файл TMP (по одному, удаляется вызывающим через cleanup).
const path = require('path');
const TMP = process.env.GTO_TMP || path.join(__dirname, 'tmp');
async function extractTo(ent, dest) { fs.mkdirSync(path.dirname(dest), { recursive: true }); await new Promise((res, rej) => { const w = fs.createWriteStream(dest); const r = openEntry(ent); r.on('error', rej); w.on('error', rej); w.on('finish', res); r.pipe(w); }); return dest; }
// перечислить вложенные архивы верхнего уровня: [{ name, ent, nested: bool }]
function walk(src, prefix = '', depth = 0) {
  const out = [];
  for (const e of entries(src)) {
    if (e.dir) continue;
    if (/\.zip$/i.test(e.name) && e.method === 0 && depth < 4) { try { for (const x of walk({ file: e.file, off: dataStart(e), len: e.csize }, prefix + e.name + '/', depth + 1)) out.push(x); continue; } catch (err) { e.err = err.message; } }
    e.name = prefix + e.name; e.zipped = /\.zip$/i.test(e.name) && e.method !== 0; out.push(e);
  }
  return out;
}
// открыть сжатый вложенный zip: распаковать во временный файл, вернуть его файлы и функцию удаления
async function openNested(e, i = 0) {
  const dest = path.join(TMP, 'n' + process.pid + '_' + i + '.zip');
  await extractTo(e, dest);
  const inner = walk(dest, e.name + '/', 1);
  return { files: inner, cleanup() { try { fs.unlinkSync(dest); } catch (x) {} } };
}
function openEntry(file, ent) {
  if (ent === undefined) { ent = file; } file = ent.file;
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
  if (ent === undefined) { ent = file; file = ent.file; }
  let buf = '';
  for await (const ch of openEntry(file, ent)) {
    buf += ch.toString('utf8');
    let i; while ((i = buf.indexOf('PokerStars Hand #', 1)) > 0) { const h = buf.slice(0, i); buf = buf.slice(i); if (h.startsWith('PokerStars Hand #')) yield h; else if (/PokerStars Hand #/.test(h)) yield h.slice(h.indexOf('PokerStars Hand #')); }
  }
  if (buf.startsWith('PokerStars Hand #')) yield buf;
}
module.exports = { entries, walk, openEntry, handsOf, openNested, TMP };
