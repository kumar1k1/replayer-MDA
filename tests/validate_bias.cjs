'use strict';
// ПРОВЕРКА НА ИСТИНЕ: в синтетических историях у героя карты известны в КАЖДОЙ раздаче (Dealt to),
// а у базы на 100 млн — только во вскрытиях. Значит, по герою можно посчитать «истинный» EV действия
// для каждого класса руки и сравнить с тем, что дали бы методы, видящие только вскрытия:
//   v6 — среднее по вскрытым рукам (как слой HC в passBC_v6), без поправки на олл-ин;
//   v7 — P(все сфолдили)×банк + (1−P)×(среднее по вскрытым − сдвиг вскрытий), с поправкой на олл-ин.
// Плюс выбор действия: v6 — «лучшее из EV>0, иначе фолд» по сырому итогу; v7 — максимум с фолдом = 0.
//   node tests/validate_bias.cjs /tmp/synth2/PS [ник героя=DemoStars]
const fs = require('fs'), path = require('path');
const C = require('../pipeline/common.cjs'), K = require('../lib/cards.js');
const P_ = C.loadParser(), { frames } = P_, parseHand = C.makeParse(P_);
const dir = process.argv[2] || '/tmp/synth2/PS', HERO = process.argv[3] || 'DemoStars';

