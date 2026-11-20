'use strict';
// ============================================================================
// ОТБОР ТОПОВ ПО ЧЕТВЕРТЯМ БАЗЫ (решение владельца 19.11.2026)
//  Топ-1: рег-кластер + ≥ 10 000 рук в базе + винрейт ≥ 8 bb/100 в ОБЕИХ четвертях половины отбора.
//  Топ-2 (запас, если у топов-1 в споте мало рук): то же, но винрейт ≥ 5 bb/100 в обеих четвертях (включает топов-1).
//  Отобранные по половине A (четверти A1, A2) меряют раздачи половины B, и наоборот: винрейт подтверждён на двух
//  разных частях базы, а игра меряется на третьей, в отбор не входившей, — удача отбора в модель не попадает.
//  По формату (фризаут / PKO / Mystery) — то же правило на результатах в этом формате (рук в формате ≥ MIN_HANDS_FMT).
// Вход: out/winq.json (pipeline/winq.cjs), players_cl_all.json. Выход: out/tops_all.json, out/tops_report.json
// ============================================================================
const fs = require('fs'), path = require('path');
const CLU = require('../lib/clusters.js');
const OUT = process.env.OUT_DIR || path.join(__dirname, 'out');
const MIN_HANDS = +(process.env.MIN_HANDS_TOP || 10000), T1 = +(process.env.TOP1_BB100 || 8), T2 = +(process.env.TOP2_BB100 || 5);
const MIN_HANDS_FMT = +(process.env.MIN_HANDS_FMT || 3000);
const W = JSON.parse(fs.readFileSync(path.join(OUT, 'winq.json'), 'utf8'));
const CL = JSON.parse(fs.readFileSync(process.env.PLAYERS_CL || path.join(OUT, 'players_cl_all.json'), 'utf8'));
const wr = (a, o) => (a[o] > 0 ? a[o + 1] / a[o] * 100 : null);   // bb/100 в блоке (n, Σ, Σ²)
const empty = () => ({ A: {}, B: {}, A5: {}, B5: {} });
const tops = Object.assign({ rule: { minHands: MIN_HANDS, top1: T1, top2: T2, by: 'quarters', built: new Date().toISOString() } }, empty(), { byFmt: { n: empty(), k: empty(), m: empty() } });
const FB = { all: 0, n: 12, k: 24, m: 36 };
function pick(dst, k, a, base, cl, nAll) {
  for (const [H, q0] of [['A', 0], ['B', 2]]) {
    const w1 = wr(a, base + q0 * 3), w2 = wr(a, base + (q0 + 1) * 3); if (w1 == null || w2 == null) continue;
    const rec = { cl, n: nAll, wr: [Math.round(w1 * 10) / 10, Math.round(w2 * 10) / 10] };
    if (w1 >= T2 && w2 >= T2) dst[H + '5'][k] = rec;
    if (w1 >= T1 && w2 >= T1) dst[H][k] = rec;
  }
}
let regsBig = 0;
for (const k in W) {
  const c = CL[k]; if (!c || CLU.GROUP[c[0]] !== 'reg' || c[4] < MIN_HANDS) continue;
  regsBig++; const a = W[k];
  pick(tops, k, a, FB.all, c[0], c[4]);
  for (const f of ['n', 'k', 'm']) { const nf = a[FB[f]] + a[FB[f] + 3] + a[FB[f] + 6] + a[FB[f] + 9]; if (nf >= MIN_HANDS_FMT) pick(tops.byFmt[f], k, a, FB[f], c[0], nf); }
}
// ---- по лимитам (владелец, 20.11.2026): хороший винрейт зависит от бай-ина — на $5 средний рег ~10 bb/100, топы ~15;
// на $50–100 хороший — от 8; на $250+ — от 5. Топ лимита: ≥ MIN_HANDS рук всего, ≥ MIN_HANDS_ST рук на этом лимите и
// винрейт на нём в обеих четвертях половины отбора ≥ порога лимита. Вход: out/winq_st.json (pipeline/stages.cjs).
const STS = ['b20', 'b50', 'b100', 'b250', 'b250p'], ST_RU = { b20: 'до $20', b50: '$20–50', b100: '$50–100', b250: '$100–250', b250p: 'от $250' };
const envT = (n, d) => (process.env[n] || d).split(',').map(Number);
const T1S = envT('TOP1_ST', '12,10,8,6,5'), T2S = envT('TOP2_ST', '8,6,5,4,3'), MIN_HANDS_ST = +(process.env.MIN_HANDS_ST || 5000);
const WSf = path.join(OUT, 'winq_st.json'), WS = fs.existsSync(WSf) ? JSON.parse(fs.readFileSync(WSf, 'utf8')) : null;
if (WS) {
  tops.bySt = {}; tops.rule.bySt = { top1: T1S, top2: T2S, minHandsSt: MIN_HANDS_ST };
  STS.forEach((st, si) => {
    const D = tops.bySt[st] = empty();
    for (const k in WS) {
      const c = CL[k]; if (!c || CLU.GROUP[c[0]] !== 'reg' || c[4] < MIN_HANDS) continue;
      const a = WS[k], o = si * 12, ns = a[o] + a[o + 3] + a[o + 6] + a[o + 9]; if (ns < MIN_HANDS_ST) continue;
      for (const [H, q0] of [['A', 0], ['B', 2]]) {
        const w1 = wr(a, o + q0 * 3), w2 = wr(a, o + (q0 + 1) * 3); if (w1 == null || w2 == null) continue;
        const rec = { cl: c[0], n: ns, wr: [Math.round(w1 * 10) / 10, Math.round(w2 * 10) / 10] };
        if (w1 >= T2S[si] && w2 >= T2S[si]) D[H + '5'][k] = rec;
        if (w1 >= T1S[si] && w2 >= T1S[si]) D[H][k] = rec;
      }
    }
  });
}
const byRoom = (o) => { const r = {}; for (const k in o) { const m = k.split(':')[0]; r[m] = (r[m] || 0) + 1; } return r; };
const sumN = (o) => Object.values(o).reduce((s, x) => s + x.n, 0);
const both = (X, Y) => Object.keys(X).filter(k => Y[k]).length;
const rep = {
  правило: tops.rule, регов_с_выборкой: regsBig,
  топ1_A: byRoom(tops.A), топ1_B: byRoom(tops.B), топ2_A: byRoom(tops.A5), топ2_B: byRoom(tops.B5),
  топ1_всего: { A: Object.keys(tops.A).length, B: Object.keys(tops.B).length, рук_A: sumN(tops.A), рук_B: sumN(tops.B) },
  топ2_всего: { A: Object.keys(tops.A5).length, B: Object.keys(tops.B5).length, рук_A: sumN(tops.A5), рук_B: sumN(tops.B5) },
  топ1_в_обеих_половинах: both(tops.A, tops.B),
  по_формату: Object.fromEntries(['n', 'k', 'm'].map(f => [f, { топ1: [Object.keys(tops.byFmt[f].A).length, Object.keys(tops.byFmt[f].B).length], топ2: [Object.keys(tops.byFmt[f].A5).length, Object.keys(tops.byFmt[f].B5).length] }]))
};
// сетка для выбора порогов владельцем: минимум рук × порог винрейта (в обеих четвертях половины A) → игроков и их рук
const grid = [];
for (const mh of [5000, 10000, 20000, 30000]) for (const th of [3, 5, 8, 10]) {
  let n = 0, h = 0; const r = {};
  for (const k in W) { const c = CL[k]; if (!c || CLU.GROUP[c[0]] !== 'reg' || c[4] < mh) continue; const a = W[k], w1 = wr(a, 0), w2 = wr(a, 3); if (w1 == null || w2 == null || w1 < th || w2 < th) continue; n++; h += c[4]; const m = k.split(':')[0]; r[m] = (r[m] || 0) + 1; }
  grid.push({ минимум_рук: mh, винрейт_от: th, игроков: n, их_рук: h, по_румам: r });
}
rep.сетка_порогов = grid;
if (WS) {
  rep.по_лимитам = Object.fromEntries(STS.map(st => [ST_RU[st], { порог_топ1: T1S[STS.indexOf(st)], порог_топ2: T2S[STS.indexOf(st)], топ1: [Object.keys(tops.bySt[st].A).length, Object.keys(tops.bySt[st].B).length], топ2: [Object.keys(tops.bySt[st].A5).length, Object.keys(tops.bySt[st].B5).length], рук_топ1_A: sumN(tops.bySt[st].A) }]));
  // сетка по лимитам: минимум рук на лимите × порог → игроков и их рук на этом лимите (половина A)
  const gs = [];
  STS.forEach((st, si) => { for (const mh of [3000, 5000, 10000]) for (const th of [3, 5, 8, 10, 12, 15, 20]) {
    let n = 0, h = 0;
    for (const k in WS) { const c = CL[k]; if (!c || CLU.GROUP[c[0]] !== 'reg' || c[4] < MIN_HANDS) continue; const a = WS[k], o = si * 12, ns = a[o] + a[o + 3] + a[o + 6] + a[o + 9]; if (ns < mh) continue; const w1 = wr(a, o), w2 = wr(a, o + 3); if (w1 == null || w2 == null || w1 < th || w2 < th) continue; n++; h += ns; }
    gs.push({ лимит: ST_RU[st], минимум_рук_на_лимите: mh, винрейт_от: th, игроков: n, их_рук_на_лимите: h });
  } });
  rep.сетка_по_лимитам = gs;
}
if (process.env.REPORT_ONLY === '1') { fs.writeFileSync(path.join(OUT, 'топы_сетка.json'), JSON.stringify(rep, null, 1)); console.log(JSON.stringify(rep, null, 1)); process.exit(0); }
const dst = path.join(OUT, 'tops_all.json');
if (fs.existsSync(dst)) { const bak = path.join(OUT, 'tops_all_до_8_5.json'); if (!fs.existsSync(bak)) fs.copyFileSync(dst, bak); }
fs.writeFileSync(dst, JSON.stringify(tops));
fs.writeFileSync(path.join(OUT, 'tops_report.json'), JSON.stringify(rep, null, 1));
console.log(JSON.stringify(rep, null, 1));
