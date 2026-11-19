'use strict';
// Перевод архивов новых румов (WPN, iPoker/RedStar) в истории формата PokerStars.
// Вход: папки с .zip (внутри .rar с .txt/.xml). Выход: OUT_ROOMS (по умолчанию <проект>\новые_румы) —
// файлы <рум>\<zip>__<rar>__NNN.txt.gz по ~150 МБ текста. Конвейер читает их как обычные источники.
// Идёт по одному .rar: копирует его во временный файл, переводит, удаляет. Прогресс — после каждого .rar
// (конвертация_готово.json + номера раздач для отсева повторов), закрыть окно можно в любой момент.
// .7z внутри zip пропускаются (их мало и они маленькие). Исходные архивы не меняются.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const Z = require('../gto/zipread.cjs'), V = require('../pipeline/convert.cjs');
const BACKING = process.env.BACKING_DIR || 'D:/маининг/реплеер';
const unrar = require(require.resolve('node-unrar-js', { paths: [process.cwd(), BACKING, __dirname] }));
const ROOT = path.join(__dirname, '..');
const OUTR = process.env.OUT_ROOMS || path.join(ROOT, 'новые_румы');
const TMP = path.join(ROOT, 'gto', 'tmp');
fs.mkdirSync(OUTR, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });
// CONV_TAG=wpn2 — повторный перевод (исправленный переводчик): свой список готовых, свои номера, своя папка вывода
const TAG = process.env.CONV_TAG || '';
const DONE_F = path.join(OUTR, 'конвертация_готово' + (TAG ? '_' + TAG : '') + '.json'), IDS_F = path.join(OUTR, 'конвертация_номера' + (TAG ? '_' + TAG : '') + '.bin');
const LOG_F = path.join(OUTR, 'конвертация' + (TAG ? '_' + TAG : '') + '.log');
const log = (s) => { console.log(s); fs.appendFileSync(LOG_F, new Date().toISOString().slice(0, 19) + ' ' + s + '\n'); };
const C = require('../pipeline/common.cjs');
const done = fs.existsSync(DONE_F) ? JSON.parse(fs.readFileSync(DONE_F, 'utf8')) : {};
const seen = fs.existsSync(IDS_F) ? C.loadIds(IDS_F) : new C.IdSet(27); // номера раздач (рум + номер), ~1 ГБ
const CHUNK = 150 * 1024 * 1024;

// остатки прерванного запуска
for (const d of ['wpn', 'ipoker', '888', 'chico', TAG].filter(Boolean)) { const p = path.join(OUTR, d); if (fs.existsSync(p)) for (const f of fs.readdirSync(p)) if (f.endsWith('.part')) fs.unlinkSync(path.join(p, f)); }
for (const f of fs.readdirSync(TMP)) if (/^conv_/.test(f)) try { fs.unlinkSync(path.join(TMP, f)); } catch (e) {}

function writerFor(room, base) {
  const dir = path.join(OUTR, room); fs.mkdirSync(dir, { recursive: true });
  let k = 0, parts = [], buf = [], size = 0;
  const flush = () => {
    if (!buf.length) return;
    const f = path.join(dir, base + '__' + String(++k).padStart(3, '0') + '.txt.gz.part');
    fs.writeFileSync(f, zlib.gzipSync(Buffer.from(buf.join('\n\n\n') + '\n\n\n', 'utf8'), { level: 6 }));
    parts.push(f); buf = []; size = 0;
  };
  return {
    add(t) { buf.push(t); size += t.length + 3; if (size >= CHUNK) flush(); },
    finish() { flush(); for (const f of parts) fs.renameSync(f, f.slice(0, -5)); return parts.length; },
  };
}
// текст файла кусками по границам раздач (файлы бывают больше лимита строки Node)
function* pieces(buf, isXml) {
  const STEP = 64 * 1024 * 1024; let carry = '';
  for (let o = 0; o < buf.length; o += STEP) {
    const s = carry + buf.subarray(o, Math.min(buf.length, o + STEP)).toString('utf8');
    if (o + STEP >= buf.length) { yield s; return; }
    const cut = isXml ? s.lastIndexOf('</game>') + 7 : Math.max(s.lastIndexOf('\nGame Hand #'), s.lastIndexOf('\n#Game No'), s.lastIndexOf('\nPokerStars Hand #'));
    if (cut <= 7) { carry = s; continue; }
    // в XML заголовок сессии перед следующей игрой должен остаться с ней: режем после </game>, хвост переносим
    yield s.slice(0, cut); carry = s.slice(cut);
  }
  if (carry) yield carry;
}