// G[спот|действие] → накопители; классы — внутри
const S = new Map();
const acc = () => ({ n: 0, s: 0, ss: 0 });
const put = (a, v) => { a.n++; a.s += v; a.ss += v * v; };
function grp(key) {
  let g = S.get(key);
  if (!g) { g = { all: acc(), allRaw: acc(), fa: acc(), cont: acc(), shownAll: acc(), shownRaw: acc(), cls: {} }; S.set(key, g); }
  return g;
}
let hands = 0, dec = 0;
for (const f of fs.readdirSync(dir)) {
  for (const x of C.splitHands(fs.readFileSync(path.join(dir, f), 'utf8'), f)) {
    const m = /Dealt to (\S+) \[(\w\w \w\w)\]/.exec(x.hand); if (!m || m[1] !== HERO) continue;
    const rp = parseHand(x.hand); if (!rp || !rp.n) continue;
    const hi = rp.nm.indexOf(HERO); if (hi < 0) continue;
    const fr = frames(rp), fin = fr[fr.length - 1];
    const SD = {};
    for (const [k, v] of Object.entries(rp.sh || {})) { const c = K.parseCards(v); if (c && c.length === 2) SD[+k] = { c, h: K.h169(c[0], c[1]) }; }
    const A = C.netAdjusted(rp, fin, SD);
    const raw = (fin.stacks[hi] - rp.stacks[hi]) / rp.bb;
    const cards = K.parseCards(m[2]), h = K.h169(cards[0], cards[1]), cl = K.C12OF[h];
    hands++;
    for (const d of C.preflopDecisions(rp, () => 'unk')) {
      if (d.i !== hi || d.act === 'fold') continue;
      dec++;
      const rel = A.net[hi] / rp.bb + d.inv, relRaw = raw + d.inv;
      const fa = d.act !== 'check' && C.foldedAround(rp, d.k, hi);
      const key = [d.tbl, C.posBand(d.pos), d.sB, d.act].join('|');
      const g = grp(key);
      put(g.all, rel); put(g.allRaw, relRaw); (fa ? put(g.fa, rel) : put(g.cont, rel));
      const c = g.cls[cl] || (g.cls[cl] = { all: acc(), shown: acc(), shownRaw: acc(), net: acc() });
      put(c.all, rel); put(c.net, A.net[hi] / rp.bb);
      if (SD[hi]) { put(c.shown, rel); put(c.shownRaw, relRaw); put(g.shownAll, rel); }
    }
  }
}
const mean = (a) => (a.n ? a.s / a.n : null);
const sd = (a) => (a.n ? Math.sqrt(Math.max(a.ss / a.n - (a.s / a.n) ** 2, 0)) : null);
// 1) точность EV класса руки
let e6 = 0, e7 = 0, W = 0, groups = 0;
const rows = [];
for (const [key, g] of S) {
  const pfa = g.fa.n / g.all.n, mfa = mean(g.fa) || 0, contAll = mean(g.cont);
  const shift = g.shownAll.n >= 30 && contAll !== null ? mean(g.shownAll) - contAll : 0;
  for (const [cl, c] of Object.entries(g.cls)) {
    if (c.all.n < 300 || c.shown.n < 20) continue;
    const truth = mean(c.all), v6 = mean(c.shownRaw), v7 = pfa * mfa + (1 - pfa) * (mean(c.shown) - shift);
    const w = c.all.n; e6 += w * Math.abs(v6 - truth); e7 += w * Math.abs(v7 - truth); W += w; groups++;
    rows.push({ key, cl, n: c.all.n, shown: c.shown.n, truth, v6, v7 });
  }
}
console.log('рук героя:', hands, 'решений (кроме фолда):', dec, 'групп спот×класс для сравнения:', groups);
console.log('Средняя ошибка EV класса руки, bb (взвешено по числу решений):');
console.log('  v6 (только вскрытия, факт):            ', (e6 / W).toFixed(3));
console.log('  v7 (FA по всем + сдвиг + олл-ин):      ', (e7 / W).toFixed(3));
rows.sort((a, b) => b.n - a.n);
console.log('\nкрупнейшие группы: спот | класс | n | вскрыто | истина | v6 | v7');
for (const r of rows.slice(0, 14)) console.log(' ', r.key, '|', r.cl, '|', r.n, '|', r.shown, '|', r.truth.toFixed(2), '|', r.v6.toFixed(2), '|', r.v7.toFixed(2));
// 2) шум: стандартное отклонение итога с поправкой на олл-ин и без — в спотах пуша
let a1 = 0, a2 = 0, an = 0;
for (const [key, g] of S) if (/\|shove$/.test(key) && g.all.n >= 100) { a1 += sd(g.allRaw) * g.all.n; a2 += sd(g.all) * g.all.n; an += g.all.n; }
if (an) console.log('\nШум итога в спотах пуша (σ, bb): факт', (a1 / an).toFixed(2), '→ с поправкой на олл-ин', (a2 / an).toFixed(2), `(нужно в ${((a1 / a2) ** 2).toFixed(1)} раза меньше раздач для той же точности)`);
// 3) правило v6 «играть, если EV > 0, иначе фолд» меряет EV по итогу раздачи (без вложенного до решения).
// В блайндах итог почти всегда < 0 даже у лучшего действия — а фолд стоит −блайнд. Считаем пары спот×класс,
// где лучшее действие лучше фолда (EV от фолда > 0), но его итог раздачи < 0 — там v6 советует фолд.
const best = new Map();
for (const [key, g] of S) {
  const [tbl, pos, sB, act] = key.split('|');
  for (const [cl, c] of Object.entries(g.cls)) {
    if (c.all.n < 150) continue;
    const k2 = [tbl, pos, sB, cl].join('|'); const b = best.get(k2);
    if (!b || mean(c.all) > b.ev) best.set(k2, { ev: mean(c.all), net: mean(c.net), act });
  }
}
let bl = 0, blWrong = 0; const ex = [];
for (const [k2, b] of best) {
  if (!/\|(SB|BB)\|/.test(k2)) continue;
  bl++;
  if (b.ev > 0.05 && b.net < 0) { blWrong++; if (ex.length < 5) ex.push(k2 + ' → ' + b.act + ': от фолда +' + b.ev.toFixed(2) + ', итог ' + b.net.toFixed(2)); }
}
console.log(`\nБлайнды: в ${blWrong} из ${bl} пар «спот×класс» лучшее действие выгоднее фолда, но его итог раздачи < 0 — v6 советует там фолд.`);
ex.forEach(e => console.log('  ', e));
