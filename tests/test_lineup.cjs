'use strict';
// П.7 ТЕСТЫ ЛАЙНАПА: раскладка слотов, стягивание игрок → кластер → пул, P(все сфолдят), поправка контекста.
const LU = require('../lib/lineup.js'), ST = require('../lib/stats.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) { fails++; process.exitCode = 1; } };
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-9);
const NS = ST.PF_SLOTS, z = () => new Array(NS).fill(0);

ok(LU.slotOf('rfi', '<12', 'EP') === 0 && LU.slotOf('rfi', '<12', 'SB') === 16, 'RFI: EP — слот 0, SB — 16 (как в lib/stats.js)');
ok(LU.slotOf('vso', '150+', 'BB') === 6 * 45 + 20 && LU.slotOf('vso', '150+', 'CO') === 6 * 45 + 28, 'против опена: BB — 20, остальные — 28 (банд 150+)');
ok(LU.slotOf('ai', '20-35', 'BTN') === 2 * 45 + 43, 'против олл-ина — 43');

// пул: BB 36-59 против опена — 1000 возможностей, 300 коллов, 100 3-бетов, 20 пушей → фолд 58%
const pool = z(), o = LU.slotOf('vso', '36-59', 'BB'); pool[o] = 1000; pool[o + 1] = 300; pool[o + 2] = 100; pool[o + 3] = 20;
const clF = z(); clF[o] = 500; clF[o + 1] = 300; clF[o + 2] = 50; clF[o + 3] = 0; // «фиш»-кластер: колл 60%, фолд 30%
const M = LU.create({ pool, cl: { 19: clF }, K: { vso: { Kc: 20, Kp: 50 } } });
let r = M.prob('vso', '36-59', 'BB', null, null);
ok(near(r.fold, 0.58) && near(r.call + r['3bet'] + r.shove + r.fold, 1), 'без игрока и кластера — пул: фолд 58%, сумма = 1');
r = M.prob('vso', '36-59', 'BB', null, 19);
ok(near(r.call, (300 + 20 * 0.3) / 520) && r.src === 'кластер', 'неизвестный игрок фиш-кластера: колл ≈ 59% (кластер, чуть стянут к пулу)');
const pf = z(); pf[o] = 50; pf[o + 1] = 5; pf[o + 2] = 5;
r = M.prob('vso', '36-59', 'BB', pf, 19);
const qc = (300 + 20 * 0.3) / 520;
ok(near(r.call, qc) && r.n === 50 && r.w === 0 && /кластер/.test(r.src), 'игрок с 50 возможностями (< 200): личное не берём — частота кластера');
{ const pf2 = z(); pf2[o] = 200; pf2[o + 1] = 20; pf2[o + 2] = 20; const r2 = M.prob('vso', '36-59', 'BB', pf2, 19), Kp = 50;
  ok(near(r2.call, (20 + Kp * qc) / (200 + Kp)) && r2.src === 'игрок' && near(r2.w, 200 / 250), 'игрок с 200 возможностями (колл 10%): смесь с весом личного 200/(200+Kp)'); }
const big = z(); big[o] = 5000; big[o + 1] = 500;
ok(Math.abs(M.prob('vso', '36-59', 'BB', big, 19).call - 0.1) < 0.01, '5000 возможностей — почти собственная частота');

// P(все сфолдят) — произведение
const M2 = LU.create({ pool, K: { vso: { Kc: 20, Kp: 50 } } });
const fa = M2.foldAll('vso', [{ pos: 'BB', band: '36-59' }, { pos: 'BB', band: '36-59' }]);
ok(near(fa.p, 0.58 * 0.58), 'двое за спиной с фолдом 58% → P(все сфолдят) = 33.6%');

// поправка контекста: + к логиту фолда, остальные действия масштабируются
const ctx = { aggPos: 'EP', size: '3x' };
const M3 = LU.create({ pool, K: { vso: { Kc: 20, Kp: 50 } }, adj: { [LU.adjKey('vso', '36-59', 'BB', ctx)]: 0.5 } });
r = M3.prob('vso', '36-59', 'BB', null, null, ctx);
const nf = LU.sig(LU.logit(0.58) + 0.5);
ok(near(r.fold, nf) && near(r.call + r['3bet'] + r.shove + r.fold, 1) && near(r.call / r['3bet'], 3), 'поправка «опен 3x с EP»: фолд растёт, сумма = 1, пропорции колл:3-бет сохраняются');
ok(near(M3.prob('vso', '36-59', 'BB', null, null, { aggPos: 'BTN', size: '2x' }).fold, 0.58), 'без поправки для ключа — без изменений');

if (!fails) console.log('\nВсе проверки лайнапа пройдены');
