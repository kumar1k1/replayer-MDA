'use strict';
// П.8 ТЕСТЫ ДВИЖКА v8: каждый тип решения (RFI / ISO / VSO / VS3 / AI) на реальной модели — логика совета,
// сайз, лайнап, вердикт; затем прогон по реальным решениям с известными картами (вскрытия) — без сбоев и мусора.
//   MODEL=… LINEUP=… SIZES=… PLAYERS=… (по умолчанию — data/ и pipeline/out/) node tests/test_engine_v8.cjs
const fs = require('fs'), path = require('path');
const C = require('../pipeline/common.cjs'), Kc = require('../lib/cards.js'), E8 = require('../engine/engine_v8.js');
const D = (f) => path.join(__dirname, '..', 'data', f);
const rj = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const model = C.loadModel(process.env.MODEL || C.MODEL_FILE());
const eng = E8.create(model, rj(D('eq169.json')), { sizes: rj(process.env.SIZES || D('sizes_v8.json')), lineup: rj(process.env.LINEUP || D('lineup_v8.json')) });
const P = C.loadParser(), parse = C.makeParse(P);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) { fails++; process.exitCode = 1; } };
const SEATS = ['UTGp', 'MPp', 'COp', 'BTNp', 'SBp', 'BBp'];
function spot(body, heroNick, stacks, n) {
  const st = stacks || SEATS.map(() => 4000);
  const txt = ['PokerStars Hand #100000000003: Tournament #1, $10+$1 USD Hold\'em No Limit - Level I (50/100) - 2026/01/01 0:00:00 ET',
    "Table '1 1' 6-max Seat #4 is the button", ...SEATS.map((s, k) => `Seat ${k + 1}: ${s} (${st[k]} in chips)`),
    'SBp: posts small blind 50', 'BBp: posts big blind 100', '*** HOLE CARDS ***', ...body, heroNick + ': folds'].join('\n');
  const rp = parse(txt);
  const ds = E8.decisionsBacking(rp, () => 'unk', '$10', 'ps');
  return ds.filter(d => rp.nm[d.i] === heroNick)[n || 0];
}
const cards = (s) => Kc.parseCards(s);
function check(name, sp, hand, expect, extra) {
  const a = eng.advise(sp, cards(hand), () => null);
  const shape = a.rows.every(r => r.act !== 'fold' || r.ev === 0) && a.rows.every(r => r.ev === null || Number.isFinite(r.ev)) &&
    E8.ACTS[sp.tbl].includes(a.rec.act) && a.rows.every(r => r.pFold == null || (r.pFold >= 0 && r.pFold <= 1));
  const exp = Array.isArray(expect) ? expect : [expect];
  ok(shape && exp.includes(a.rec.act) && (!extra || extra(a)), name + ' → ' + a.rec.ru + ' (' + a.rec.why + ')');
  return a;
}
const F = (n) => Array(n).fill(0);
console.log('— RFI');
let sp = spot(['UTGp: folds', 'MPp: folds', 'COp: folds'], 'BTNp');
let a = check('BTN 40bb AsAh', sp, 'AsAh', 'open', (a) => a.rec.size && a.rec.size.to >= 2 && a.rec.size.to <= 2.5);
ok(a.st === 'mid' && /ближайший/.test(a.stNote || ''), '   лимит $10 (micro) в базе контейнера отсутствует — взята ближайшая страта: ' + a.stNote);
ok(a.rows.find(r => r.act === 'open').pFoldSrc.startsWith('лайнап'), '   P(все сфолдят) после опена — по лайнапу: ' + (a.rows.find(r => r.act === 'open').pFold * 100).toFixed(1) + '%');
sp = spot([], 'UTGp');
check('UTG 40bb 7c2d', sp, '7c2d', 'fold');
sp = spot(['UTGp: folds', 'MPp: folds', 'COp: folds'], 'BTNp', [4000, 4000, 4000, 800, 4000, 4000]);
check('BTN 8bb AcKd', sp, 'AcKd', 'shove');
console.log('— ISO');
sp = spot(['UTGp: calls 100', 'MPp: folds', 'COp: folds'], 'BTNp');
check('BTN 40bb против лимпера, AsAh', sp, 'AsAh', ['iso', 'shove'], (a) => a.rec.act !== 'iso' || (a.rec.size.to >= 3 && a.rec.size.to <= 5));
console.log('— VSO');
sp = spot(['UTGp: folds', 'MPp: folds', 'COp: folds', 'BTNp: raises 100 to 200', 'SBp: folds'], 'BBp');
check('BB 40bb против опена BTN 2x, AsAh', sp, 'AsAh', ['3bet', 'call', 'shove'], (a) => a.rec.act !== '3bet' || a.rec.size.to > 4);
check('BB 40bb против опена BTN 2x, 7c2d', sp, '7c2d', 'fold');
console.log('— VS3');
sp = spot(['UTGp: folds', 'MPp: folds', 'COp: raises 100 to 200', 'BTNp: raises 400 to 600', 'SBp: folds', 'BBp: folds'], 'COp', null, 1);
check('CO 40bb против 3-бета BTN, AsAh', sp, 'AsAh', ['4bet', 'shove', 'call']);
a = check('CO 40bb против 3-бета BTN, 7c2d: фолд или пуш с малым EV', sp, '7c2d', ['fold', 'shove'], (a) => a.rec.act === 'fold' || a.rows.find(r => r.act === 'shove').ev < 2.5);
if (a.rec.act === 'shove') console.log('     (пуш 72o: BTN по базе фолдит на 4-бет-пуш в ' + (a.rows.find(r => r.act === 'shove').pFold * 100).toFixed(0) + '% — фолд-эквити окупает)');
console.log('— AI');
sp = spot(['UTGp: folds', 'MPp: folds', 'COp: folds', 'BTNp: folds', 'SBp: raises 950 to 1000 and is all-in'], 'BBp', [4000, 4000, 4000, 4000, 1000, 4000]);
check('BB против пуша SB 10bb, AsAh', sp, 'AsAh', 'call');
check('BB против пуша SB 10bb, 7c2d', sp, '7c2d', 'fold');
console.log('— карты неизвестны (чужая раздача без вскрытия)');
sp = spot(['UTGp: folds', 'MPp: folds', 'COp: folds', 'BTNp: raises 100 to 200', 'SBp: folds'], 'BBp');
a = eng.advise(sp, null, () => null);
ok(a.rec.byFreq && E8.ACTS.VSO.includes(a.rec.act) && /карты неизвестны/.test(a.rec.why), 'BB против опена без карт: совет — самое частое действие топов (' + a.rec.ru + ', ' + a.rec.why + ')');
const vq = ['fold', 'call', '3bet', 'shove'].map(x => eng.verdict(a, x).kind);
ok(vq.includes('лучшее') && vq.every(k => ['лучшее', 'частое у топов', 'редкое у топов'].includes(k)), 'вердикты без карт: ' + vq.join(' / '));
console.log('— вердикт');
sp = spot(['UTGp: folds', 'MPp: folds', 'COp: folds'], 'BTNp');
a = eng.advise(sp, cards('AsAh'), () => null);
ok(eng.verdict(a, 'fold').kind !== 'лучшее', 'фолд AA с BTN — не «лучшее»: ' + eng.verdict(a, 'fold').text);
ok(eng.verdict(a, 'open:x2.2', '3.5x').text.includes('сайз'), 'опен 3.5x вместо 2x: вердикт говорит про сайз — ' + eng.verdict(a, 'open:x2.2', '3.5x').text);

