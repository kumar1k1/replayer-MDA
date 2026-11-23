'use strict';
// Проверка lib/handfix.js на выборке базы (все румы):
//  • обычная раздача (все за столом играли, есть SB и BB, баттон на своём месте) — разметка НЕ меняется;
//  • после исправления: метка SB — у поставившего SB, BB — у поставившего BB, BTN — у места баттона (если он играл);
//    метки не повторяются; «первого входа» у BB нет; все префлоп-действия размечены; фишки сходятся как и до.
//   node tests/test_handfix.cjs [раздач на файл] [каждый N-й файл]
process.env.RAW_DIRS = process.env.RAW_DIRS || 'D:/маининг/реплеер/raw;D:/маининг/реплеер/raw-ps;D:/маининг/replayer-MDA/новые_румы;D:/маининг/replayer-MDA/новые_румы2';
const fs = require('fs');
const C = require('../pipeline/common.cjs'), HF = require('../lib/handfix.js');
const P_ = C.loadParser(), { frames } = P_;
const raw = (t) => P_.parseHand(C.normalizeHand(t) + '\n');
const PER_FILE = +(process.argv[2] || 2000), STEP = +(process.argv[3] || 25);
const R = {}; const inc = (room, k) => { const o = R[room] = R[room] || { hands: 0 }; o[k] = (o[k] || 0) + 1; };
const EX = {}; const ex = (k, t, info) => { const e = EX[k] = EX[k] || []; if (e.length < 3) e.push({ info, hand: t.slice(0, 1500) }); };
(async () => {
  const all = C.sourceFiles().filter(f => fs.statSync(f).size < 2048 * 1048576), files = all.filter((_, i) => i % STEP === 0), per = {};
  for await (const x of C.iterHands(files, null)) {
    if (x.end) continue; if ((per[x.fp] = (per[x.fp] || 0) + 1) > PER_FILE) continue;
    const room = C.roomOf(x.hand), t = C.normalizeHand(x.hand);
    let a; try { a = raw(x.hand); } catch (e) { continue; } if (!a || !a.n || !a.bb) continue;
    inc(room, 'hands');
    const b = HF.fix(a, t);
    if (!b) { inc(room, new Set(a.nm).size !== a.n ? 'не берём: одинаковые ники' : 'не берём: нет большого блайнда'); continue; }
    // повреждённые в источнике (пропущены строки, фишки не сходятся) — их отбрасывает каждый шаг конвейера (C.handIntact)
    { let ok = false; try { const fb = frames(b); ok = C.handIntact(b, fb[fb.length - 1], x.hand); } catch (e) {} if (!ok) { inc(room, 'не берём: фишки не сходятся (источник)'); continue; } }
    if (b.phantom) inc(room, 'убран фальшивый фолд игрока без фишек');
    const sbE = a.ev.find(e => e.t === 'SB'), bbE = a.ev.find(e => e.t === 'BB');
    const acted = new Set(a.ev.filter(e => e.i >= 0).map(e => e.i));
    const bm = /Seat #(\d+) is the button/.exec(t), sm = bm && new RegExp('^Seat ' + bm[1] + ': (.+?) \\([\\d.,]+ in chips', 'm').exec(t), btnNick = sm ? sm[1] : null;
    const btnI = btnNick ? a.nm.indexOf(btnNick) : -1;
    const normal = acted.size === a.n && sbE && bbE && btnI >= 0 && acted.has(btnI) && btnI !== sbE.i && btnI !== bbE.i && a.n >= 3;
    if (b.posFixed) inc(room, 'исправлено'); if (b.dropped) inc(room, 'убран игрок без карт');
    if (normal) {
      inc(room, 'обычных');
      if (b.posFixed) { inc(room, 'ОШИБКА: обычная раздача изменена'); ex('обычная изменена', t, { до: a.pl.map(p => p[0]), после: b.pl.map(p => p[0]) }); }
      if (a.pl.some((p, j) => p[0] === 'BB' && j !== bbE.i) || a.pl.findIndex(p => p[0] === 'SB') !== sbE.i) inc(room, 'обычная, но парсер ошибся');
    }
    const lab = (p) => b.pl.findIndex(q => q[0] === p);
    const bb2 = b.ev.find(e => e.t === 'BB'), sb2 = b.ev.find(e => e.t === 'SB');
    if (bb2 && b.n >= 2 && lab('BB') !== bb2.i) { inc(room, 'ОШИБКА: BB не у поставившего'); ex('BB', t, b.pl.map(p => p[0])); }
    if (sb2 && b.n >= 3 && lab('SB') !== sb2.i) { inc(room, 'ОШИБКА: SB не у поставившего'); ex('SB', t, b.pl.map(p => p[0])); }
    if (btnNick && b.n >= 3) { const bi = b.nm.indexOf(btnNick); if (bi >= 0 && bi !== (bb2 || {}).i && bi !== (sb2 || {}).i && b.pl[bi][0] !== 'BTN') { inc(room, 'ОШИБКА: BTN не на месте баттона'); ex('BTN', t, b.pl.map(p => p[0])); } }
    const labs = b.pl.map(p => p[0]); if (new Set(labs).size !== labs.length) { inc(room, 'ОШИБКА: метки повторяются'); ex('повтор', t, labs); }
    try {
      const d = C.preflopDecisions(b, () => 'unk'), nPf = b.ev.filter(e => e.st === 0 && e.i >= 0 && 'rcfx'.indexOf(e.t) >= 0).length;
      if (d.length !== nPf) inc(room, 'ОШИБКА: префлоп размечен не весь');
      if (d.some(z => z.tbl === 'RFI' && z.pos === 'BB')) { inc(room, 'ОШИБКА: первый вход у BB'); ex('RFI BB', t, labs); }
      const da = C.preflopDecisions(a, () => 'unk'); if (da.some(z => z.tbl === 'RFI' && z.pos === 'BB')) inc(room, 'было: первый вход у BB');
    } catch (e) { inc(room, 'ОШИБКА: исключение ' + e.message.slice(0, 40)); }
    // фишки: исправление не должно менять сходимость банка
    try { const fa = frames(a), fb = frames(b); if (C.handIntact(a, fa[fa.length - 1], t) !== C.handIntact(b, fb[fb.length - 1], t)) { inc(room, 'ОШИБКА: изменилась сходимость фишек'); ex('фишки', t, null); } } catch (e) { inc(room, 'ОШИБКА: кадры'); }
  }
  for (const [room, o] of Object.entries(R).sort()) {
    console.log('\n' + room + ' — раздач ' + o.hands);
    for (const [k, v] of Object.entries(o)) if (k !== 'hands') console.log('  ' + k + ': ' + v + ' (' + (v / o.hands * 100).toFixed(2) + '%)');
  }
  fs.writeFileSync(__dirname + '/../pipeline/out2/handfix_примеры.json', JSON.stringify(EX, null, 1));
  const errs = Object.values(R).reduce((s, o) => s + Object.entries(o).filter(([k]) => /^ОШИБКА/.test(k)).reduce((a, [, v]) => a + v, 0), 0);
  console.log('\nОШИБОК:', errs);
  process.exit(errs ? 1 : 0);
})();
