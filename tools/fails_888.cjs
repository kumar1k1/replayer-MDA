// Почему не переводятся раздачи 888: берёт один rar из zip 888 (по умолчанию — 2512, где брака 16%),
// переводит и пишет причины и по 5 примеров каждой → pipeline/out/888_не_переведено.txt. Ничего в базу не пишет.
//   node tools/fails_888.cjs "D:\маининг\new" [часть имени rar]
const fs = require('fs'), path = require('path'), Z = require('../gto/zipread.cjs'), V = require('../pipeline/convert.cjs');
const BACKING = process.env.BACKING_DIR || 'D:/маининг/реплеер';
const unrar = require(require.resolve('node-unrar-js', { paths: [process.cwd(), BACKING, __dirname] }));
const [SRC, WANT] = process.argv.slice(2);
const TMP = path.join(__dirname, '..', 'gto', 'tmp', 'f888_' + process.pid + '.rar');
(async () => {
  const ents = []; for (const z of fs.readdirSync(SRC).filter(f => /^888.*\.zip$/i.test(f))) for (const e of Z.entries(path.join(SRC, z))) if (/\.rar$/i.test(e.name)) ents.push(e);
  const e = ents.find(x => x.name.includes(WANT || '2512')) || ents.sort((a, b) => a.usize - b.usize)[0];
  console.log('архив:', e.name);
  await new Promise((res, rej) => { const o = fs.createWriteStream(TMP); const r = Z.openEntry(e); r.on('error', rej); o.on('error', rej); o.on('finish', res); r.pipe(o); });
  const ex = await unrar.createExtractorFromData({ data: fs.readFileSync(TMP) });
  const r = ex.extract({ files: (fh) => !fh.flags.directory && /\.txt$/i.test(fh.name) });
  const why = {}, ex5 = {}, line2 = {}; let ok = 0, n = 0;
  for (const f of r.files) {
    if (!f.extraction) continue;
    const s = Buffer.from(f.extraction).toString('utf8');
    for (const h of s.split(/\r?\n(?=#Game No)/)) {
      if (!/^\s*#Game No/.test(h)) continue; n++;
      V.e888ToPS.why = null;
      if (V.e888ToPS(h, f.fileHeader.name)) { ok++; continue; }
      const w = V.e888ToPS.why || '?'; why[w] = (why[w] || 0) + 1;
      // вид строк 3-4 (блайнды, турнир) у брака — чтобы увидеть новый формат
      const L = h.split(/\r?\n/); const k = (L[2] || '').replace(/\d+/g, '9').slice(0, 70) + ' | ' + (L[3] || '').replace(/\d+/g, '9').slice(0, 70);
      line2[k] = (line2[k] || 0) + 1;
      (ex5[w] = ex5[w] || []); if (ex5[w].length < 5) ex5[w].push(f.fileHeader.name + '\n' + h.slice(0, 3000));
    }
  }
  fs.unlinkSync(TMP);
  const out = ['архив ' + e.name, 'раздач ' + n + ', переведено ' + ok + ', брак ' + (n - ok), '', 'ПРИЧИНЫ:', ...Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => '  ' + v + '  ' + k), '', 'ВИД ЗАГОЛОВКОВ У БРАКА:', ...Object.entries(line2).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => '  ' + v + '  ' + k), ''];
  for (const [w, a] of Object.entries(ex5)) { out.push('==================== ' + w); out.push(...a.map(x => x + '\n----')); }
  const OUTF = path.join(__dirname, '..', 'pipeline', 'out', '888_не_переведено.txt');
  fs.writeFileSync(OUTF, out.join('\n'));
  console.log(out.slice(0, 12).join('\n')); console.log('Подробно: ' + OUTF);
})();
