// Обзор zip-архивов новых румов без распаковки: что внутри (имена, размеры), сколько займёт распакованным.
//   node tools/scan_zips.cjs <папка или zip> ... → pipeline/out/обзор_румов.txt
const fs = require('fs'), path = require('path'), Z = require('../gto/zipread.cjs');
const L = []; const log = (...a) => { const s = a.join(' '); console.log(s); L.push(s); };
const GB = (b) => (b / 2 ** 30).toFixed(2) + ' ГБ';
let allZ = 0, allU = 0;
for (const arg of process.argv.slice(2)) {
  const files = fs.statSync(arg).isDirectory() ? fs.readdirSync(arg).filter(f => /\.zip$/i.test(f)).map(f => path.join(arg, f)) : [arg];
  for (const f of files) {
    let E; try { E = Z.entries(f); } catch (e) { log('\n' + f + ': не читается как zip — ' + e.message); continue; }
    const z = fs.statSync(f).size, u = E.reduce((s, e) => s + e.usize, 0); allZ += z; allU += u;
    const ext = {}; for (const e of E) if (!e.dir) { const x = (path.extname(e.name) || '(нет)').toLowerCase(); ext[x] = (ext[x] || 0) + 1; }
    log('\n' + path.basename(f) + ': ' + GB(z) + ' → распаковано ' + GB(u) + ' | файлов ' + E.filter(e => !e.dir).length + ' ' + JSON.stringify(ext));
    const big = E.filter(e => !e.dir).sort((a, b) => b.usize - a.usize).slice(0, 15);
    for (const e of big) log('   ' + e.name + '  ' + GB(e.usize) + (e.method ? ' (сжат в zip)' : ''));
  }
}
log('\nИТОГО: архивы ' + GB(allZ) + ', распакованными было бы ' + GB(allU));
const out = path.join(__dirname, '..', 'pipeline', 'out', 'обзор_румов.txt'); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, L.join('\r\n'), 'utf8'); console.log('\nСохранено: ' + out);
