'use strict';
// ============================================================================
// П.4 КЛАСТЕРЫ ИГРОКОВ (по выходу passStats: players_v8.ndjson + pool_v8.json).
//  1. Поправка 6-max: статы со столов short переводятся на шкалу full по среднему и σ пулов (игроки с достаточной
//     выборкой): x_full = m_full + (x_short − m_short)·σ_full/σ_short; затем объединяются с full по числу возможностей.
//  2. Малые выборки стягиваются к среднему пула (эмпирический Байес, бета-биномиальная модель: сила априора k по статy
//     оценивается по разбросу между игроками) — 200 рук не дают случайный тип.
//  3. Кластер — ближайший из 20 по формуле тренера (lib/clusters.js); «чистота» — расстояние; второй по близости.
//  4. Надёжность: тип считается отдельно по половинам базы A и B; доля совпадений по числу рук → порог.
//  5. Одинаковые ники в разных румах объединяются, только если у обоих ≥ MERGE_MIN рук и все 11 статов совпадают
//     в пределах шума (|z| < 3 по каждому) и кластеры совпадают или соседние.
// Выход: out/players_cl_v8.json { "рум:ник": [кластер, расстояние, второй, расст.2, рук, надёжен 0/1] }, out/clusters_report.json
//   OUT_DIR=… node pipeline/clusters.cjs
// ============================================================================
const fs = require('fs'), path = require('path');
const OUT = process.env.OUT_DIR || path.join(__dirname, 'out');
const ST = require('../lib/stats.js'), CLU = require('../lib/clusters.js');
const MODEL = require('../data/clusters_v2.json');
const K = CLU.create(MODEL);
const NCL = ST.CL.length;
const MERGE_MIN = +(process.env.MERGE_MIN || 500);
const pool = JSON.parse(fs.readFileSync(path.join(OUT, 'pool_v8.json'), 'utf8'));
// построчно: на полной базе файл больше предела строки Node (512 МБ)
const players = []; require('./common.cjs').ndForEachSync(path.join(OUT, 'players_v8.ndjson'), (r) => players.push(r));
// счётчики статов кластера игрока: [половина][формат][стат] → [возможности, попадания]
const cnt = (p, h, f, s) => { const o = ((h * 2 + f) * NCL + s) * 2; return [p.cl[o], p.cl[o + 1]]; };
const sumH = (p, f, s, halves) => { let a = 0, b = 0; for (const h of halves) { const [o, x] = cnt(p, h, f, s); a += o; b += x; } return [a, b]; };

// ---------- 1. средние и σ пулов по формату (игроки с ≥ MINOPP возможностей) ----------
const MINOPP = [300, 300, 300, 150, 40, 80, 80, 80, 80, 40, 30];
const fmtStats = [0, 1].map(f => ST.CL.map((_, s) => {
  const v = []; for (const p of players) { const [o, x] = sumH(p, f, s, [0, 1]); if (o >= MINOPP[s]) v.push(x / o * 100); }
  const m = v.reduce((a, b) => a + b, 0) / (v.length || 1); const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1));
  return { m, sd, n: v.length };
}));
const toFull = (s, x) => { const S = fmtStats[0][s], F = fmtStats[1][s]; if (S.n < 30 || F.n < 30 || !S.sd) return x; return F.m + (x - S.m) * F.sd / S.sd; };

