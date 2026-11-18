'use strict';
// ПАРАЛЛЕЛЬНЫЙ ПРОХОД: оставшиеся источники делятся между N потоками (каждый — отдельный процесс node со своим
// состоянием в <главная папка>/shard_i), затем состояния складываются в главное и собираются итоги.
//   node tools/shards.cjs stats|v8 <главная папка out> <потоков> <память на поток, МБ> <память для слияния, МБ>
// Потоки — с приоритетом «ниже обычного» (PRIO=max — обычный): компьютером можно пользоваться.
// Можно прервать в любой момент: запуск снова продолжит каждый поток с его чекпоинта.
// Каждый поток слияние берёт один раз (метка потока записывается в главное состояние); после слияния папки потоков удаляются.
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process'), crypto = require('crypto');
const [kind, MAIN, NS, MEMS, MEMM] = process.argv.slice(2);
const N = +NS || 4, ROOT = path.join(__dirname, '..');
const script = kind === 'v8' ? 'pipeline/passV8.cjs' : 'pipeline/passStats.cjs';
const STATE = path.join(MAIN, kind === 'v8' ? 'v8_state.ndjson' : 'stats_state.ndjson');
const log = (s) => { const line = new Date().toTimeString().slice(0, 8) + ' ' + s; console.log(line); fs.appendFileSync(path.join(MAIN, 'потоки.log'), new Date().toISOString().slice(0, 19) + ' ' + s + '\n'); };
fs.mkdirSync(MAIN, { recursive: true });

// список уже пройденных источников главного состояния — первая строка файла состояния
function mainDone() {
  if (!fs.existsSync(STATE)) return [];
  const r = JSON.parse(require('../pipeline/common.cjs').firstLine(STATE)); const st = kind === 'v8' ? r[2] : r[1]; return st.done || [];
}
function allSources() {
  delete process.env.SOURCE_LIST; return require('../pipeline/common.cjs').sourceFiles();
}

(async () => {
  const shardDir = (i) => path.join(MAIN, 'shard_' + i);
  const planF = path.join(MAIN, 'потоки_план.json');
  let plan;
  if (fs.existsSync(planF)) { plan = JSON.parse(fs.readFileSync(planF, 'utf8')); log(`продолжаю: ${plan.n} потоков`); }
  else {
    const done = new Set(mainDone()), left = allSources().filter(f => !done.has(path.basename(f)));
    if (!left.length) { log('новых источников нет'); plan = { n: 0, lists: [], tags: [] }; }
    else {
      // поровну по объёму: самые большие — первыми, каждому потоку — в наименее загруженный
      const sz = left.map(f => [f, fs.statSync(f).size]).sort((a, b) => b[1] - a[1]);
      const n = Math.min(N, sz.length), lists = Array.from({ length: n }, () => []), load = new Array(n).fill(0);
      for (const [f, s] of sz) { let k = 0; for (let i = 1; i < n; i++) if (load[i] < load[k]) k = i; lists[k].push(f); load[k] += s; }
      lists.forEach(l => l.sort());
      plan = { n, lists, tags: lists.map(() => crypto.randomBytes(6).toString('hex')) };
      log(`осталось источников ${left.length} (${(sz.reduce((a, x) => a + x[1], 0) / 1073741824).toFixed(1)} ГБ) → ${n} потоков`);
    }
    fs.writeFileSync(planF, JSON.stringify(plan));
  }
  // ---- потоки ----
  if (plan.n) {
    const runOne = (i) => new Promise((res) => {
      const dir = shardDir(i); fs.mkdirSync(dir, { recursive: true });
      const lf = path.join(dir, 'список.json'); fs.writeFileSync(lf, JSON.stringify(plan.lists[i]));
      const env = Object.assign({}, process.env, { OUT_DIR: dir, SOURCE_LIST: lf, RESUME: '1', SHARD_TAG: plan.tags[i], KEEP_STATE: '1', STATE_ONLY: '1', IDSET_BITS: '24', CK_EVERY: process.env.CK_EVERY || '10' });
      delete env.MERGE_SHARDS; delete env.MAX_SOURCES;
      const ch = spawn(process.execPath, ['--max-old-space-size=' + (+MEMS || 4096), path.join(ROOT, script)], { env, cwd: ROOT });
      try { if (process.env.PRIO !== 'max') os.setPriority(ch.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) {}
      let last = '';
      const onData = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { last = l; if (/пройден|ГОТОВО|готов|ERR|Error|ОШИБКА|продолжаю/.test(l)) console.log('[' + (i + 1) + '/' + plan.n + '] ' + l.slice(0, 160)); } };
      ch.stdout.on('data', onData); ch.stderr.on('data', onData);
      ch.on('close', (code) => { log(`поток ${i + 1}: ${code === 0 ? 'готов' : 'ОСТАНОВИЛСЯ, код ' + code + ' — ' + last.slice(0, 200)}`); res(code); });
    });
    const codes = await Promise.all(plan.lists.map((_, i) => runOne(i)));
    if (codes.some(c => c !== 0)) { log('не все потоки дошли до конца — запустите снова, продолжат с чекпоинтов'); process.exit(1); }
  }
  // ---- слияние в главное состояние и итоги ----
  const dirs = Array.from({ length: plan.n }, (_, i) => shardDir(i)).filter(d => fs.existsSync(d));
  const empty = path.join(MAIN, 'пусто.json'); fs.writeFileSync(empty, '[]');
  log(`слияние ${dirs.length} потоков в главное состояние и итоги — начало`);
  const env = Object.assign({}, process.env, { OUT_DIR: MAIN, SOURCE_LIST: empty, RESUME: '1', KEEP_STATE: '1', MERGE_SHARDS: dirs.join(';') });
  delete env.SHARD_TAG; delete env.STATE_ONLY; delete env.IDSET_BITS;
  const code = await new Promise((res) => { const ch = spawn(process.execPath, ['--max-old-space-size=' + (+MEMM || 12288), path.join(ROOT, script)], { env, cwd: ROOT, stdio: 'inherit' }); ch.on('close', res); });
  if (code !== 0) { log('слияние остановилось, код ' + code + ' — запустите снова'); process.exit(1); }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(planF, { force: true });
  log('готово: потоки сложены, итоги собраны');
})();
