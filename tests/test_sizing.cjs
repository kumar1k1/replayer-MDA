'use strict';
// П.6 ТЕСТЫ САЙЗИНГОВ: корзины, мера размера, разметка решений, рекомендация, порог олл-ина, минимальный рейз.
const C = require('../pipeline/common.cjs'), SZ = require('../lib/sizing.js'), SP = require('../lib/spots.js');
const P = C.loadParser(), parse = C.makeParse(P);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) { fails++; process.exitCode = 1; } };
const SEATS = ['UTGp', 'MPp', 'COp', 'BTNp', 'SBp', 'BBp'];
function hand(body, stacks) {
  const st = stacks || [3000, 3000, 3000, 3000, 3000, 3000];
  return ['PokerStars Hand #100000000002: Tournament #1, $10+$1 USD Hold\'em No Limit - Level I (10/20) - 2026/01/01 0:00:00 ET',
    "Table '1 1' 6-max Seat #4 is the button",
    ...SEATS.map((s, k) => `Seat ${k + 1}: ${s} (${st[k]} in chips)`),
    'SBp: posts small blind 10', 'BBp: posts big blind 20', '*** HOLE CARDS ***', ...body].join('\n');
}
const dec = (body, st) => { const rp = parse(hand(body, st)); return SP.preflopDecisions(rp, () => '').map(d => Object.assign(d, { nm: rp.nm[d.i] })); };

console.log('— корзины по пикам');
ok(SZ.bucketOf('open', 2) === '2x' && SZ.bucketOf('open', 2.1) === '2x', 'опен 2 и 2.1 bb → 2x');
ok(SZ.bucketOf('open', 2.2) === '2.2-2.5x' && SZ.bucketOf('open', 2.5) === '2.2-2.5x', 'опен 2.2 и 2.5 → 2.2-2.5x');
ok(SZ.bucketOf('open', 3) === '3x' && SZ.bucketOf('open', 3.5) === '3.5x' && SZ.bucketOf('open', 4) === '4x+', 'опен 3 / 3.5 / 4 — разные корзины (SB играет 3–3.5x)');
ok(SZ.bucketOf('3bet', 2.5) === '≤2.5x' && SZ.bucketOf('3bet', 3) === '3x' && SZ.bucketOf('3bet', 4) === '4x', '3-бет 2.5x / 3x / 4x');
ok(SZ.bucketOf('4bet', 2.2) === '2-2.3x' && SZ.bucketOf('4bet', 1.8) === '≤1.9x', '4-бет 2.2x и 1.8x');
ok(SZ.bucketOf('iso', 0) === '+1', 'изо минимальным рейзом (x = 0) — корзина +1, а не null');

console.log('— мера размера');
ok(SZ.measure('iso', 3.5, 0, 1) === 2.5, 'изо до 3.5 bb над одним лимпером = +2.5');
ok(SZ.measure('3bet', 6, 2, 0) === 3, '3-бет до 6 против опена 2 = 3x');

console.log('— разметка решений (lib/spots.js)');
let d = dec(['UTGp: raises 24 to 44', 'MPp: folds', 'COp: raises 88 to 132', 'BTNp: folds', 'SBp: folds', 'BBp: folds', 'UTGp: folds',
  'Uncalled bet (88) returned to COp', 'COp collected 118 from pot', '*** SUMMARY ***', 'Total pot 118 | Rake 0']);
const u = d.find(x => x.nm === 'UTGp' && x.tbl === 'RFI'), c = d.find(x => x.nm === 'COp');
ok(u.szAct === 'open' && u.to === 2.2 && u.sz === '2.2-2.5x', 'UTG опен до 2.2 bb: open / 2.2-2.5x');
ok(c.szAct === '3bet' && Math.abs(c.to / c.refTo - 3) < 1e-9 && c.sz === '3x', 'CO 3-бет до 6.6 против 2.2: 3bet / 3x');
d = dec(['UTGp: calls 20', 'MPp: folds', 'COp: raises 70 to 90', 'BTNp: folds', 'SBp: folds', 'BBp: folds', 'UTGp: folds',
  'Uncalled bet (70) returned to COp', 'COp collected 70 from pot', '*** SUMMARY ***', 'Total pot 70 | Rake 0']);