// ---------- 2. эмпирический Байес: априорное среднее и сила k по статy (на шкале full) ----------
function rawFull(p, s, halves) { // объединённые возможности и «попадания» на шкале full
  const [oF, xF] = sumH(p, 1, s, halves), [oS, xS] = sumH(p, 0, s, halves);
  let hits = xF, opp = oF;
  if (oS > 0) { const r = Math.min(100, Math.max(0, toFull(s, xS / oS * 100))); hits += r / 100 * oS; opp += oS; }
  return [opp, hits];
}
const prior = ST.CL.map((_, s) => {
  const rs = []; let O = 0, H = 0, noise = 0;
  for (const p of players) { const [o, x] = rawFull(p, s, [0, 1]); O += o; H += x; if (o >= 200) { const r = x / o; rs.push([r, o]); } }
  const m = H / (O || 1);
  const vObs = rs.reduce((a, [r]) => a + (r - m) ** 2, 0) / Math.max(1, rs.length - 1);
  for (const [r, o] of rs) noise += m * (1 - m) / o; noise /= Math.max(1, rs.length);
  const tau2 = Math.max(1e-5, vObs - noise);
  const k = Math.max(5, Math.min(2000, m * (1 - m) / tau2 - 1));
  return { m, k, players: rs.length };
});
function ratesOf(p, halves) {
  return ST.CL.map((_, s) => { const [o, x] = rawFull(p, s, halves); return (x + prior[s].k * prior[s].m) / (o + prior[s].k) * 100; });
}
const handsOf = (p) => p.n;
const halfHands = (p, h) => { const [o] = sumH(p, 0, 0, [h]), [o2] = sumH(p, 1, 0, [h]); return o + o2; }; // ≈ раздачи с ходом на префлопе

// ---------- 3. кластеры всех игроков ----------
const out = {}, byKey = new Map();
for (const p of players) {
  const r = K.classify(ratesOf(p, [0, 1]));
  byKey.set(p.k, { p, r });
  out[p.k] = [r.cl, Math.round(r.d), r.cl2, Math.round(r.d2), p.n, 0];
}

// ---------- 4. надёжность: совпадение кластера на половинах A и B ----------
const BINS = [[50, 200], [200, 500], [500, 1000], [1000, 2000], [2000, 5000], [5000, 1e12]];
const agree = BINS.map(([lo, hi]) => ({ lo, hi, n: 0, same: 0, near: 0, sameGroup: 0 }));
for (const { p } of byKey.values()) {
  const nA = halfHands(p, 0), nB = halfHands(p, 1), m = Math.min(nA, nB);
  const b = agree.find(x => m >= x.lo && m < x.hi); if (!b) continue;
  const a = K.classify(ratesOf(p, [0])), c = K.classify(ratesOf(p, [1]));
  b.n++; if (a.cl === c.cl) b.same++; if (a.cl === c.cl || a.cl2 === c.cl || c.cl2 === a.cl) b.near++; if (CLU.GROUP[a.cl] === CLU.GROUP[c.cl]) b.sameGroup++;
}
// Порог: наименьший банд (по рукам в КАЖДОЙ половине), с которого тип совпадает с точностью до соседнего кластера
// ≥ AGREE_NEAR (по умолчанию 88%). Точное совпадение одного из 20 кластеров на реальных данных не достигает 80% даже
// на тысячах рук: кластеры регов (0/3/5/8/10) близки между собой — это свойство модели тренера («восьмёрка, переходящая
// в тройку»). Поэтому в реплеере показываются кластер, ближайший сосед и расстояние. Надёжность по всем рукам = 2× порога.
const AGREE_NEAR = +(process.env.AGREE_NEAR || 0.88);
const thrBin = agree.find(b => b.n >= 30 && b.near / b.n >= AGREE_NEAR);
const RELIABLE_HANDS = thrBin ? thrBin.lo * 2 : null;
for (const k in out) if (RELIABLE_HANDS && out[k][4] >= RELIABLE_HANDS) out[k][5] = 1;

// ---------- 5. 6-max: доли кластеров у игроков только short и только full — до и после поправки ----------
function distrib(filter, useFix) {
  const d = new Array(20).fill(0); let n = 0;
  for (const { p } of byKey.values()) {
    if (!filter(p) || p.n < 500) continue;
    const rates = useFix ? ratesOf(p, [0, 1]) : ST.CL.map((_, s) => { const [oF, xF] = sumH(p, 1, s, [0, 1]), [oS, xS] = sumH(p, 0, s, [0, 1]); const o = oF + oS, x = xF + xS; return (x + prior[s].k * prior[s].m) / (o + prior[s].k) * 100; });
    d[K.classify(rates).cl]++; n++;
  }
  return { n, share: d.map(v => n ? Math.round(v / n * 1000) / 10 : 0) };
}
const shortOnly = (p) => p.ns >= 0.9 * p.n, fullOnly = (p) => p.nf >= 0.9 * p.n;
const sixmax = { full: distrib(fullOnly, true), shortRaw: distrib(shortOnly, false), shortFixed: distrib(shortOnly, true) };