async function doRar(ent, key, room) {
  const tmp = path.join(TMP, 'conv_' + process.pid + '.rar');
  await new Promise((res, rej) => { const o = fs.createWriteStream(tmp); const r = Z.openEntry(ent); r.on('error', rej); o.on('error', rej); o.on('finish', res); r.pipe(o); });
  const st = { files: 0, hands: 0, dup: 0, bad: 0 };
  const base = key.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/\.rar$/i, '');
  const W = writerFor(room, base);
  try {
    const ex = await unrar.createExtractorFromData({ data: fs.readFileSync(tmp) });
    // один проход по архиву: файлы распаковываются по очереди, в памяти — только текущий
    const r = ex.extract({ files: (fh) => !fh.flags.directory && /\.(txt|xml)$/i.test(fh.name) });
    const sess = {};
    {
      for (const f of r.files) {
        if (!f.extraction) continue; const fh = f.fileHeader;
        st.files++;
        const b = Buffer.from(f.extraction), isXml = /\.xml$/i.test(fh.name);
        for (const s of pieces(b, isXml)) {
          const put = (t) => {
            const id = /Hand #(\d+)/.exec(t)[1];
            if (!seen.add(room, id)) { st.dup++; return; }
            st.hands++; W.add(t);
          };
          if (isXml) V.ipokerXmlToPS(s, put, sess);
          // формат текста — по содержимому: WPN «Game Hand #», 888 «#Game No», Chico — «PokerStars Hand #» со столами CHC_
          else if (/#Game No :/.test(s.slice(0, 4096))) { for (const h of s.split(/\r?\n(?=#Game No)/)) { if (!/^\s*#Game No/.test(h)) continue; const t = V.e888ToPS(h, fh.name); if (t) put(t); else st.bad++; } }
          else if (/PokerStars Hand #/.test(s.slice(0, 4096))) { for (const h of s.split(/\r?\n(?=PokerStars Hand #)/)) { if (!/^\s*PokerStars Hand #/.test(h)) continue; const t = V.chicoToPS(h, fh.name); if (t) put(t); else if (/^Table 'CHC_/m.test(h)) st.bad++; else st.notRoom = (st.notRoom || 0) + 1; } }
          else for (const h of s.split(/\r?\n(?=Game Hand #)/)) { if (!/^\s*Game Hand #/.test(h)) continue; const t = V.wpnToPS(h, fh.name); if (t) put(t); else st.bad++; }
        }
      }
    }
  } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  st.out = W.finish();
  return st;
}

(async () => {
  const dirs = process.argv.slice(2);
  const zips = []; for (const d of dirs) if (fs.existsSync(d)) for (const f of fs.readdirSync(d).sort()) if (/\.zip$/i.test(f)) zips.push(path.join(d, f));
  const jobs = [];
  for (const zf of zips) for (const e of Z.entries(zf)) if (!e.dir && /\.rar$/i.test(e.name)) jobs.push({ zf, e, key: path.basename(zf, '.zip') + '__' + path.basename(e.name) });
  const room = (j) => TAG || (/wpn/i.test(j.key) ? 'wpn' : /888/.test(j.key) ? '888' : /chico/i.test(j.key) ? 'chico' : 'ipoker');
  // ONLY_ZIPS=regex — только эти zip (например «888|chico»); SKIP_ZIPS — пропустить (по умолчанию Winamax)
  const onlyZ = process.env.ONLY_ZIPS ? new RegExp(process.env.ONLY_ZIPS, 'i') : null, skipZ = new RegExp(process.env.SKIP_ZIPS || 'winamax', 'i');
  for (let q = jobs.length - 1; q >= 0; q--) { const zb = path.basename(jobs[q].zf); if ((onlyZ && !onlyZ.test(zb)) || skipZ.test(zb)) jobs.splice(q, 1); }
  // SKIP_KEYS_FROM=файл.json — пропустить архивы, которые в прошлом переводе целиком оказались повторами других (0 новых раздач)
  const skipK = new Set(); if (process.env.SKIP_KEYS_FROM && fs.existsSync(process.env.SKIP_KEYS_FROM)) { const o = JSON.parse(fs.readFileSync(process.env.SKIP_KEYS_FROM, 'utf8')); for (const [k, v] of Object.entries(o)) if (v.hands === 0 && v.dup > 0) skipK.add(k); }
  if (skipK.size) log('пропускаю архивы-повторы: ' + [...skipK].join(', '));
  const left = jobs.filter(j => !done[j.key] && !skipK.has(j.key));
  log(`Архивов .rar всего ${jobs.length}, уже переведено ${jobs.length - left.length}, осталось ${left.length}`);
  let n = 0;
  for (const j of left) {
    n++; const t0 = Date.now();
    log(`[${n}/${left.length}] ${j.key} (${Math.round(j.e.csize / 1048576)} МБ) — начало`);
    try {
      const st = await doRar(j.e, j.key, room(j));
      done[j.key] = Object.assign({ room: room(j), at: new Date().toISOString() }, st);
      C.saveIds(seen, IDS_F);
      fs.writeFileSync(DONE_F, JSON.stringify(done, null, 1));
      log(`   готово за ${Math.round((Date.now() - t0) / 60000)} мин: файлов ${st.files}, раздач ${st.hands}, повторов ${st.dup}, не переведено ${st.bad}` + (st.notRoom ? `, чужих столов (не Chico) ${st.notRoom}` : ''));
    } catch (err) {
      log(`   ОШИБКА: ${err && err.message} — архив пропущен, будет повторён при следующем запуске`);
    }
  }
  const tot = Object.values(done).reduce((s, x) => s + (x.hands || 0), 0);
  log(`ВСЁ: переведено архивов ${Object.keys(done).length} из ${jobs.length}, раздач ${tot}. Папка: ${OUTR}`);
  if (Object.keys(done).length + skipK.size >= jobs.length && process.env.DONE_FLAG) fs.writeFileSync(process.env.DONE_FLAG, new Date().toISOString());
})();
