'use strict';
// П.3 ЮНИТ-ТЕСТЫ СТАТОВ: раздачи-примеры в формате PokerStars с ответами, посчитанными вручную.
const C = require('../pipeline/common.cjs'), ST = require('../lib/stats.js');
const P = C.loadParser(), parse = C.makeParse(P);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) { fails++; process.exitCode = 1; } };
const SEATS = ['UTGp', 'MPp', 'COp', 'BTNp', 'SBp', 'BBp'];
// заголовок 6-max: баттон на месте 4 → МБ 5, ББ 6, UTG 1, MP 2, CO 3
function hand(body, stacks) {
  const st = stacks || [3000, 3000, 3000, 3000, 3000, 3000];
  return ['PokerStars Hand #100000000001: Tournament #1, $10+$1 USD Hold\'em No Limit - Level I (10/20) - 2026/01/01 0:00:00 ET',
    "Table '1 1' 6-max Seat #4 is the button",
    ...SEATS.map((s, k) => `Seat ${k + 1}: ${s} (${st[k]} in chips)`),
    'SBp: posts small blind 10', 'BBp: posts big blind 20', '*** HOLE CARDS ***', ...body].join('\n');
}
function stats(txt) {
  const rp = parse(txt), fr = P.frames(rp);
  ok(C.handIntact(rp, fr[fr.length - 1], txt), '  (банк раздачи сходится)');
  const r = ST.handStats(rp, fr), by = {};
  for (const [i, s, h] of r.cl) { const k = rp.nm[i] + '.' + s; by[k] = (by[k] || '') + h; }
  const sl = r.slots.map(([i, o, a]) => rp.nm[i] + ' ' + o + (a >= 0 ? '>' + (a - o) : ''));
  return { by, pf: r.pf.map(([i, k]) => rp.nm[i] + ' ' + k), sl, rp };
}
const has = (by, k, v) => by[k] === v;

console.log('— 1. UTG опен, CO 3-бет, все фолд, UTG фолд на 3-бет');
let s = stats(hand(['UTGp: raises 40 to 60', 'MPp: folds', 'COp: raises 140 to 200', 'BTNp: folds', 'SBp: folds', 'BBp: folds', 'UTGp: folds',
  'Uncalled bet (140) returned to COp', 'COp collected 150 from pot', '*** SUMMARY ***', 'Total pot 150 | Rake 0']));
ok(has(s.by, 'UTGp.VPIP', '1') && has(s.by, 'UTGp.PFR', '1'), 'UTG: VPIP и PFR = да');
ok(has(s.by, 'UTGp.LimpNSB', '0'), 'UTG: возможность лимпа (до него рейзов не было), не лимповал');
ok(has(s.by, 'UTGp.F3Bet', '1'), 'UTG: возможность F3Bet, сфолдил');
ok(has(s.by, 'COp.3BetNAI', '1') && s.by['COp.LimpNSB'] === undefined, 'CO: 3-бет (не олл-ин) засчитан; возможности лимпа нет (был рейз)');
ok(has(s.by, 'MPp.3BetNAI', '0'), 'MP: возможность 3-бета против опена, сфолдил');
ok(s.by['BTNp.3BetNAI'] === undefined && s.by['BBp.3BetNAI'] === undefined, 'BTN/BB против 3-бета: это не возможность 3-бета');
ok(has(s.by, 'BBp.VPIP', '0') && has(s.by, 'SBp.VPIP', '0'), 'блайнды сфолдили: VPIP = нет');
ok(s.by['UTGp.WS'] === undefined, 'без флопа квадрата нет');
// раскладка счётчиков лайнапа: банд 150+ — индекс 6 × 45 = 270
ok(s.sl.includes('UTGp 270>1'), 'лайнап: UTG (EP) RFI — опен (слот 0, действие 1)');
ok(s.sl.includes('MPp 298') && s.sl.includes('COp 298>2'), 'лайнап: HJ/CO против опена без коллеров — фолд / 3-бет (слоты 28..31)');
ok(s.sl.includes('UTGp 305>1'), 'лайнап: открывший против 3-бета — фолд (слоты 35..38)');

console.log('— 2. UTG лимп, все фолд до ББ, ББ чек; 1 на 1 до ривера; ББ ставит ривер, UTG фолд');
s = stats(hand(['UTGp: calls 20', 'MPp: folds', 'COp: folds', 'BTNp: folds', 'SBp: folds', 'BBp: checks',
  '*** FLOP *** [2c 7d Kh]', 'BBp: checks', 'UTGp: checks', '*** TURN *** [2c 7d Kh] [9s]', 'BBp: checks', 'UTGp: checks',
  '*** RIVER *** [2c 7d Kh 9s] [3h]', 'BBp: bets 30', 'UTGp: folds', 'Uncalled bet (30) returned to BBp', 'BBp collected 50 from pot',
  '*** SUMMARY ***', 'Total pot 50 | Rake 0']));