// ---------- 6. одинаковые ники в разных румах ----------
const byNick = new Map();
for (const k of byKey.keys()) { const i = k.indexOf(':'), nk = k.slice(i + 1); if (!byNick.has(nk)) byNick.set(nk, []); byNick.get(nk).push(k); }
const merges = [], notMerged = [];
for (const [nk, keys] of byNick) {
  if (keys.length < 2) continue;
  const [k1, k2] = keys, A = byKey.get(k1), B = byKey.get(k2);
  if (A.p.n < MERGE_MIN || B.p.n < MERGE_MIN) { notMerged.push({ nick: nk, why: 'мало рук', n: [A.p.n, B.p.n] }); continue; }
  let maxZ = 0, worst = '';
  for (let s = 0; s < NCL; s++) {
    const [o1, x1] = rawFull(A.p, s, [0, 1]), [o2, x2] = rawFull(B.p, s, [0, 1]);
    if (o1 < 20 || o2 < 20) continue;
    const r1 = x1 / o1, r2 = x2 / o2, pr = (x1 + x2) / (o1 + o2), se = Math.sqrt(Math.max(1e-9, pr * (1 - pr) * (1 / o1 + 1 / o2)));
    const z = Math.abs(r1 - r2) / se; if (z > maxZ) { maxZ = z; worst = ST.CL[s]; }
  }
  const near = A.r.cl === B.r.cl || A.r.cl2 === B.r.cl || B.r.cl2 === A.r.cl;
  const rec = { nick: nk, n: [A.p.n, B.p.n], cl: [A.r.cl, B.r.cl], maxZ: Math.round(maxZ * 10) / 10, worst };
  if (maxZ < 3 && near) { merges.push(rec); out[k1].push(k2); out[k2].push(k1); } else notMerged.push(Object.assign(rec, { why: maxZ >= 3 ? 'статы различаются' : 'разные кластеры' }));
}

