'use strict';
// Общие части конвейера v7: поиск парсера Backing, обход архивов/папок с историями, деление базы на половины,
// бакеты стеков, страты, разметка префлоп-спотов (та же логика контекстов, что в passBC_v6, плюс то, чего там не было:
// вложено до решения, размер стола, баунти).
const fs = require('fs');
const path = require('path');

// ---------- где лежит проект Backing (ветка Clever-Replay): парсер генерируется из его replayer.html ----------
const BACKING = process.env.BACKING_DIR || ['D:/маининг/реплеер', path.join(__dirname, '..', '..', 'backing')].find(d => fs.existsSync(path.join(d, 'pipeline', 'parser.cjs'))) || '';
// ---------- нормализация текста раздачи перед парсером Backing (сам парсер не меняем) ----------
// Найдено проверкой tests/audit_parser.cjs на реальных архивах:
//  • «posts big blind 27 and is all-in» (и анте/МБ олл-ином) парсер пропускал — вложение терялось, банк не сходился;
//  • «folds [Ah Kc]» (фолд с показом карт) парсер пропускал — игрок оставался «в раздаче».
function normalizeHand(t) {
  // • суммы с разделителем тысяч («bets 1,335», «collected 5,205») — экспорт GG в формате PokerStars; парсер их терял
  let p; do { p = t; t = t.replace(/(\d),(\d{3})(?!\d)/g, '$1$2'); } while (t !== p);
  return t.replace(/^(.+?: posts (?:the ante|small blind|big blind) [\d.]+) and is all-in[ \t]*$/gm, '$1')
          .replace(/^(.+?: folds) \[[^\]]*\][ \t]*$/gm, '$1');
}
// рум по заголовку
function roomOf(t) { return /^\s*CoinPoker/.test(t) ? 'coin' : /^\s*PokerStars/.test(t) ? 'ps' : /^\s*Poker Hand #/.test(t) ? 'gg' : 'other'; }
// CoinPoker в экспорте показывает у ПОБЕДИТЕЛЯ только карты, которые играют (одна карта вместо двух) —
// вскрытия CoinPoker смещены (12% вскрытий, все — победители). Их нельзя брать в диапазоны и поправку на олл-ин.
const SHOWDOWN_TRUSTED = (room) => room !== 'coin';
function makeParse(parser) { return (text) => parser.parseHand(normalizeHand(text) + '\n'); }

// ---------- игрок и формат стола (п.2) ----------
// Ключ игрока — «рум:ник»: одинаковый ник в разных румах — разные игроки (если владелец не объявит их одним, см. ALIASES).
const playerKey = (room, nick) => room + ':' + nick;
// Формат стола — по заголовку «Table '…' N-max» (а не по числу севших): 'short' — до 6 мест, 'full' — 7–9 мест.
// Кластеры тренера рассчитаны на полных столах; статы со столов short переводятся на шкалу full (п.4).
function tableFormat(text) {
  const m = /^Table '.*?' (\d+)-max/m.exec(text);
  const max = m ? +m[1] : 0;
  return { max, fmt: max && max <= 6 ? 'short' : 'full' };
}

// ---------- целостность раздачи: вложено всеми = банк, выиграно = банк − рейк ----------
// На реальных архивах ~0,002% историй повреждены в источнике (пропущены строки рейза, улицы) — такие отбрасываем.
function handIntact(rp, fin, text) {
  const m = /Total pot ([\d.,]+)[^\n]*?(?:Rake|CC|Fee)\s*([\d.,]+)/i.exec(text);
  if (!m) return false;
  const num = (x) => parseFloat(String(x).replace(/,/g, '')), pot = num(m[1]), rake = num(m[2]);
  const eps = Math.max(0.011, rp.bb * 0.0005) * rp.n;
  let inv = 0, won = 0;
  for (let i = 0; i < rp.n; i++) { inv += rp.stacks[i] - fin.stacks[i] + fin.won[i]; won += fin.won[i]; if (fin.stacks[i] < -eps) return false; }
  return Math.abs(inv - pot) <= eps && Math.abs(won - (pot - rake)) <= eps;
}

// ---------- повторы раздач: множество номеров (рум + номер) в открытой адресации на Float64Array ----------
// 100 млн номеров ≈ 1 ГБ при ёмкости 2^27. Номер раздачи у PS/CoinPoker — до ~3e11; рум кодируется сдвигом 1e12.
class IdSet {
  constructor(bits) { this.cap = 2 ** (bits || +(process.env.IDSET_BITS || 27)); this.mask = this.cap - 1; this.t = new Float64Array(this.cap); this.n = 0; }
  key(room, id) { return ({ ps: 1, coin: 2, gg: 3 }[room] || 4) * 1e12 + (+id % 1e12) + 1; }
  add(room, id) { // true — новый, false — повтор
    const k = this.key(room, id); if (!isFinite(k)) return true;
    let h = (Math.imul((k % 4294967296) >>> 0, 2654435761) ^ Math.floor(k / 4294967296)) >>> 0, i = h & this.mask;
    while (this.t[i] !== 0) { if (this.t[i] === k) return false; i = (i + 1) & this.mask; }
    if (this.n > this.cap * 0.85) throw new Error('IdSet переполнен: увеличьте IDSET_BITS');
    this.t[i] = k; this.n++; return true;
  }
}

// ---------- чекпоинты по архивам: прогон частями (П.10) ----------
// Состояние пишется построчно (NDJSON) через временный файл и переименование — обрыв посреди записи не портит прошлый чекпоинт.
// Читается потоково: на полной базе файл в сотни МБ, целиком строкой его не прочитать (предел длины строки V8).
// MAX_SOURCES=N — пройти N новых архивов и выйти с кодом 3 («часть готова»); ЗАПУСК.cmd продолжит со следующего.
function ndWriter(file) {
  const tmp = file + '.tmp', fd = fs.openSync(tmp, 'w'); let buf = [], len = 0;
  const flush = () => { if (buf.length) { fs.writeSync(fd, buf.join('\n') + '\n'); buf = []; len = 0; } };
  return { put(row) { const s = JSON.stringify(row); buf.push(s); len += s.length; if (len > 8e6) flush(); }, close() { flush(); fs.closeSync(fd); fs.renameSync(tmp, file); } };
}
async function ndRead(file, onRow) {
  const rl = require('readline').createInterface({ input: fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  for await (const ln of rl) if (ln) onRow(JSON.parse(ln));
}
function saveIds(ids, file) { const tmp = file + '.tmp'; const fd = fs.openSync(tmp, 'w'); const hdr = Buffer.alloc(16); hdr.writeDoubleLE(ids.cap, 0); hdr.writeDoubleLE(ids.n, 8); fs.writeSync(fd, hdr); const b = Buffer.from(ids.t.buffer, ids.t.byteOffset, ids.t.byteLength); for (let o = 0; o < b.length; o += 1 << 28) fs.writeSync(fd, b, o, Math.min(1 << 28, b.length - o)); fs.closeSync(fd); fs.renameSync(tmp, file); }
function loadIds(file) { const fd = fs.openSync(file, 'r'); const hdr = Buffer.alloc(16); fs.readSync(fd, hdr, 0, 16, 0); const cap = hdr.readDoubleLE(0), n = hdr.readDoubleLE(8); const ids = new IdSet(Math.round(Math.log2(cap))); const b = Buffer.from(ids.t.buffer); for (let o = 0; o < b.length; o += 1 << 28) fs.readSync(fd, b, o, Math.min(1 << 28, b.length - o), 16 + o); fs.closeSync(fd); ids.n = n; return ids; }
const MAX_SOURCES = +(process.env.MAX_SOURCES || 0);
const PART_EXIT = 3;
// прогресс по шагам для ЗАПУСК.cmd / СТАТУС.cmd: out/progress.json = { шаг: { done, total, at } }
let _srcN = null;
function progress(step, done) {
  try {
    if (_srcN === null) _srcN = sourceFiles().length;
    const f = path.join(OUT, 'progress.json'); let p = {};
    try { p = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
    p[step] = { done, total: _srcN, at: new Date().toISOString() };
    fs.writeFileSync(f + '.tmp', JSON.stringify(p)); fs.renameSync(f + '.tmp', f);
  } catch (e) {}
}
function partLimiter() { let k = 0; return { hit() { k++; return MAX_SOURCES > 0 && k >= MAX_SOURCES; }, count: () => k }; }

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
      else if ((/\.rar$/i.test(f) || /\.txt$/i.test(f)) && !(/h2n[-_]?3/i.test(f) && !/h2n[-_]?4/i.test(f)) && !skip.has(f)) files.push(p);
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
// SAMPLE=N — взять каждую N-ю раздачу (по хэшу номера, а не подряд): для сайзингов и лайнапа четверти базы хватает
// с запасом, а проход в разы быстрее. Отбор не зависит от половин A/B (другие биты хэша).
const SAMPLE = +(process.env.SAMPLE || 1);
function sampled(h) {
  if (SAMPLE <= 1) return true;
  const m = /Hand #(\d+)/.exec(h); if (!m) return true;
  let x = 2166136261; const s = m[1]; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  return ((x >>> 11) % SAMPLE) === 0;
}
function* splitHands(txt, fp) {
  for (const h of txt.split(/\n(?=.*?Hand #)/)) if (/Hand #/.test(h) && sampled(h)) yield { hand: h, fp };
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



module.exports = Object.assign({ progress, ndWriter, ndRead, saveIds, loadIds, MAX_SOURCES, PART_EXIT, partLimiter, playerKey, tableFormat, handIntact, normalizeHand, roomOf, SHOWDOWN_TRUSTED, makeParse, IdSet, netAdjusted, BACKING, loadParser, backingOut, OUT, log, halfOf, sourceFiles, iterHands, splitHands }, SP);
