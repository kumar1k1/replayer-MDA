'use strict';
// Перевод новой базы (папка с zip: 888, Chico, PS, PS ES, WPN, iPoker, Coin; Winamax пропускается) — параллельно:
// каждый zip — отдельный процесс tools/convert_rooms.cjs со своей папкой вывода <OUT>/<рум>__<zip> (свои списки готового,
// поэтому потоки не мешают друг другу). Zip-повторы (то же имя рума и тот же размер) переводятся один раз.
// Можно прервать в любой момент: запуск снова продолжит каждый zip со следующего архива.
//   node tools/convert_new.cjs <папка с zip> <папка вывода> [потоков]
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const [SRC, OUTR, NP] = process.argv.slice(2);
const ROOT = path.join(__dirname, '..'), N = Math.max(1, +NP || 6);
const skipZ = new RegExp(process.env.SKIP_ZIPS || 'winamax', 'i');
const roomOfZip = (z) => /^PS[ _]ES/i.test(z) ? 'pses' : /^PS[-_ ]/i.test(z) ? 'ps' : /^Coin/i.test(z) ? 'coin' : /wpn/i.test(z) ? 'wpn' : /888/.test(z) ? '888' : /chico/i.test(z) ? 'chico' : /ipoker/i.test(z) ? 'ipoker' : null;
fs.mkdirSync(path.join(OUTR, 'флаги'), { recursive: true });
const log = (s) => { const l = new Date().toTimeString().slice(0, 8) + ' ' + s; console.log(l); fs.appendFileSync(path.join(OUTR, 'перевод.log'), new Date().toISOString().slice(0, 19) + ' ' + s + '\n'); };
const zips = fs.readdirSync(SRC).filter(f => /\.zip$/i.test(f) && !skipZ.test(f)).sort();
const seen = new Set(), jobs = [];
for (const z of zips) {
  const room = roomOfZip(z); if (!room) { log('не понял рум, пропускаю: ' + z); continue; }
  const sz = fs.statSync(path.join(SRC, z)).size, k = room + '|' + sz;
  if (seen.has(k)) { log('повтор архива (тот же рум и размер), пропускаю: ' + z); continue; } seen.add(k);
  const id = room + '__' + z.replace(/\.zip$/i, '').replace(/[^\w.-]+/g, '_');
  jobs.push({ z, room, id, size: sz, flag: path.join(OUTR, 'флаги', id + '.flag') });
}
// временные файлы прошлого запуска — один раз, до старта потоков
{ const TMP = path.join(ROOT, 'gto', 'tmp'); if (fs.existsSync(TMP)) for (const f of fs.readdirSync(TMP)) if (/^conv/.test(f)) try { fs.rmSync(path.join(TMP, f), { recursive: true, force: true }); } catch (e) {} }
const left = jobs.filter(j => !fs.existsSync(j.flag)).sort((a, b) => b.size - a.size); // большие — первыми
log(`zip всего ${jobs.length}, готово ${jobs.length - left.length}, осталось ${left.length}, потоков ${N}`);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const runOne = (j) => new Promise((res) => {
  const env = Object.assign({}, process.env, { CONV_NO_CLEAN: '1', CONV_IDS_BITS: '24', OUT_ROOMS: path.join(OUTR, j.id), ONLY_ZIPS: '^' + esc(j.z) + '$', SKIP_ZIPS: '^$', DONE_FLAG: j.flag });
  delete env.CONV_TAG;
  const ch = spawn(process.execPath, ['--max-old-space-size=' + (process.env.MEM || 4096), path.join(ROOT, 'tools', 'convert_rooms.cjs'), SRC], { env, cwd: ROOT });
  try { if (process.env.PRIO !== 'max') os.setPriority(ch.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) {}
  const on = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) console.log('[' + j.room + ' ' + j.z.slice(0, 28) + '] ' + l); };
  ch.stdout.on('data', on); ch.stderr.on('data', on);
  ch.on('close', (c) => { const ok = fs.existsSync(j.flag); log(j.z + ': ' + (ok ? 'готово' : 'НЕ ЗАКОНЧЕН, код ' + c)); res(ok); });
});
(async () => {
  const q = left.slice(); let bad = 0;
  // zip, где архив не прошёл, — ещё до двух попыток (переведённые архивы не повторяются)
  const tries = {};
  await Promise.all(Array.from({ length: Math.min(N, q.length) }, async () => { while (q.length) { const j = q.shift(); if (await runOne(j)) continue; tries[j.id] = (tries[j.id] || 0) + 1; if (tries[j.id] < 3) { log(j.z + ': повторю'); q.push(j); } else bad++; } }));
  // итог по всем zip: сколько раздач и брака
  const sum = {};
  for (const j of jobs) { const f = path.join(OUTR, j.id, 'конвертация_готово.json'); if (!fs.existsSync(f)) continue; const o = JSON.parse(fs.readFileSync(f, 'utf8')); const s = sum[j.room] = sum[j.room] || { архивов: 0, раздач: 0, повторов: 0, брак: 0, чужих: 0 }; for (const v of Object.values(o)) { s.архивов++; s.раздач += v.hands || 0; s.повторов += v.dup || 0; s.брак += v.bad || 0; s.чужих += v.notRoom || 0; } }
  fs.writeFileSync(path.join(OUTR, 'перевод_итог.json'), JSON.stringify(sum, null, 1));
  log('итог: ' + JSON.stringify(sum));
  if (bad) { log('не все zip переведены — запустите снова, продолжит'); process.exit(1); }
  log('перевод новой базы готов');
})();
