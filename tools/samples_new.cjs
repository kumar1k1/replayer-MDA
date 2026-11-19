// Образцы и опись новых архивов (888, Chico, Winamax, ... — 20.11.2026). Ничего не распаковывает целиком.
// Для каждого zip в папке: опись (что внутри, размеры) → pipeline/out/образцы_new/опись.txt;
// образцы — из 2 самых маленьких .rar (по 3 файла) и из 3 первых текстовых файлов (.txt/.xml/.hh), по 300 КБ каждый.
//   node tools/samples_new.cjs "D:\маининг\new"
const fs = require('fs'), path = require('path'), Z = require('../gto/zipread.cjs');
const BACKING = process.env.BACKING_DIR || 'D:/маининг/реплеер';
const unrar = require(require.resolve('node-unrar-js', { paths: [process.cwd(), BACKING, __dirname] }));
const OUT = path.join(__dirname, '..', 'pipeline', 'out', 'образцы_new'); fs.mkdirSync(OUT, { recursive: true });
const TMP = path.join(__dirname, '..', 'gto', 'tmp'); fs.mkdirSync(TMP, { recursive: true });
const L = []; const log = (s) => { console.log(s); L.push(s); };
const MB = (b) => (b / 1048576).toFixed(1) + ' МБ';
const safe = (s) => s.replace(/[^\w.-]+/g, '_').slice(-80);
const LIM = 300 * 1024;
async function headOf(e) { const chunks = []; let n = 0; const r = Z.openEntry(e); for await (const ch of r) { chunks.push(ch); n += ch.length; if (n >= LIM) { r.destroy(); break; } } return Buffer.concat(chunks).subarray(0, LIM); }
(async () => {
  for (const d of process.argv.slice(2)) for (const zf of fs.readdirSync(d).filter(f => /\.zip$/i.test(f)).sort().map(f => path.join(d, f))) {
    const zb = path.basename(zf, '.zip');
    let E; try { E = Z.walk(zf).filter(e => !e.dir); } catch (err) { log('\n' + zb + ': не читается — ' + err.message); continue; }
    const ext = {}; for (const e of E) { const x = (path.extname(e.name) || '(нет)').toLowerCase(); ext[x] = (ext[x] || 0) + 1; }
    log('\n' + zb + ': файлов ' + E.length + ', распаковано ' + MB(E.reduce((s, e) => s + e.usize, 0)) + ' ' + JSON.stringify(ext));
    for (const e of E.slice(0, 25)) log('   ' + e.name + '  ' + MB(e.usize));
    if (E.length > 25) log('   … и ещё ' + (E.length - 25));
    const dir = path.join(OUT, safe(zb)); fs.mkdirSync(dir, { recursive: true });
    // текстовые файлы прямо в zip
    let k = 0;
    for (const e of E.filter(e => /\.(txt|xml|hh|log|csv)$/i.test(e.name)).slice(0, 3)) {
      try { fs.writeFileSync(path.join(dir, (++k) + '__' + safe(path.basename(e.name)) + '.sample'), await headOf(e)); } catch (err) { log('   ошибка образца ' + e.name + ': ' + err.message); }
    }
    // .rar — два самых маленьких
    for (const e of E.filter(e => /\.rar$/i.test(e.name)).sort((a, b) => a.usize - b.usize).slice(0, 2)) {
      const tmp = path.join(TMP, 'sn_' + process.pid + '.rar');
      try {
        await new Promise((res, rej) => { const o = fs.createWriteStream(tmp); const r = Z.openEntry(e); r.on('error', rej); o.on('error', rej); o.on('finish', res); r.pipe(o); });
        const ex = await unrar.createExtractorFromData({ data: fs.readFileSync(tmp) });
        const list = [...ex.getFileList().fileHeaders].filter(f => !f.flags.directory);
        log('   ' + path.basename(e.name) + ' — внутри ' + list.length + ': ' + list.slice(0, 5).map(f => f.name + ' (' + MB(f.unpSize) + ')').join(', '));
        let j = 0;
        for (const fh of list) { if (j >= 3) break; const r = ex.extract({ files: [fh.name] }); for (const f of r.files) if (f.extraction) fs.writeFileSync(path.join(dir, 'rar' + (++j) + '__' + safe(path.basename(fh.name)) + '.sample'), Buffer.from(f.extraction).subarray(0, LIM)); }
      } catch (err) { log('   ' + path.basename(e.name) + ': ошибка — ' + err.message); }
      try { fs.unlinkSync(tmp); } catch (x) {}
    }
    // вложенные сжатые zip — первый, его первые текстовые файлы
    const nz = E.find(e => e.zipped);
    if (nz) { try { const o = await Z.openNested(nz); let j = 0; for (const e of o.files.filter(e => /\.(txt|xml|hh)$/i.test(e.name)).slice(0, 3)) fs.writeFileSync(path.join(dir, 'zip' + (++j) + '__' + safe(path.basename(e.name)) + '.sample'), await headOf(e)); log('   вложенный ' + nz.name + ' — файлов ' + o.files.length); o.cleanup(); } catch (err) { log('   вложенный zip: ошибка — ' + err.message); } }
  }
  fs.writeFileSync(path.join(OUT, 'опись.txt'), L.join('\n'));
  console.log('\nГотово: образцы и опись в ' + OUT);
})();
