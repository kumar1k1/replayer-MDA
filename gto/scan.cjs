// Обзор архива HRC без распаковки: состав, стеки, столы, анте, постфлоп. Пишет gto/out/обзор.txt
const fs = require('fs'), path = require('path'), Z = require('./zipread.cjs'), H = require('./hh.cjs');
const ZIP = process.argv[2] || process.env.GTO_ZIP; if (!ZIP || !fs.existsSync(ZIP)) { console.log('Не найден архив: ' + ZIP); process.exit(1); }
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const L = []; const log = (...a) => { const s = a.join(' '); console.log(s); L.push(s); };
(async () => {
  const E = Z.entries(ZIP), files = E.filter(e => !e.dir);
  const U = files.reduce((s, e) => s + e.usize, 0), Cs = files.reduce((s, e) => s + e.csize, 0);
  log('Архив:', ZIP); log('Файлов:', files.length, '| папок:', E.length - files.length);
  log('Сжато:', (Cs / 2 ** 30).toFixed(2), 'ГБ | распаковано:', (U / 2 ** 30).toFixed(2), 'ГБ (в', (U / Cs).toFixed(1), 'раз)');
  const ext = {}; for (const f of files) { const x = (path.extname(f.name) || '(нет)').toLowerCase(); ext[x] = (ext[x] || 0) + 1; } log('Типы файлов:', JSON.stringify(ext));
  const dirs = {}; for (const f of files) { const d = path.dirname(f.name); dirs[d] = (dirs[d] || 0) + 1; }
  log('Папки (файлов):'); for (const [d, c] of Object.entries(dirs).sort((a, b) => b[1] - a[1]).slice(0, 40)) log('  ', d, c);
  log('Первые файлы:'); for (const f of files.slice(0, 15)) log('  ', f.name, (f.usize / 2 ** 20).toFixed(1) + ' МБ');
  // выборка: до 120 файлов равномерно, по 300 раздач из каждого
  const txt = files.filter(f => /\.txt$/i.test(f.name)), step = Math.max(1, Math.floor(txt.length / 120));
  const depth = {}, tbl = {}, ante = {}, pat = {}, flop = { yes: 0, no: 0 }, titles = {}; let hands = 0, bytes = 0, bad = 0, first = null;
  const perFile = [];
  for (let i = 0; i < txt.length; i += step) {
    const f = txt[i]; let k = 0, fd = {};
    for await (const h of Z.handsOf(ZIP, f)) {
      if (!first) first = h;
      const p = H.parse(h); if (!p) { bad++; if (++k >= 300) break; continue; }
      hands++; bytes += h.length;
      const bbs = p.seats.map(s => Math.round(s.bb * 10) / 10), eq = bbs.every(v => v === bbs[0]);
      const key = eq ? 'все по ' + bbs[0] + ' BB' : 'разные';
      depth[key] = (depth[key] || 0) + 1; fd[key] = (fd[key] || 0) + 1;
      if (!eq) { const s = bbs.slice().sort((a, b) => a - b).map(v => Math.round(v)).join('/'); pat[s] = (pat[s] || 0) + 1; }
      tbl[p.n + ' игр.'] = (tbl[p.n + ' игр.'] || 0) + 1;
      const a = (p.ante * 100).toFixed(1) + '% BB'; ante[a] = (ante[a] || 0) + 1;
      if (p.streets.flop) flop.yes++; else flop.no++;
      titles[p.title] = (titles[p.title] || 0) + 1;
      if (++k >= 300) break;
    }
    perFile.push(f.name + ' → ' + Object.entries(fd).map(([a, b]) => a + ' ×' + b).join(', '));
  }
  log('\nВыборка:', hands, 'раздач из', perFile.length, 'файлов (не разобрано:', bad + ')');
  log('Средний размер раздачи:', Math.round(bytes / Math.max(1, hands)), 'байт → в архиве примерно', (U / Math.max(1, bytes / hands) / 1e6).toFixed(1), 'млн раздач');
  const show = (t, o) => { log(t); for (const [k, v] of Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 25)) log('  ', k, '—', v); };
  show('Стеки:', depth); show('Неравные стеки (по возрастанию, BB), частые:', pat); show('Игроков за столом:', tbl); show('Анте:', ante); show('Заголовки:', titles);
  log('До флопа доходит:', (100 * flop.yes / Math.max(1, hands)).toFixed(1) + '%');
  log('\nПо файлам выборки:'); for (const s of perFile) log('  ', s);
  log('\nПример первой раздачи:\n' + (first || '').slice(0, 2500));
  fs.writeFileSync(path.join(OUT, 'обзор.txt'), L.join('\r\n'), 'utf8');
  console.log('\nСохранено: ' + path.join(OUT, 'обзор.txt'));
})().catch(e => { console.log('ОШИБКА: ' + e.stack); fs.writeFileSync(path.join(OUT, 'обзор.txt'), L.join('\r\n') + '\r\nОШИБКА: ' + e.stack, 'utf8'); process.exit(1); });
