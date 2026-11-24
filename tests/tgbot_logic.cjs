'use strict';
// Проверка расчётов алиаса на логику (24.11.2026): суммы внутри стата и согласованность между таблицами.
// node tests/tgbot_logic.cjs — читает tgbot/data/players.db (alias:все)
const { DatabaseSync } = require('node:sqlite'), path = require('path');
const db = new DatabaseSync(path.join(__dirname, '..', 'tgbot', 'data', 'players.db'), { readOnly: true });
const E = JSON.parse(db.prepare("SELECT ext FROM p WHERE key = 'alias:все'").get().ext);
const BANDS = ['<12', '12-19', '20-35', '36-59', '60-99', '100-149', '150+'];
let ok = 0; const bad = [];
const chk = (name, cond, info) => { if (cond) ok++; else bad.push(name + (info ? '  [' + info + ']' : '')); };
const sumV = (arr) => arr.reduce((a, x) => a.map((v, j) => v + (x[j] || 0)), new Array(Math.max(...arr.map(x => x.length), 0)).fill(0));
// 1) в каждом листе «all» = сумма стеков
function bandsSum(name, node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.all) || (node.all && BANDS.some(b => Array.isArray(node[b])))) {
    if (Array.isArray(node.all)) { const s = sumV(BANDS.filter(b => node[b]).map(b => node[b])); chk(name + ': all = сумма стеков', s.every((v, j) => Math.abs(v - node.all[j]) < 1e-6), node.all.slice(0, 4) + ' vs ' + s.slice(0, 4).map(v => Math.round(v))); }
    return;
  }
  for (const k of Object.keys(node)) bandsSum(name + '.' + k, node[k]);
}
for (const k of ['rfi', 'vso', 'v3m', 'iso', 'oc', 'b3i', 's3', 'f3', 'c3']) bandsSum(k, E[k]);
const A = (x) => (x && x.all) || [0, 0, 0, 0, 0, 0, 0, 0, 0];
const POS6 = ['MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'], OPEN = ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'];
// 2) RFI: TOT = сумма позиций (с SB); RFI ≥ NAI
{ const t = A(E.rfi.TOT), s = sumV(OPEN.map(p => A(E.rfi[p]))); chk('RFI: TOT = сумма позиций', t[0] === s[0] && t[1] === s[1] && t[2] === s[2], t + ' / ' + s);
  for (const p of OPEN) { const x = A(E.rfi[p]); chk('RFI ' + p + ': всё ≥ NAI', x[1] >= x[2]); } }
// 3) ответы на опен: колл + 3-бет + олл-ин ≤ раз; TOT = позиции + BB против SB; TOTnb = позиции без BB
{ for (const p of [...POS6, 'TOT', 'TOTnb']) { const x = A(E.vso[p]); chk('опен ' + p + ': колл+3бет+олл-ин ≤ раз', x[1] + x[2] + x[3] <= x[0]); }
  const nb = sumV(['MP', 'HJ', 'CO', 'BTN', 'SB'].map(p => A(E.vso[p]))), tnb = A(E.vso.TOTnb); chk('опен: TOTnb = позиции без BB', nb.every((v, j) => v === tnb[j]), tnb + ' / ' + nb);
  const all6 = sumV(POS6.map(p => A(E.vso[p]))), T = A(E.vso.TOT); chk('опен: TOT ≥ сумма позиций (разница — BB против SB)', T[0] >= all6[0], T[0] + ' / ' + all6[0]);
  // 3-бет по позициям = 3-бет из старого счёта h3 (тот же правило)
  for (const p of POS6) { const h = E.h3 && E.h3[p], x = A(E.vso[p]); if (h) chk('3-бет ' + p + ': таблица = карточка', h[0] === x[0] && h[1] === x[2], 'h3 ' + h.slice(0, 2) + ' / vso ' + [x[0], x[2]]); } }
// 4) позиция против позиции: по строке сумма = позиции (у BB — плюс BB против SB)
{ for (const h of POS6) { const row = E.v3m[h] || {}, s = sumV(Object.keys(row).map(o => A(row[o]))), x = A(E.vso[h]), sbPart = h === 'BB' && row.SB ? A(row.SB) : [0, 0, 0, 0];
    chk('позиция против позиции ' + h + ': сумма строки = позиция', s[0] - sbPart[0] === x[0] && s[1] - sbPart[1] === x[1] && s[2] - sbPart[2] === x[2], 'строка ' + s.slice(0, 3) + ' − SB ' + sbPart.slice(0, 3) + ' / позиция ' + x.slice(0, 3)); } }