const iso = d.find(x => x.nm === 'COp');
ok(iso.szAct === 'iso' && iso.nLimp === 1 && iso.sz === '+3.5', 'CO изо до 4.5 bb над одним лимпером: iso / +3.5 (раньше мерилось «до» = 4.5 и попадало в корзину опенов)');
d = dec(['UTGp: raises 20 to 40', 'MPp: calls 40', 'COp: folds', 'BTNp: raises 160 to 200', 'SBp: folds', 'BBp: folds', 'UTGp: folds', 'MPp: folds',
  'Uncalled bet (160) returned to BTNp', 'BTNp collected 150 from pot', '*** SUMMARY ***', 'Total pot 150 | Rake 0']);
const sq = d.find(x => x.nm === 'BTNp');
ok(sq.szAct === 'sqz' && sq.sz === '5x', 'BTN сквиз до 10 bb против опена 2 и коллера: sqz / 5x');
// эффективный олл-ин: у SB 60bb, у BB 15bb, SB ставит 15 bb — покрывает BB, свои фишки остаются
d = dec(['UTGp: folds', 'MPp: folds', 'COp: folds', 'BTNp: folds', 'SBp: raises 290 to 300', 'BBp: folds',
  'Uncalled bet (280) returned to SBp', 'SBp collected 40 from pot', '*** SUMMARY ***', 'Total pot 40 | Rake 0'], [3000, 3000, 3000, 3000, 1200, 300]);
const sb = d.find(x => x.nm === 'SBp');
ok(sb.aiEff === true && sb.aiAct === false && sb.sz === null, 'SB 60bb ставит 15 bb против BB 15bb: эффективный олл-ин, в сайзинги не идёт');

console.log('— рекомендация');
const T = { tops: {
  'ps|open|36-59|BTN': { n: 9000, mode: 2, rec: 2, share: 80 },
  'ps|3bet|60+|blinds': { n: 5000, mode: 4, rec: 5, recShare: 34 },
  'ps|iso|36-59|L1': { n: 4000, mode: 2.5, rec: 2.5 } }, pool: {
  'ps|iso|36-59|L2': { n: 800, mode: 3, rec: 3 } } };
let r = SZ.recommend({ room: 'ps', action: 'open', band: '36-59', pos: 'BTN', eff: 45 }, T);
ok(r.to === 2 && !r.allin && /^tops:/.test(r.src), 'BTN 45bb: опен 2 bb по топам');
r = SZ.recommend({ room: 'ps', action: '3bet', band: '100-149', pos: 'BB', refTo: 2.2, eff: 120 }, T);
ok(r.to === 11 && r.bucket === '5x+', 'BB 120bb против опена 2.2: 3-бет 5x → 11 bb (корзина топов, а не общая мода 4x)');
r = SZ.recommend({ room: 'ps', action: 'iso', band: '36-59', pos: 'BTN', nLimp: 2, eff: 50 }, T);
ok(r.to === 5 && /^pool:ps\|iso\|36-59\|L2/.test(r.src), 'изо над двумя лимперами: +3 → 5 bb (L2 из пула, у топов мало)');
r = SZ.recommend({ room: 'ps', action: '3bet', band: '20-35', pos: 'BB', refTo: 2.5, eff: 22 }, T);
ok(r.allin && r.to === 22, '3-бет ~7.5 bb при эфф. стеке 22 bb (≥30%) → олл-ин');
r = SZ.recommend({ room: 'ps', action: '4bet', band: '60+', pos: 'CO', refTo: 7, prevTo: 2.2, eff: 100 }, { tops: { 'ps|4bet|60+|*': { n: 500, rec: 1.5 } } });
ok(r.to >= 11.8, '4-бет не меньше минимального рейза (7 + 4.8 = 11.8 bb), даже если таблица даёт 1.5x');
ok(SZ.recommend({ room: 'coin', action: 'open', band: '<12', pos: 'EP', eff: 10 }, {}).src === 'default', 'нет таблицы — запасное значение');

if (!fails) console.log('\nВсе проверки сайзингов пройдены');
