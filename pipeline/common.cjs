'use strict';
// Общие части конвейера v7: поиск парсера Backing, обход архивов/папок с историями, деление базы на половины,
// бакеты стеков, страты, разметка префлоп-спотов (та же логика контекстов, что в passBC_v6, плюс то, чего там не было:
// вложено до решения, размер стола, баунти).
const fs = require('fs');
const path = require('path');

// ---------- где лежит проект Backing (ветка Clever-Replay): парсер генерируется из его replayer.html ----------
const BACKING = process.env.BACKING_DIR || ['D:/маининг/реплеер', path.join(__dirname, '..', '..', 'backing')].find(d => fs.existsSync(path.join(d, 'pipeline', 'parser.cjs'))) || '';
function loadParser() {
  if (!BACKING) throw new Error('Не найден проект Backing (parser.cjs). Укажите BACKING_DIR=<папка реплеера>');
  return require(path.join(BACKING, 'pipeline', 'parser.cjs'));
}
function backingOut() { return path.join(BACKING, 'pipeline', 'out'); }

const OUT = process.env.OUT_DIR || path.join(__dirname, 'out');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(path.join(OUT, 'progress_v7.log'), new Date().toISOString().slice(0, 19) + ' ' + s + '\n'); };

// ---------- деление базы на две половины по номеру раздачи (для честной оценки топов) ----------
// Половина A — по ней выбираются топы; половина B — по ней меряется их игра. Номер раздачи → FNV-хэш → бит.
function halfOf(handId) {
  let h = 2166136261; const s = String(handId);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 7) & 1 ? 'B' : 'A';
}

// ---------- обход базы ----------
// RAW_DIRS="папка1;папка2" — папки с .rar и/или .txt (по умолчанию raw и raw-ps проекта Backing).
// SKIP="2608-PS-.rar;…" — архивы, которые пропускать. DONE — множество уже пройденных (для ресюма).
function sourceFiles() {
  const dirs = (process.env.RAW_DIRS ? process.env.RAW_DIRS.split(';') : [path.join(BACKING, 'raw'), path.join(BACKING, 'raw-ps')]).filter(d => d && fs.existsSync(d));
  const skip = new Set((process.env.SKIP || '2608-PS-.rar').split(';').filter(Boolean));
  const files = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f), st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if ((/\.rar$/i.test(f) || /\.txt$/i.test(f)) && !/h2n[-_]?3/i.test(f) && !skip.has(f)) files.push(p);
    }
  };
  dirs.forEach(walk);
  return files.sort();
}
async function* iterHands(files, done) {
  let unrar = null;
  for (const file of files) {
    const base = path.basename(file);
    if (done && done.has(base)) continue;
    if (/\.txt$/i.test(file)) {
      yield* splitHands(fs.readFileSync(file, 'utf8'), base);
    } else {
      if (!unrar) unrar = require(require.resolve('node-unrar-js', { paths: [process.cwd(), BACKING, __dirname] }));
      const extractor = await unrar.createExtractorFromData({ data: fs.readFileSync(file) });
      const list = [...extractor.getFileList().fileHeaders].filter(f => f.name.endsWith('.txt') && !/h2n3/i.test(f.name));
      for (const fh of list) {
        const ex = extractor.extract({ files: [fh.name] });
        for (const f of ex.files) if (f.extraction) yield* splitHands(Buffer.from(f.extraction).toString('utf8'), fh.name);
      }
    }
    yield { end: base }; // конец источника — точка для чекпоинта
  }
}
function* splitHands(txt, fp) {
  for (const h of txt.split(/\n(?=.*?Hand #)/)) if (/Hand #/.test(h)) yield { hand: h, fp };
}

const SP = require('../lib/spots.js');
const K = require('../lib/cards.js');

// ---------- итог с поправкой на олл-ин ----------
// inv_i = стек − конечный стек + выигрыш. Если в конце 2+ претендента, все вскрыты, вложили поровну
// (неуравненное уже вернулось), а последняя ставка была до ривера — итог = эквити × весь банк − вложено.
function netAdjusted(rp, fin, SD) {
  const n = rp.n, inv = new Array(n), net = new Array(n);
  for (let i = 0; i < n; i++) { inv[i] = rp.stacks[i] - fin.stacks[i] + fin.won[i]; net[i] = fin.stacks[i] - rp.stacks[i]; }
  const live = []; for (let i = 0; i < n; i++) if (!fin.folded[i] && inv[i] > 0) live.push(i);
  if (live.length < 2 || !live.every(i => SD[i]) || !live.some(i => fin.allin[i])) return { net, adj: false };
  const m = inv[live[0]]; if (!live.every(i => Math.abs(inv[i] - m) <= Math.max(1, rp.bb * 0.01))) return { net, adj: false };
  let lastSt = 0; for (const e of rp.ev) if ('rcb'.indexOf(e.t) >= 0 && e.st >= 0) lastSt = Math.max(lastSt, e.st);
  if (lastSt >= 3) return { net, adj: false };
  const nb = lastSt === 0 ? 0 : lastSt === 1 ? 3 : 4;
  const board = (rp.bd || []).slice(0, nb).map(K.cid);
  if (board.length !== nb || board.some(c => c < 0)) return { net, adj: false };
  const eq = K.equity(live.map(i => SD[i].c), board, 500);
  const P = inv.reduce((s, x) => s + x, 0);
  const out = net.slice(); live.forEach((i, j) => { out[i] = eq[j] * P - inv[i]; });
  return { net: out, adj: true };
}



module.exports = Object.assign({ netAdjusted, BACKING, loadParser, backingOut, OUT, log, halfOf, sourceFiles, iterHands, splitHands }, SP);
