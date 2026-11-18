'use strict';
// Образцы непереведённых раздач WPN: из архивов, где переводчик отбросил много раздач, берёт по 30 отброшенных
// и сводку заголовков (первая строка, цифры заменены на N). Ничего не меняет. Выход: pipeline/out/wpn_не_переведено.txt
const fs = require('fs'), path = require('path');
const Z = require('../gto/zipread.cjs'), V = require('../pipeline/convert.cjs');
const BACKING = process.env.BACKING_DIR || 'D:/маининг/реплеер';
const unrar = require(require.resolve('node-unrar-js', { paths: [process.cwd(), BACKING, __dirname] }));
const ROOT = path.join(__dirname, '..'), TMP = path.join(ROOT, 'gto', 'tmp'); fs.mkdirSync(TMP, { recursive: true });
const OUTF = path.join(ROOT, 'pipeline', 'out', 'wpn_не_переведено.txt');
const WANT = [/2608-WPN-6Gb\.rar$/i, /2607-WPN-5450Mb\.rar$/i, /2607-WPN-HL-954Mb\.rar$/i];
const L = [];
(async () => {
  for (const d of process.argv.slice(2)) for (const zf of fs.readdirSync(d).filter(f => /\.zip$/i.test(f)).map(f => path.join(d, f))) for (const e of Z.entries(zf)) {
    if (!WANT.some(r => r.test(e.name))) continue;
    console.log('Смотрю ' + e.name);
    const tmp = path.join(TMP, 'fails_' + process.pid + '.rar');
    await new Promise((res, rej) => { const o = fs.createWriteStream(tmp); const r = Z.openEntry(e); r.on('error', rej); o.on('error', rej); o.on('finish', res); r.pipe(o); });
    const heads = {}, samples = []; let seen = 0, bad = 0;
    try {
      const ex = await unrar.createExtractorFromData({ data: fs.readFileSync(tmp) });
      const r = ex.extract({ files: (fh) => !fh.flags.directory });
      for (const f of r.files) {
        if (!f.extraction) continue;
        const s = Buffer.from(f.extraction).subarray(0, 64 * 1024 * 1024).toString('utf8');
        for (const h of s.split(/\r?\n(?=[^\r\n]*Hand #)/)) {
          seen++;
          if (V.wpnToPS(h)) continue;
          bad++; const k = (h.split(/\r?\n/)[0] || '').replace(/\d+([.,]\d+)?/g, 'N').slice(0, 160); heads[k] = (heads[k] || 0) + 1;
          if (samples.length < 30) samples.push(f.fileHeader.name + '\n' + h.slice(0, 3000));
        }
        if (seen > 300000 && samples.length >= 30) break;
      }
    } catch (err) { L.push('ОШИБКА ' + err.message); }
    try { fs.unlinkSync(tmp); } catch (x) {}
    L.push('==== ' + e.name + ': просмотрено ' + seen + ', не переведено ' + bad);
    for (const [k, v] of Object.entries(heads).sort((a, b) => b[1] - a[1]).slice(0, 30)) L.push(v + ' | ' + k);
    L.push('---- образцы ----'); L.push(...samples.map(x => x + '\n........'));
  }
  fs.writeFileSync(OUTF, L.join('\n'));
  console.log('Готово: ' + OUTF);
})();
