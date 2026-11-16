'use strict';
// ============================================================================
// П.5 ТОПЫ — перекрёстный отбор по половинам базы (cross-fitting), без отбора по удаче.
//  Топ = кластер выигрывающих регов (8, 0, 5, 4, 3, 10 по документации тренера)
//        + ≥ MIN_HANDS рук всего (владелец: винрейт оценивается от 3000 рук)
//        + винрейт на половине отбора > MIN_BB100 (с поправкой на олл-ин у PokerStars).
//  tops_A — отобраны по половине A (ими меряется модель на раздачах половины B), tops_B — наоборот.
//  Так в модель не попадает удача, по которой игрока отобрали: каждая раздача меряется по топам, отобранным на других раздачах.
// Отчёт: доверительные интервалы винрейта и насколько винрейт повторяется между половинами (есть ли в нём умение, а не шум).
// Вход: players_v8.ndjson (r = [nA, ΣbbA, Σbb²A, nB, ΣbbB, Σbb²B]), players_cl_v8.json. Выход: tops_v8.json, tops_report.json
// ============================================================================
const fs = require('fs'), path = require('path');
const CLU = require('../lib/clusters.js');
const OUT = process.env.OUT_DIR || path.join(__dirname, 'out');
const MIN_HANDS = +(process.env.MIN_HANDS_TOP || 3000), MIN_BB100 = +(process.env.MIN_BB100 || 0);
const players = fs.readFileSync(path.join(OUT, 'players_v8.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
const CL = JSON.parse(fs.readFileSync(path.join(OUT, 'players_cl_v8.json'), 'utf8'));
const wr = (r, h, fo) => { fo = fo || 0; const n = r[fo + h * 3], s = r[fo + h * 3 + 1], ss = r[fo + h * 3 + 2]; if (!n) return null; const m = s / n, sd = Math.sqrt(Math.max(ss / n - m * m, 0)); return { n, bb100: m * 100, ci: 1.96 * sd / Math.sqrt(n) * 100, sd }; };
const tops = { A: {}, B: {}, byFmt: { n: { A: {}, B: {} }, k: { A: {}, B: {} }, m: { A: {}, B: {} } } };
const FO = { n: 6, k: 12, m: 18 };
const pairs = []; // (винрейт A, винрейт B) у регов с достаточной выборкой — повторяемость
let regs = 0, enough = 0;
for (const p of players) {
  const c = CL[p.k]; if (!c) continue;
  const isReg = CLU.GROUP[c[0]] === 'reg';
  const a = wr(p.r, 0), b = wr(p.r, 1);
  if (isReg) regs++;
  if (!a || !b) continue;
  if (a.n >= MIN_HANDS / 2 && b.n >= MIN_HANDS / 2) pairs.push([a.bb100, b.bb100, isReg]);
  if (!isReg || p.n < MIN_HANDS) continue;
  enough++;
  if (a.bb100 > MIN_BB100) tops.A[p.k] = { cl: c[0], bb100: Math.round(a.bb100 * 10) / 10, ci: Math.round(a.ci * 10) / 10, n: a.n };
  if (b.bb100 > MIN_BB100) tops.B[p.k] = { cl: c[0], bb100: Math.round(b.bb100 * 10) / 10, ci: Math.round(b.ci * 10) / 10, n: b.n };
}
// топы по формату (фризаут / PKO / Mystery): рег + ≥ MIN_HANDS рук в этом формате + винрейт в этом формате > 0 на половине отбора.
// Если в формате топов мало, модель (passV8) берёт общих топов.
for (const p of players) {
  const c = CL[p.k]; if (!c || CLU.GROUP[c[0]] !== 'reg' || !p.r || p.r.length < 24) continue;
  for (const f of ['n', 'k', 'm']) {
    const a = wr(p.r, 0, FO[f]), b = wr(p.r, 1, FO[f]); if (!a || !b || a.n + b.n < MIN_HANDS) continue;
    if (a.bb100 > MIN_BB100) tops.byFmt[f].A[p.k] = { cl: c[0], bb100: Math.round(a.bb100 * 10) / 10, n: a.n };
    if (b.bb100 > MIN_BB100) tops.byFmt[f].B[p.k] = { cl: c[0], bb100: Math.round(b.bb100 * 10) / 10, n: b.n };
  }
}
// повторяемость винрейта: корреляция A↔B и доля отобранных по A, у кого и на B винрейт > 0
const corr = (xs) => { const n = xs.length; if (n < 3) return null; const mx = xs.reduce((s, x) => s + x[0], 0) / n, my = xs.reduce((s, x) => s + x[1], 0) / n; let sxy = 0, sxx = 0, syy = 0; for (const [x, y] of xs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
const confirmed = Object.keys(tops.A).filter(k => { const p = players.find(q => q.k === k); const b = wr(p.r, 1); return b && b.bb100 > 0; }).length;
const ciTypical = (() => { const v = players.map(p => wr(p.r, 0)).filter(x => x && x.n >= MIN_HANDS / 2 && x.n <= MIN_HANDS); return v.length ? Math.round(v.reduce((s, x) => s + x.ci, 0) / v.length) : null; })();
const report = {
  minHands: MIN_HANDS, regs, regsEnoughHands: enough, topsA: Object.keys(tops.A).length, topsB: Object.keys(tops.B).length,
  confirmedOnB: confirmed, winrateCorrAB_all: corr(pairs) && Math.round(corr(pairs) * 100) / 100, pairs: pairs.length,
  typicalCI_bb100_at_1500_hands: ciTypical,
  byFmt: Object.fromEntries(Object.entries(tops.byFmt).map(([f, t]) => [f, { A: Object.keys(t.A).length, B: Object.keys(t.B).length }]))
};
fs.writeFileSync(path.join(OUT, 'tops_v8.json'), JSON.stringify(tops));
fs.writeFileSync(path.join(OUT, 'tops_report.json'), JSON.stringify(report, null, 1));
console.log(report);
