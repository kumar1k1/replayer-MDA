'use strict';
// Регрессия п.1: две ошибки разбора реальных историй, исправленные нормализацией текста (common.normalizeHand).
//   1) «posts big blind 27 and is all-in» — вложение короткого блайнда терялось, банк не сходился;
//   2) «folds [Ah Kc]» — фолд с показом карт не распознавался, игрок оставался в раздаче.
const fs = require('fs'), path = require('path');
const C = require('../pipeline/common.cjs');
const P = C.loadParser(), parse = C.makeParse(P);
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) process.exitCode = 1; };
const F = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

const h1 = F('ps_bb_allin_blind.txt');
const raw1 = P.parseHand(h1 + '\n'), fin0 = P.frames(raw1).pop();
ok(!C.handIntact(raw1, fin0, h1), 'без нормализации банк короткого ББ не сходится (ошибка воспроизводится)');
const rp1 = parse(h1), fin1 = P.frames(rp1).pop();
ok(C.handIntact(rp1, fin1, h1), 'после нормализации банк = сумме вложений, выигрыши = банк − рейк');
const bbi = rp1.nm.indexOf('gazzu666');
ok(rp1.ev.some(e => e.t === 'BB' && e.i === bbi && Math.abs(e.a - 27) < 1e-9), 'короткий ББ (27) записан как блайнд');
ok(Math.abs((rp1.stacks[bbi] - fin1.stacks[bbi]) - (48 - 282)) < 1e-6, 'итог короткого ББ: вложил 48 (анте 21 + ББ 27), выиграл 282');

const h2 = F('ps_fold_shows_cards.txt');
const raw2 = P.parseHand(h2 + '\n'), rp2 = parse(h2);
const ri = rp2.nm.indexOf('Rhino951');
ok(!raw2.ev.some(e => e.t === 'f' && e.i === ri && e.st === 2), 'без нормализации фолд с картами на тёрне теряется (ошибка воспроизводится)');
ok(rp2.ev.some(e => e.t === 'f' && e.i === ri && e.st === 2), 'после нормализации фолд Rhino951 на тёрне есть');
ok(P.frames(rp2).pop().folded[ri] === true, 'в итоговом кадре Rhino951 сфолдил');

const S = new C.IdSet(12);
ok(S.add('ps', '259165002509') && !S.add('ps', '259165002509') && S.add('coin', '259165002509'), 'повторы: одна раздача рума — один раз; одинаковый номер в другом руме — другая раздача');
