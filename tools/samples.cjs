// Образцы историй новых румов: из zip берёт выбранные .rar (во временный файл), из каждого — первые 3 текстовых файла
// по 300 КБ, пишет в pipeline/out/образцы/. Ничего больше не распаковывает.
const fs = require('fs'), path = require('path'), Z = require('../gto/zipread.cjs');
const BACKING = process.env.BACKING_DIR || 'D:/маининг/реплеер';
const unrar = require(require.resolve('node-unrar-js', { paths: [process.cwd(), BACKING, __dirname] }));
const OUT = path.join(__dirname, '..', 'pipeline', 'out', 'образцы'); fs.mkdirSync(OUT, { recursive: true });
const TMP = path.join(__dirname, '..', 'gto', 'tmp'); fs.mkdirSync(TMP, { recursive: true });
const WANT = [/2607-WPN-HL-954Mb\.rar$/i, /2606-WPN-HL-1Gb\.rar$/i, /2607-hands-iPoker\.rar$/i, /2610-iPoker-HL-hm3-pt4-2740Mb\.rar$/i, /2604-RedStar\.rar$/i, /2607-iPoker-HL-809Mb\.rar$/i];
(async () => {
  const dirs = process.argv.slice(2); const done = new Set();
  for (const d of dirs) for (const zf of fs.readdirSync(d).filter(f => /\.zip$/i.test(f)).map(f => path.join(d, f))) {
    for (const e of Z.entries(zf)) {
      const w = WANT.find(r => r.test(e.name)); if (!w || done.has(String(w))) continue; done.add(String(w));
      const tmp = path.join(TMP, 'sample_' + done.size + '.rar');
      await new Promise((res, rej) => { const o = fs.createWriteStream(tmp); const r = Z.openEntry(e); r.on('error', rej); o.on('error', rej); o.on('finish', res); r.pipe(o); });
      try {
        const ex = await unrar.createExtractorFromData({ data: fs.readFileSync(tmp) });
        const list = [...ex.getFileList().fileHeaders].filter(f => !f.flags.directory);
        console.log(path.basename(e.name) + ': файлов внутри ' + list.length + ' — ' + list.slice(0, 5).map(f => f.name + ' (' + Math.round(f.unpSize / 1048576) + ' МБ)').join(', '));
        let k = 0;
        for (const fh of list) {
          if (k >= 3) break;
          const r = ex.extract({ files: [fh.name] });
          for (const f of r.files) if (f.extraction) { const buf = Buffer.from(f.extraction).subarray(0, 300 * 1024); fs.writeFileSync(path.join(OUT, path.basename(e.name, '.rar') + '__' + (++k) + '__' + path.basename(fh.name).replace(/[^\w.-]+/g, '_') + '.sample'), buf); }
        }
      } catch (err) { console.log(path.basename(e.name) + ': ошибка — ' + err.message); }
      fs.unlinkSync(tmp);
    }
  }
  console.log('Готово: образцы в ' + OUT);
})();