ok(has(s.by, 'UTGp.LimpNSB', '1') && has(s.by, 'UTGp.VPIP', '1') && has(s.by, 'UTGp.PFR', '0'), 'UTG: лимп засчитан, VPIP да, PFR нет');
ok(has(s.by, 'SBp.LimpNSB', undefined) || s.by['SBp.LimpNSB'] === undefined, 'МБ: лимп с МБ не считается (nSB)');
ok(has(s.by, 'BBp.VPIP', '0') && s.by['BBp.LimpNSB'] === undefined, 'ББ: чек — не VPIP и не лимп');
ok(has(s.by, 'UTGp.LN', '1') && has(s.by, 'UTGp.WN', '0') && has(s.by, 'BBp.WN', '1') && has(s.by, 'BBp.LN', '0'), 'квадрат: UTG — LN, ББ — WN');
ok(has(s.by, 'BBp.BetRiverHU', '1') && s.by['UTGp.BetRiverHU'] === undefined, 'ривер: ББ первым — возможность и ставка; UTG уже перед ставкой — не возможность Bet River');
ok(has(s.by, 'UTGp.FoldRiverBetHU', '1'), 'ривер: UTG против ставки — фолд');

console.log('— 3. Префлоп-олл-ин 1 на 1 — в квадрат не входит');
s = stats(hand(['UTGp: raises 2980 to 3000 and is all-in', 'MPp: folds', 'COp: folds', 'BTNp: folds', 'SBp: folds', 'BBp: calls 2980 and is all-in',
  '*** FLOP *** [2c 7d Kh]', '*** TURN *** [2c 7d Kh] [9s]', '*** RIVER *** [2c 7d Kh 9s] [3h]', '*** SHOW DOWN ***',
  'UTGp: shows [Ac Ad] (a pair of Aces)', 'BBp: shows [Kc Qd] (a pair of Kings)', 'UTGp collected 6010 from pot',
  '*** SUMMARY ***', 'Total pot 6010 | Rake 0']));
ok(s.by['UTGp.WS'] === undefined && s.by['BBp.LS'] === undefined, 'префлоп-олл-ин: WS/LS не считаются');
ok(has(s.by, 'UTGp.PFR', '1'), 'пуш — это PFR');

console.log('— 4. МБ комплит, ББ чек; 3-бет олл-ином');
s = stats(hand(['UTGp: folds', 'MPp: folds', 'COp: folds', 'BTNp: folds', 'SBp: calls 10', 'BBp: checks', '*** FLOP *** [2c 7d Kh]',
  'SBp: bets 20', 'BBp: folds', 'Uncalled bet (20) returned to SBp', 'SBp collected 40 from pot', '*** SUMMARY ***', 'Total pot 40 | Rake 0']));
ok(s.by['SBp.LimpNSB'] === undefined && has(s.by, 'SBp.VPIP', '1'), 'комплит с МБ: VPIP да, Limp nSB не считается');
ok(has(s.by, 'SBp.WN', '1') && has(s.by, 'BBp.LN', '1'), 'квадрат 1 на 1: МБ — WN, ББ — LN');
s = stats(hand(['UTGp: raises 40 to 60', 'MPp: raises 2940 to 3000 and is all-in', 'COp: folds', 'BTNp: folds', 'SBp: folds', 'BBp: folds', 'UTGp: folds',
  'Uncalled bet (2940) returned to MPp', 'MPp collected 150 from pot', '*** SUMMARY ***', 'Total pot 150 | Rake 0']));
ok(has(s.by, 'MPp.3BetNAI', '0'), '3-бет олл-ином: возможность есть, 3Bet nAI не засчитан');
ok(has(s.by, 'UTGp.F3Bet', '1'), 'фолд на 3-бет олл-ином — F3Bet');

console.log('— 5. Мультивей на флопе — квадрат не считается; таблица префлоп-действий');
s = stats(hand(['UTGp: raises 40 to 60', 'MPp: calls 60', 'COp: folds', 'BTNp: folds', 'SBp: folds', 'BBp: calls 40', '*** FLOP *** [2c 7d Kh]',
  'BBp: checks', 'UTGp: bets 100', 'MPp: folds', 'BBp: folds', 'Uncalled bet (100) returned to UTGp', 'UTGp collected 190 from pot',
  '*** SUMMARY ***', 'Total pot 190 | Rake 0']));
ok(s.by['UTGp.WN'] === undefined, 'флоп на троих: WS/WN/LS/LN не считаются');
ok(s.pf.includes('UTGp 150+|RFI|EP|||open') && s.pf.includes('MPp 150+|VSO|MP|EP|C0|call') && s.pf.includes('SBp 100-149|VSO|SB|EP|C1|fold'), 'префлоп-таблица: банд 150+ (3000/20), RFI EP опен; HJ(MP) колл против EP; МБ после блайнда 149,5 bb → банд 100-149');
console.log(fails ? `\nОШИБОК: ${fails}` : '\nВсе проверки пройдены');