// 5) фолд на 3-бет / 4-бет: фолд + колл + 4-бет = раз; IP + OOP = все; олл-ин части ≤ целого; TOT = позиции без SB
{ for (const p of [...OPEN, 'TOT']) { const M = E.f3[p]; if (!M) continue; const a = A(M.all), i = A(M.ip), o = A(M.oop);
    chk('фолд на 3-бет ' + p + ': фолд+колл+4бет = раз', a[1] + a[2] + a[3] === a[0], a.slice(0, 4));
    chk('фолд на 3-бет ' + p + ': IP + OOP = все', i[0] + o[0] === a[0] && i[1] + o[1] === a[1]);
    chk('фолд на 3-бет ' + p + ': олл-ин части в пределах', a[5] <= a[4] && a[4] <= a[0] && a[6] <= a[3]); }
  const t = A(E.f3.TOT.all), s = sumV(['EP', 'MP', 'HJ', 'CO', 'BTN'].map(p => A(E.f3[p] && E.f3[p].all))); chk('фолд на 3-бет: TOT = позиции без SB', t[0] === s[0] && t[1] === s[1], t[0] + ' / ' + s[0]); }
// 6) 3-беты по сайзам: сумма размеров = 3-беты без олл-ина (TOT и позиции)
{ for (const p of ['TOT', ...POS6]) { let n = 0; for (const g of Object.keys(E.s3)) n += A(E.s3[g][p])[0]; const v = A(E.vso[p]); const ref = p === 'TOT' ? v[2] : v[2] + (p === 'BB' ? 0 : 0);
    chk('сайзы ' + p + ': сумма размеров = 3-беты NAI', p === 'BB' ? n >= v[2] : n === ref, n + ' / ' + ref); }
  let f = 0, fd = 0; for (const g of Object.keys(E.s3)) { const x = A(E.s3[g].TOT); f += x[2]; fd += x[3]; } chk('сайзы: фолд на 4-бет ≤ 4-бетов', fd <= f); }
// 7) изолейт: изо ≥ изо олл-ином; фолды ≤ случаев; TOT = позиции + BBsb
{ for (const p of [...POS6, 'TOT']) for (const L of [1, 2]) { const x = A(E.iso[p] && E.iso[p][L]); chk('изо ' + p + ' L' + L + ': части в пределах', x[1] <= x[0] && x[2] <= x[1] && x[4] <= x[3] && x[3] <= x[5] && x[6] <= x[5] && (x[7] || 0) <= x[5] && (x[8] || 0) <= (x[7] || 0)); }
  for (const L of [1, 2]) { const s = sumV([...POS6, 'BBsb'].map(p => A(E.iso[p] && E.iso[p][L]))), t = A(E.iso.TOT[L]); chk('изо L' + L + ': TOT = позиции + BB против SB', s[0] === t[0] && s[1] === t[1], t[0] + ' / ' + s[0]); } }
// 8) колл третьим/четвёртым, 3-бет против изо, колл 3-бета в холодную: части ≤ целого, TOT = позиции
{ for (const C of [1, 2]) { const s = sumV(['MP', 'HJ', 'CO', 'BTN', 'SB'].map(p => A(E.oc[p] && E.oc[p][C]))), t = A(E.oc.TOT && E.oc.TOT[C]); chk('колл ' + (C + 2) + '-м: TOT = позиции без BB', s[0] === t[0] && s[1] === t[1], t[0] + ' / ' + s[0]); }
  { const s = sumV(POS6.map(p => A(E.b3i[p]))), t = A(E.b3i.TOT); chk('3-бет против изо: TOT = позиции', s[0] === t[0] && s[1] === t[1] && s[2] === t[2], t + ' / ' + s); }
  { const s = sumV(POS6.map(p => A(E.c3[p]))), t = A(E.c3.TOT); chk('колл 3-бета: TOT = позиции', s[0] === t[0] && s[1] === t[1], t + ' / ' + s); for (const p of POS6) { const x = A(E.c3[p]); chk('колл 3-бета ' + p + ': колл+4бет ≤ раз', x[1] + x[2] <= x[0]); } } }
console.log('проверок: ' + (ok + bad.length) + ', прошли: ' + ok + ', не прошли: ' + bad.length);
for (const b of bad) console.log('✗ ' + b);