// ---------- прогон по реальным решениям с известными картами ----------
(async () => {
  const LIM = +(process.env.N || 20000);
  let n = 0, errs = 0, bad = 0; const recs = {}, kinds = {};
  for await (const x of C.iterHands(C.sourceFiles())) {
    if (x.end) continue; if (n >= LIM) break;
    let rp; try { rp = parse(x.hand); } catch (e) { continue; }
    if (!rp || !rp.n || !rp.bb || !rp.sh) continue;
    const room = C.roomOf(x.hand); if (!C.SHOWDOWN_TRUSTED(room)) continue;
    for (const d of E8.decisionsBacking(rp, () => 'unk', x.fp, room)) {
      const c = rp.sh[d.i] && Kc.parseCards(rp.sh[d.i]); if (!c || c.length !== 2) continue;
      try {
        const a = eng.advise(d, c, () => null), v = eng.verdict(a, d.act, d.sz); n++;
        if (!a.rows.every(r => r.ev === null || Number.isFinite(r.ev)) || !a.rec.act) bad++;
        recs[d.tbl + ':' + a.rec.act] = (recs[d.tbl + ':' + a.rec.act] || 0) + 1; kinds[v.kind] = (kinds[v.kind] || 0) + 1;
      } catch (e) { if (++errs <= 3) console.log('ERR', e.stack.split('\n').slice(0, 3).join(' | ')); }
    }
  }
  ok(errs === 0 && bad === 0, 'прогон по ' + n + ' реальным решениям со вскрытием: сбоев ' + errs + ', мусорных EV ' + bad);
  console.log('   советы:', JSON.stringify(recs));
  console.log('   вердикты:', JSON.stringify(kinds));
  if (!fails) console.log('\nВсе проверки движка v8 пройдены');
})();
