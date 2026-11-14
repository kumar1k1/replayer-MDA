'use strict';
// Проверка оценщика и эквити: частоты категорий 7 карт и известные эквити.
const C = require('../lib/cards.js');
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const N = 400000, cat = new Array(9).fill(0), cs = new Array(7);
for (let k = 0; k < N; k++) {
  const used = new Set(); let j = 0;
  while (j < 7) { const c = Math.floor(C.rnd() * 52); if (!used.has(c)) { used.add(c); cs[j++] = c; } }
  cat[Math.floor(C.eval7(cs, 7) / 371293)]++;
}
const want = [17.41, 43.83, 23.50, 4.83, 4.62, 3.03, 2.60, 0.168, 0.031];
cat.forEach((v, i) => assert(Math.abs(v / N * 100 - want[i]) < Math.max(0.35, want[i] * 0.05), `категория ${i}: ${(v / N * 100).toFixed(3)}% (ждём ${want[i]}%)`));
const P = (s) => C.parseCards(s);
const eqs = [['As Ah', 'Kd Kc', 0.819], ['As Ks', 'Qd Qc', 0.460], ['7c 2d', 'Ah As', 0.12], ['Ah Kd', '7s 6s', 0.5785]];
for (const [a, b, w] of eqs) { const e = C.equity([P(a), P(b)], [], 40000)[0]; assert(Math.abs(e - w) < 0.012, `${a} vs ${b}: ${e.toFixed(3)} (ждём ~${w})`); }
// флоп: точный перебор. AhKh vs QsQd на 2h7h9c — у AK флеш-дро + 2 оверкарты ≈ 0.53
const e2 = C.equity([P('Ah Kh'), P('Qs Qd')], P('2h 7h 9c'))[0];
assert(Math.abs(e2 - 0.53) < 0.03, 'флоп AhKh vs QQ на 2h7h9c: ' + e2.toFixed(3));
assert(C.H169.length === 169 && C.H169.reduce((s, h) => s + h.combos, 0) === 1326, '169 рук = 1326 комбинаций');
assert(C.class12(C.IDX['AKs']) === 'AK' && C.class12(C.IDX['KQs']) === 'br_conn' && C.class12(C.IDX['T9s']) === 'su_conn' && C.class12(C.IDX['65s']) === 'su_conn', 'классы 12');
