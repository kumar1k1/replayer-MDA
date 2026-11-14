'use strict';
// Таблица префлоп-эквити 169×169: EQ[a*169+b] — доля банка руки a против руки b (комбинации мастей — случайные, без пересечений).
//   node lib/build_eq169.js [выборок_на_пару=2000] → data/eq169.json
const fs = require('fs'), path = require('path');
const C = require('./cards.js');
const N = +(process.argv[2] || 2000);
const EQ = new Float64Array(169 * 169);
const combos = C.H169.map((_, h) => C.combosOf(h));
const t0 = Date.now();
const cs = new Array(7), used = new Uint8Array(52), deck = new Array(52);
for (let a = 0; a < 169; a++) {
  for (let b = a; b < 169; b++) {
    let sum = 0, runs = 0;
    for (let k = 0; k < N; k++) {
      const ca = combos[a][Math.floor(C.rnd() * combos[a].length)];
      let cb, tries = 0;
      do { cb = combos[b][Math.floor(C.rnd() * combos[b].length)]; tries++; } while ((cb[0] === ca[0] || cb[0] === ca[1] || cb[1] === ca[0] || cb[1] === ca[1]) && tries < 50);
      if (tries >= 50) continue; // AA против AA и т.п. — всегда найдётся; страховка
      used.fill(0); used[ca[0]] = used[ca[1]] = used[cb[0]] = used[cb[1]] = 1;
      let L = 0; for (let c = 0; c < 52; c++) if (!used[c]) deck[L++] = c;
      for (let j = 0; j < 5; j++) { const r = j + Math.floor(C.rnd() * (L - j)); const t = deck[j]; deck[j] = deck[r]; deck[r] = t; cs[2 + j] = deck[j]; }
      cs[0] = ca[0]; cs[1] = ca[1]; const s1 = C.eval7(cs, 7);
      cs[0] = cb[0]; cs[1] = cb[1]; const s2 = C.eval7(cs, 7);
      sum += s1 > s2 ? 1 : s1 === s2 ? 0.5 : 0; runs++;
    }
    const e = runs ? sum / runs : 0.5;
    EQ[a * 169 + b] = e; EQ[b * 169 + a] = 1 - e;
    if (a === b) EQ[a * 169 + a] = 0.5;
  }
  if (a % 20 === 0) console.log('строка', a, '/169', ((Date.now() - t0) / 1000).toFixed(0) + ' c');
}
const out = { n: N, labels: C.H169.map(h => h.label), eq: Array.from(EQ, v => Math.round(v * 10000)) };
fs.writeFileSync(path.join(__dirname, '..', 'data', 'eq169.json'), JSON.stringify(out));
console.log('готово:', ((Date.now() - t0) / 1000).toFixed(0), 'c');
