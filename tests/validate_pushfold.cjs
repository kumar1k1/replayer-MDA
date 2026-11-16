'use strict';
// ПРОВЕРКА ТОЧНОГО РАСЧЁТА ПУША И КОЛЛА ОЛЛ-ИНА: на каждом реальном пуше/колле героя движок считает EV
// по эквити против диапазонов из модели; сравниваем со средним фактическим итогом (с поправкой на олл-ин).
// Если расчёт честный, средние совпадают в пределах шума — по каждому классу руки.
//   node tests/validate_pushfold.cjs /tmp/synth2/PS /tmp/v7b/model_v7.json
const fs = require('fs'), path = require('path');
const C = require('../pipeline/common.cjs'), K = require('../lib/cards.js'), E = require('../engine/engine_v7.js');
const P_ = C.loadParser(), { frames } = P_, parseHand = C.makeParse(P_);
const dir = process.argv[2] || '/tmp/synth2/PS', HERO = 'DemoStars';
const eng = E.create(JSON.parse(fs.readFileSync(process.argv[3] || '/tmp/v7b/model_v7.json', 'utf8')), require('../data/eq169.json'));
const G = {};
const add = (k, pred, truth) => { const g = G[k] || (G[k] = { n: 0, p: 0, t: 0, tt: 0 }); g.n++; g.p += pred; g.t += truth; g.tt += truth * truth; };
const files = fs.readdirSync(dir), half = files.filter((_, i) => i % 2 === 1); // половина файлов — проверочная
for (const f of half) for (const x of C.splitHands(fs.readFileSync(path.join(dir, f), 'utf8'), f)) {
  const m = /Dealt to (\S+) \[(\w\w \w\w)\]/.exec(x.hand); if (!m || m[1] !== HERO) continue;
  const rp = parseHand(x.hand); if (!rp || !rp.n) continue;
  const hi = rp.nm.indexOf(HERO), cards = K.parseCards(m[2]);
  const fr = frames(rp), fin = fr[fr.length - 1], SD = {};
  for (const [k, v] of Object.entries(rp.sh || {})) { const c = K.parseCards(v); if (c && c.length === 2) SD[+k] = { c }; }
  const A = C.netAdjusted(rp, fin, SD);
  for (const d of E.decisionsBacking(rp, () => 'unk', x.fp)) {
    if (d.i !== hi) continue;
    const truth = A.net[hi] / rp.bb + d.inv, cl = K.C12OF[K.h169(cards[0], cards[1])];
    if (d.act === 'shove' && (d.tbl === 'RFI' || d.tbl === 'ISO')) add('пуш первым · ' + cl, eng.shoveEV(d, cards).m, truth);
    if (d.act === 'shove' && (d.tbl === 'VSO' || d.tbl === 'VS3')) add('пуш против ' + (d.tbl === 'VSO' ? 'опена' : '3-бета') + ' · ' + cl, eng.shoveEV(d, cards).m, truth);
    if (d.act === 'call' && d.tbl === 'AI' && d.C === 'C0') add('колл олл-ина · ' + cl, eng.callAllinEV(d, cards).m, truth);
  }
}
let bad = 0, tot = 0;
console.log('группа | n | прогноз EV | факт EV ± 95%ДИ');
for (const [k, g] of Object.entries(G).sort()) {
  if (g.n < 40) continue;
  const t = g.t / g.n, sd = Math.sqrt(Math.max(g.tt / g.n - t * t, 0)), ci = 1.96 * sd / Math.sqrt(g.n), p = g.p / g.n;
  const ok = Math.abs(p - t) <= ci; tot++; if (!ok) bad++;
  console.log(`${k} | ${g.n} | ${p.toFixed(2)} | ${t.toFixed(2)} ± ${ci.toFixed(2)} ${ok ? '' : '  ← вне ДИ'}`);
}
console.log(`\nвне 95% ДИ: ${bad} из ${tot} групп (при честном расчёте ожидается ~5%)`);
