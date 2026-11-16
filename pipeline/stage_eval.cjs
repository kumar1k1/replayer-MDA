'use strict';
// План C8: насколько точно стадию можно ОЦЕНИТЬ без мест вылета. На турнирах PokerStars, где места известны,
// «прячем» их: оцениваем по стартовому стеку и среднему стеку по столам (lib/stage.js estimate) и сравниваем с правдой.
// Плюс полнота CoinPoker: сколько турниров со стартовым стеком и сколько столов видно одновременно.
//   OUT_DIR=… node pipeline/stage_eval.cjs   → out/stage_eval.json
const fs = require('fs'), path = require('path');
const OUT = process.env.OUT_DIR || path.join(__dirname, 'out');
const STG = require('../lib/stage.js');
const TO = JSON.parse(fs.readFileSync(path.join(OUT, 'tourn_v8.json'), 'utf8'));
const ST = ['early', 'mid', 'late', 'ft'];
const conf = {}; ST.forEach(a => { conf[a] = {}; ST.forEach(b => { conf[a][b] = 0; }); });
let n = 0, ok = 0, near = 0, errR = [], used = 0;
const perT = [];
for (const [k, T] of Object.entries(TO)) {
  if (!k.startsWith('ps:') || !T.ev.length || !T.S || T.N < 20) continue;
  used++; let tn = 0, tok = 0;
  for (const [b, avg, tables] of T.bk) {
    const t = b * STG.BUCKET + STG.BUCKET / 2;
    const R = STG.remaining(T, t); if (R == null) continue;
    const truth = STG.classify(R, T.N, T.Pb, 9);
    const e = STG.estimate({ S: T.S, bk: [[b, avg, tables]] }, t); if (!e || !truth) continue;
    // оценка — как для рума без мест: доля оставшихся по стеку; призовых — 15% поля; финалка — один стол
    let est = STG.classify(Math.round(e.r * 1000), 1000, 0, 9); if (tables === 1 && est !== 'early') est = 'ft';
    conf[truth][est]++; n++; tn++;
    if (truth === est) { ok++; tok++; }
    if (Math.abs(ST.indexOf(truth) - ST.indexOf(est)) <= 1) near++;
    errR.push(Math.abs(e.r - R / T.N));
  }
  if (tn) perT.push(tok / tn);
}
errR.sort((a, b) => a - b);
// калибровка: поздняя регистрация и ре-энтри добавляют фишки — «стартовый / средний» занижает долю оставшихся.
// Учимся на половине турниров (r оценки → средняя истинная r по корзинам, плюс уровень блайндов), проверяем на другой.
const hashT = (k) => { let h = 2166136261; for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h & 1; };
const NB = 20, sum = new Float64Array(NB * 4), cnt = new Float64Array(NB * 4);
const rows = [];
for (const [k, T] of Object.entries(TO)) {
  if (!k.startsWith('ps:') || !T.ev.length || !T.S || T.N < 20) continue;
  const t0 = T.bk.length ? T.bk[0][0] : 0;
  for (const [b, avg, tables] of T.bk) {
    const t = b * STG.BUCKET + STG.BUCKET / 2, R = STG.remaining(T, t); if (R == null) continue;
    const re = Math.min(1, T.S / avg), hrs = Math.min(3, Math.floor((b - t0) * STG.BUCKET / 3600)); // часы от начала (0..3+)
    rows.push({ half: hashT(k), re, rt: R / T.N, R, T, tables, hrs });
  }
}
const bin = (x) => Math.min(NB - 1, Math.floor(x * NB));
for (const r of rows) if (r.half === 0) { const i = bin(r.re) * 4 + r.hrs; sum[i] += r.rt; cnt[i]++; }
let cOk = 0, cN = 0, cNear = 0; const cErr = [];
for (const r of rows) if (r.half === 1) {
  const i = bin(r.re) * 4 + r.hrs, rc = cnt[i] >= 20 ? sum[i] / cnt[i] : r.re;
  const truth = STG.classify(r.R, r.T.N, r.T.Pb, 9);
  let est = STG.classify(Math.round(rc * 1000), 1000, 0, 9); if (r.tables === 1 && est !== 'early') est = 'ft';
  cN++; if (est === truth) cOk++; if (Math.abs(ST.indexOf(truth) - ST.indexOf(est)) <= 1) cNear++; cErr.push(Math.abs(rc - r.rt));
}
cErr.sort((a, b) => a - b);
const cq = (p) => cErr.length ? Math.round(cErr[Math.floor(p * (cErr.length - 1))] * 1000) / 10 : null;
const calib = { buckets: cN, stageAccuracy: Math.round(cOk / cN * 1000) / 10, stageWithinOne: Math.round(cNear / cN * 1000) / 10, remainingShareError_pp: { p50: cq(0.5), p80: cq(0.8), p95: cq(0.95) },
  table: Array.from({ length: NB * 4 }, (_, i) => (cnt[i] >= 20 ? Math.round(sum[i] / cnt[i] * 1000) / 1000 : null)) };
const q = (p) => errR.length ? Math.round(errR[Math.floor(p * (errR.length - 1))] * 1000) / 10 : null;
// CoinPoker: полнота
const coin = Object.entries(TO).filter(([k]) => k.startsWith('coin:')).map(([, T]) => T);
const cRep = { tournaments: coin.length, withStartStack: coin.filter(T => T.S).length, withPlaces: coin.filter(T => T.ev.length).length,
  medianMaxTables: (() => { const v = coin.map(T => Math.max(0, ...T.bk.map(x => x[2]))).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] || 0; })() };
const rep = {
  psTournaments: used, buckets: n,
  stageAccuracy: n ? Math.round(ok / n * 1000) / 10 : null,
  stageWithinOne: n ? Math.round(near / n * 1000) / 10 : null,
  remainingShareError_pp: { p50: q(0.5), p80: q(0.8), p95: q(0.95) },
  confusion_truth_to_estimate: conf,
  calibrated_on_other_half: { buckets: calib.buckets, stageAccuracy: calib.stageAccuracy, stageWithinOne: calib.stageWithinOne, remainingShareError_pp: calib.remainingShareError_pp },
  coin: cRep
};
rep.calibTable = calib.table;
fs.writeFileSync(path.join(OUT, 'stage_eval.json'), JSON.stringify(rep, null, 1));
// калибровка для оценки стадии там, где мест нет (реплеер: турнир игрока до пузыря) → data/stage_calib.json
fs.writeFileSync(path.join(__dirname, '..', 'data', 'stage_calib.json'), JSON.stringify({ built: new Date().toISOString().slice(0, 10), NB, table: calib.table, check: rep.calibrated_on_other_half }));
console.log(JSON.stringify(rep, null, 1));
