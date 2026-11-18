'use strict';
// Повторный перевод WPN и iPoker одновременно: два процесса (у румов разные номера раздач — повторы между ними невозможны).
// Каждый — с низким приоритетом (PRIO=max — обычный). Готово, когда оба поставили флаг; запуск снова продолжит недоделанное.
//   node tools/convert_parallel.cjs <папка WPN> <папка iPoker>
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), ROOMS = process.env.OUT_ROOMS || path.join(ROOT, 'новые_румы');
const [WPN, IPK] = process.argv.slice(2);
const jobs = [
  { tag: 'wpn3', dir: WPN, skip: null },
  { tag: 'ipoker3', dir: IPK, skip: path.join(ROOMS, 'конвертация_готово.json') },
];
(async () => {
  const codes = await Promise.all(jobs.map(j => new Promise((res) => {
    const flag = path.join(ROOMS, j.tag + '_готово.flag'); if (fs.existsSync(flag)) { console.log(j.tag + ': уже переведено'); return res(0); }
    const env = Object.assign({}, process.env, { CONV_TAG: j.tag, DONE_FLAG: flag }); if (j.skip) env.SKIP_KEYS_FROM = j.skip;
    const ch = spawn(process.execPath, ['--max-old-space-size=' + (process.env.MEM || 12288), path.join(ROOT, 'tools', 'convert_rooms.cjs'), j.dir], { env, cwd: ROOT });
    try { if (process.env.PRIO !== 'max') os.setPriority(ch.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) {}
    const on = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) console.log('[' + j.tag + '] ' + l); };
    ch.stdout.on('data', on); ch.stderr.on('data', on); ch.on('close', (c) => res(fs.existsSync(flag) ? 0 : c || 1));
  })));
  if (codes.some(c => c !== 0)) { console.log('Перевод не закончен — запустите снова, продолжит со следующего архива.'); process.exit(1); }
  console.log('Перевод WPN и iPoker готов.');
})();