// ---------- 7. «плотные» члены кластера и одинаковость кластеров в разных румах (владелец, 20.11.2026) ----------
// Идея: не делить данные по румам, а брать один и тот же кластер со всех румов — но только игроков, которые ему
// подходят чётко. Плотный = надёжный (рук ≥ порога) + расстояние до своего кластера не больше 75-го перцентиля
// расстояний в этом кластере + до второго кластера заметно дальше (d2 ≥ TIGHT_GAP × d).
// Отчёт: по каждому кластеру и руму — сколько игроков и плотных, медиана расстояния и средние 11 статов плотных
// игроков рума против всех румов (в долях разброса): если румы близки — кластер можно брать со всех румов вместе.
const TIGHT_GAP = +(process.env.TIGHT_GAP || 1.15), TIGHT_Q = +(process.env.TIGHT_Q || 0.75);
const dq = {}; for (const k in out) if (out[k][5]) (dq[out[k][0]] = dq[out[k][0]] || []).push(out[k][1]);
const dLim = {}; for (const c in dq) { const v = dq[c].sort((a, b) => a - b); dLim[c] = v[Math.min(v.length - 1, Math.floor(v.length * TIGHT_Q))]; }
const tight = {}; for (const k in out) { const o = out[k]; if (o[5] && o[1] <= dLim[o[0]] && o[3] >= TIGHT_GAP * o[1]) tight[k] = 1; }
fs.writeFileSync(path.join(OUT, 'players_tight.json'), JSON.stringify(tight));
const roomOfK = (k) => k.slice(0, k.indexOf(':'));
const prof = {}; // кластер → рум → {n, tight, d[], sum[11], sq[11]}
for (const [k, { p, r }] of byKey) {
  const o = out[k]; if (!o[5]) continue;
  const rm = roomOfK(k), P = (prof[r.cl] = prof[r.cl] || {}), x = P[rm] = P[rm] || { n: 0, t: 0, d: [], sum: new Array(NCL).fill(0), sq: new Array(NCL).fill(0) };
  const all = P['*'] = P['*'] || { n: 0, t: 0, d: [], sum: new Array(NCL).fill(0), sq: new Array(NCL).fill(0) };
  for (const z of [x, all]) { z.n++; z.d.push(o[1]); }
  if (!tight[k]) continue;
  const rt = ratesOf(p, [0, 1]);
  for (const z of [x, all]) { z.t++; for (let s = 0; s < NCL; s++) { z.sum[s] += rt[s]; z.sq[s] += rt[s] * rt[s]; } }
}
const med = (v) => { const a = v.slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
const roomsReport = [];
for (const c in prof) {
  const A = prof[c]['*']; if (!A || A.t < 20) continue;
  const mA = A.sum.map(v => v / A.t), sdA = A.sq.map((v, s) => Math.sqrt(Math.max(1e-9, v / A.t - mA[s] ** 2)));
  for (const rm in prof[c]) {
    if (rm === '*') continue; const x = prof[c][rm];
    const row = { кластер: +c, группа: CLU.GROUP[c], рум: rm, надёжных: x.n, плотных: x.t, медиана_расстояния: med(x.d) };
    if (x.t >= 20) { const dev = x.sum.map((v, s) => (v / x.t - mA[s]) / sdA[s]); const w = dev.reduce((b, v, s) => (Math.abs(v) > Math.abs(dev[b]) ? s : b), 0); row.макс_отклонение_sd = Math.round(dev[w] * 100) / 100; row.стат = ST.CL[w]; row.среднее_отклонение_sd = Math.round(dev.reduce((a, v) => a + Math.abs(v), 0) / NCL * 100) / 100; }
    roomsReport.push(row);
  }
}
roomsReport.sort((a, b) => a.кластер - b.кластер || b.плотных - a.плотных);

// ---------- выгрузка и отчёт ----------
fs.writeFileSync(path.join(OUT, 'players_cl_v8.json'), JSON.stringify(out));
const distAll = new Array(20).fill(0); let nRel = 0;
for (const k in out) { if (out[k][5]) { distAll[out[k][0]]++; nRel++; } }
const report = {
  players: players.length, reliableHands: RELIABLE_HANDS, reliablePlayers: nRel,
  prior: prior.map((x, s) => ({ stat: ST.CL[s], mean: Math.round(x.m * 1000) / 10, k: Math.round(x.k) })),
  fmtStats: fmtStats.map((F, f) => F.map((x, s) => ({ fmt: f ? 'full' : 'short', stat: ST.CL[s], m: Math.round(x.m * 10) / 10, sd: Math.round(x.sd * 10) / 10, n: x.n }))),
  agreement: agree.map(b => ({ hands_each_half: b.lo + '–' + (b.hi > 1e11 ? '∞' : b.hi), players: b.n, same: b.n ? Math.round(b.same / b.n * 1000) / 10 : null, sameOrNeighbor: b.n ? Math.round(b.near / b.n * 1000) / 10 : null, sameGroup: b.n ? Math.round(b.sameGroup / b.n * 1000) / 10 : null })),
  sixmax, merges: merges.length, mergeExamples: merges.slice(0, 15), notMerged: notMerged.length, notMergedExamples: notMerged.filter(x => x.why !== 'мало рук').slice(0, 15),
  tight: { gap: TIGHT_GAP, q: TIGHT_Q, players: Object.keys(tight).length, dLimit: dLim }, clustersByRoom: roomsReport,
  distributionReliable: distAll.map((v, c) => ({ cl: c, group: CLU.GROUP[c], share: nRel ? Math.round(v / nRel * 1000) / 10 : 0 }))
};
fs.writeFileSync(path.join(OUT, 'clusters_report.json'), JSON.stringify(report, null, 1));
console.log('игроков', players.length, '| порог надёжности:', RELIABLE_HANDS, 'рук | надёжных', nRel, '| объединено ников', merges.length);
console.table(report.agreement);
console.table(report.prior);
