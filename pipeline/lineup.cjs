'use strict';
// ============================================================================
// П.7 ЛАЙНАП: модель ответов игроков за спиной и её калибровка.
//  Этап 1 (без раздач): по счётчикам players_v8.ndjson и кластерам players_cl_v8.json — суммы пула и кластеров,
//    подбор силы стягивания Kc (кластер → пул) и Kp (игрок → кластер) по точному leave-one-out log-loss
//    (каждое наблюдение предсказывается без самого себя).
//  Этап 2 (проход по раздачам): каждый опен (не олл-ин) и каждый пуш первым — прогноз P(фолд) каждого игрока
//    за спиной (тоже без текущей раздачи в его счётчиках) и P(все сфолдят) = Π. Поправка на контекст (позиция
//    открывшего, корзина размера) оценивается на половине A, качество — на половине B.
// Выход: data/lineup_v8.json {pool, cl, K, adj}, out/lineup_report.json
//   OUT_DIR=… node pipeline/lineup.cjs
// ============================================================================
const fs = require('fs'), path = require('path');
const C = require('./common.cjs'), SP = require('../lib/spots.js'), ST = require('../lib/stats.js'), SZ = require('../lib/sizing.js'), LU = require('../lib/lineup.js');
const OUT = C.OUT;
const STG = require('../lib/stage.js');
const TOURN = fs.existsSync(path.join(OUT, 'tourn_v8.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'tourn_v8.json'), 'utf8')) : {};
const STAGE_EST = process.env.STAGE_EST === '1';
const NS = ST.PF_SLOTS;
const players = fs.readFileSync(path.join(OUT, 'players_v8.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
const CLS = JSON.parse(fs.readFileSync(path.join(OUT, 'players_cl_v8.json'), 'utf8'));
const PF = new Map(), CLOF = new Map();
const pool = new Float64Array(NS), cl = {};
for (const p of players) {
  const pf = Int32Array.from(p.pf); PF.set(p.k, pf);
  for (let o = 0; o < NS; o++) pool[o] += pf[o];
  const c = CLS[p.k]; if (!c) continue;
  CLOF.set(p.k, c[0]);
  const s = cl[c[0]] = cl[c[0]] || new Float64Array(NS);
  for (let o = 0; o < NS; o++) s[o] += pf[o];
}
C.log('лайнап: игроков', players.length, 'с кластером', CLOF.size);

// ---------- этап 1: Kc, Kp по точному LOO ----------
const FAMS = Object.keys(LU.FAM);
const BASES = { rfi: [0, 4, 8, 12, 16], vso: [20, 24, 28], sqz: [32], vs3: [35], iso: [39], ai: [43] };
const slotsOf = (fam) => { const r = []; for (let b = 0; b < LU.BANDS.length; b++) for (const o of BASES[fam]) r.push(b * LU.PER_BAND + o); return r; };
const cats = (arr, o, fam) => { const m = LU.FAM[fam].acts.length, x = []; let s = 0; for (let k = 0; k < m; k++) { x.push(arr[o + 1 + k]); s += arr[o + 1 + k]; } x.push(Math.max(0, arr[o] - s)); return x; }; // последняя категория — фолд/прочее
const GRID_C = [5, 20, 50, 100, 200, 500, 2000], GRID_P = [1, 2, 5, 10, 20, 50, 100, 300];
const K = {}, fit = {};
for (const fam of FAMS) {
  const SL = slotsOf(fam);
  const loss = (Kc, Kp, mode) => {
    let L = 0, N = 0;
    for (const p of players) {
      const pf = PF.get(p.k), c = CLOF.get(p.k), sc = c != null ? cl[c] : null;
      for (const o of SL) {
        const n = pf[o]; if (!n) continue;
        const x = cats(pf, o, fam), xp = cats(pool, o, fam), xc = sc ? cats(sc, o, fam) : null;
        for (let a = 0; a < x.length; a++) {
          if (!x[a]) continue;
          // всё — без этого наблюдения
          const qp = (xp[a] - 1 + 0.5) / (pool[o] - 1 + 0.5 * x.length);
          const qc = xc ? (xc[a] - 1 + Kc * qp) / (sc[o] - 1 + Kc) : qp;
          const pr = mode === 'pool' ? qp : mode === 'cl' ? qc : (x[a] - 1 + Kp * qc) / (n - 1 + Kp);
          L -= x[a] * Math.log(Math.max(1e-6, pr)); N += x[a];
        }
      }
    }
    return N ? L / N : 0;
  };
  let best = null;
  for (const Kc of GRID_C) for (const Kp of GRID_P) { const l = loss(Kc, Kp, 'full'); if (!best || l < best.l) best = { Kc, Kp, l }; }
  const lp = loss(0, 0, 'pool');
  let bc = null; for (const Kc of GRID_C) { const l = loss(Kc, 0, 'cl'); if (!bc || l < bc.l) bc = { Kc, l }; }
  K[fam] = { Kc: best.Kc, Kp: best.Kp };
  fit[fam] = { logloss_pool: +lp.toFixed(4), logloss_cluster: +bc.l.toFixed(4), logloss_player: +best.l.toFixed(4), Kc: best.Kc, Kp: best.Kp };
  C.log('лайнап', fam, JSON.stringify(fit[fam]));
}

// ---------- этап 2: проход по раздачам ----------
const P_ = C.loadParser(), { frames } = P_, parse = C.makeParse(P_);
const model0 = LU.create({ pool: Array.from(pool), cl: Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, Array.from(v)])), K });
// записи: по ответчику — опен-id, ключ поправки, три прогноза (пул / кластер / игрок), факт (фолд 1/0, −1 — не дошёл)
let R = { open: [], key: [], skey: [], pP: [], pC: [], pF: [], y: [] };
let O = { half: [], fam: [], y: [], first: [] };
const keyId = new Map(), keys = [];
const kid = (k) => { let v = keyId.get(k); if (v == null) { v = keys.length; keys.push(k); keyId.set(k, v); } return v; };
let seen = new C.IdSet();
let nHands = 0, done = [];
// чекпоинт после каждого архива: массивы — в двоичных файлах (на полной базе десятки миллионов строк)
const CK = path.join(OUT, 'lineup_ck'), IDSF = path.join(OUT, 'lineup_ids.bin');
const TYPES = { open: Int32Array, key: Int32Array, skey: Int32Array, pP: Float64Array, pC: Float64Array, pF: Float64Array, y: Int8Array };
const OTYPES = { half: Int8Array, fam: Int8Array, y: Int8Array };
function saveState() {
  fs.mkdirSync(CK, { recursive: true });
  const wr = (name, T, a) => { const t = T.from(a); fs.writeFileSync(path.join(CK, name + '.tmp'), Buffer.from(t.buffer)); };
  for (const [k, T] of Object.entries(TYPES)) wr('R_' + k, T, R[k]);
  for (const [k, T] of Object.entries(OTYPES)) wr('O_' + k, T, k === 'fam' ? O.fam.map(f => (f === 'ai' ? 1 : 0)) : O[k]);
  fs.writeFileSync(path.join(CK, 'meta.tmp'), JSON.stringify({ keys, nHands, done }));
  for (const f of fs.readdirSync(CK)) if (f.endsWith('.tmp')) fs.renameSync(path.join(CK, f), path.join(CK, f.slice(0, -4)));
  C.saveIds(seen, IDSF);
}
function loadState() {
  const m = JSON.parse(fs.readFileSync(path.join(CK, 'meta'), 'utf8'));
  m.keys.forEach((k, i) => { keys.push(k); keyId.set(k, i); }); nHands = m.nHands; done = m.done;
  const rd = (name, T) => { const b = fs.readFileSync(path.join(CK, name)); return Array.from(new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT)); };
  for (const [k, T] of Object.entries(TYPES)) R[k] = rd('R_' + k, T);
  for (const [k, T] of Object.entries(OTYPES)) O[k] = k === 'fam' ? rd('O_fam', T).map(f => (f ? 'ai' : 'vso')) : rd('O_' + k, T);
  seen = C.loadIds(IDSF);
}
(async () => {
  if (process.env.RESUME === '1' && fs.existsSync(path.join(CK, 'meta')) && fs.existsSync(IDSF)) { loadState(); C.log('лайнап: продолжаю с чекпоинта, архивов', done.length, 'опенов', O.half.length); }
  const part = C.partLimiter();
  for await (const x of C.iterHands(C.sourceFiles(), new Set(done))) {
    if (x.end) { done.push(x.end); saveState(); C.log('лайнап: пройден', x.end, '(чекпоинт)'); if (part.hit()) { C.log('лайнап: часть готова'); process.exit(C.PART_EXIT); } continue; }
    let rp; try { rp = parse(x.hand); } catch (e) { continue; }
    if (!rp || !rp.n || !rp.bb) continue;
    const room = C.roomOf(x.hand);
    if (!seen.add(room, rp.handId)) continue;
    const fr = frames(rp); if (!C.handIntact(rp, fr[fr.length - 1], x.hand)) continue;
    nHands++;
    const ds = SP.preflopDecisions(rp, () => '', true);
    const d0 = ds.find(d => d.act !== 'fold' && d.act !== 'check');
    if (!d0 || d0.tbl !== 'RFI' || d0.pos === 'BB' || !(d0.act === 'shove' || /^open/.test(d0.act)) || d0.aiEff) continue;
    const fam = d0.act === 'shove' ? 'ai' : 'vso';
    const kd = C.kindOf(rp, x.hand, x.fp);
    let stage = null; { const tm = /Tournament #(\d+)/.exec(x.hand), T = tm && TOURN[room + ':' + tm[1]]; const sa = T ? STG.stageAt(T, STG.tsOf(rp.date), rp.n) : null; if (sa && (sa.exact || STAGE_EST)) stage = sa.stage; }
    const ctx = { aggPos: SP.posBand(d0.pos), size: fam === 'ai' ? '*' : d0.sz || '*', fmt: kd };
    const half = C.halfOf(rp.handId) === 'A' ? 0 : 1, id = O.half.length;
    let allFold = 1;
    for (const o of d0.others) {
      const band = SP.bandOf(Math.min(o.behind, d0.behind));
      const key = C.playerKey(room, rp.nm[o.j]), pf = PF.get(key), c = CLOF.get(key);
      const d = ds.find(z => z.i === o.j && z.k > d0.k);
      const faced = d && (fam === 'vso' ? d.tbl === 'VSO' && d.C === 'C0' : d.tbl === 'AI' && d.L === 'R1' && d.C === 'C0');
      let sl = null;
      if (faced && pf) { sl = ST.pfSlots(d, false); if (sl) { pf[sl[0]]--; if (sl[1] >= 0) pf[sl[1]]--; } }
      const pP = model0.prob(fam, band, o.pos, null, null), pC = model0.prob(fam, band, o.pos, null, c), pF = model0.prob(fam, band, o.pos, pf || null, c);
      if (sl) { pf[sl[0]]++; if (sl[1] >= 0) pf[sl[1]]++; }
      if (!pP) continue;
      const y = faced ? (d.act === 'fold' ? 1 : 0) : -1;
      if (d && d.act !== 'fold') allFold = 0;
      R.open.push(id); R.key.push(kid(LU.adjKey(fam, band, o.pos, ctx))); R.skey.push(stage ? kid('S:' + LU.stageKey(fam, o.pos, stage)) : -1); R.pP.push(pP.fold); R.pC.push(pC.fold); R.pF.push(pF.fold); R.y.push(y);
    }
    O.half.push(half); O.fam.push(fam); O.y.push(allFold);
  }
  C.log('лайнап: раздач', nHands, 'опенов/пушей', O.half.length, 'ответчиков', R.y.length);

  // поправка контекста — на половине A: сдвиг логита d, при котором Σ прогнозов = Σ фактов (Ньютон), со стягиванием к 0
  const SHR = 300, adj = {}, byKey = new Map();
  for (let r = 0; r < R.y.length; r++) if (R.y[r] >= 0 && O.half[R.open[r]] === 0) { const k = R.key[r]; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
  for (const [k, rs] of byKey) {
    let d = 0; const Y = rs.reduce((s, r) => s + R.y[r], 0);
    for (let it = 0; it < 30; it++) { let f = 0, g = 0; for (const r of rs) { const p = LU.sig(LU.logit(Math.min(0.999, Math.max(0.001, R.pF[r]))) + d); f += p; g += p * (1 - p); } if (g < 1e-9) break; const st = (f - Y) / g; d -= st; if (Math.abs(st) < 1e-6) break; }
    d *= rs.length / (rs.length + SHR);
    if (Math.abs(d) > 0.01) adj[keys[k]] = Math.round(d * 1000) / 1000;
  }
  const pA0 = (r) => { const d = adj[keys[R.key[r]]] || 0, p = Math.min(0.999, Math.max(0.001, R.pF[r])); return d ? LU.sig(LU.logit(p) + d) : p; };
  // поправка стадии — по остатку после поправки контекста, тоже на половине A
  const adjS = {}, byS = new Map();
  for (let r = 0; r < R.y.length; r++) if (R.y[r] >= 0 && R.skey[r] >= 0 && O.half[R.open[r]] === 0) { const k = R.skey[r]; if (!byS.has(k)) byS.set(k, []); byS.get(k).push(r); }
  for (const [k, rs] of byS) {
    let d = 0; const Y = rs.reduce((s, r) => s + R.y[r], 0);
    for (let it = 0; it < 30; it++) { let f = 0, g = 0; for (const r of rs) { const p = LU.sig(LU.logit(pA0(r)) + d); f += p; g += p * (1 - p); } if (g < 1e-9) break; const st = (f - Y) / g; d -= st; if (Math.abs(st) < 1e-6) break; }
    d *= rs.length / (rs.length + SHR);
    if (Math.abs(d) > 0.01) adjS[keys[k].slice(2)] = Math.round(d * 1000) / 1000;
  }
  const pA = (r) => { const p = pA0(r), s = R.skey[r] >= 0 ? adjS[keys[R.skey[r]].slice(2)] || 0 : 0; return s ? LU.sig(LU.logit(p) + s) : p; };

  // проверка на половине B: P(все сфолдят) — четыре модели
  const MODELS = { pool: (r) => R.pP[r], cluster: (r) => R.pC[r], player: (r) => R.pF[r], player_adj_ctx: pA0, player_adj: pA };
  const rep = { hands: nHands, opens: O.half.length, responders: R.y.length, fit, adjKeys: Object.keys(adj).length, adjStage: adjS, test: {} };
  for (const fam of ['vso', 'ai']) {
    const pred = {}; for (const m in MODELS) pred[m] = new Float64Array(O.half.length).fill(1);
    for (let r = 0; r < R.y.length; r++) { const o = R.open[r]; if (O.fam[o] !== fam || O.half[o] !== 1) continue; for (const m in MODELS) pred[m][o] *= MODELS[m](r); }
    const res = {};
    for (const m in MODELS) {
      let ll = 0, br = 0, n = 0; const bins = Array.from({ length: 10 }, () => [0, 0, 0]);
      for (let o = 0; o < O.half.length; o++) {
        if (O.fam[o] !== fam || O.half[o] !== 1) continue;
        const p = Math.min(0.999, Math.max(0.001, pred[m][o])), y = O.y[o];
        ll -= y ? Math.log(p) : Math.log(1 - p); br += (p - y) ** 2; n++;
        const b = bins[Math.min(9, Math.floor(p * 10))]; b[0]++; b[1] += p; b[2] += y;
      }
      res[m] = { n, logloss: +(ll / n).toFixed(4), brier: +(br / n).toFixed(4), calib: bins.filter(b => b[0] >= 50).map((b, i) => ({ pred: +(b[1] / b[0] * 100).toFixed(1), fact: +(b[2] / b[0] * 100).toFixed(1), n: b[0] })) };
    }
    rep.test[fam] = res;
    // калибровка по каждому ответчику (P(фолд) игрока): пред. vs факт по корзинам
    const bins = Array.from({ length: 10 }, () => [0, 0, 0]);
    for (let r = 0; r < R.y.length; r++) { const o = R.open[r]; if (O.fam[o] !== fam || O.half[o] !== 1 || R.y[r] < 0) continue; const p = pA(r), b = bins[Math.min(9, Math.floor(p * 10))]; b[0]++; b[1] += p; b[2] += R.y[r]; }
    rep.test[fam].responder_calib = bins.filter(b => b[0] >= 50).map(b => ({ pred: +(b[1] / b[0] * 100).toFixed(1), fact: +(b[2] / b[0] * 100).toFixed(1), n: b[0] }));
  }
  const data = { built: new Date().toISOString().slice(0, 10), pool: Array.from(pool), cl: Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, Array.from(v)])), K, adj, adjS };
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'lineup_v8.json'), JSON.stringify(data));
  fs.writeFileSync(path.join(OUT, 'lineup_report.json'), JSON.stringify(rep, null, 1));
  for (const fam in rep.test) for (const m in rep.test[fam]) if (m !== 'responder_calib') C.log('лайнап B', fam, m, 'logloss', rep.test[fam][m].logloss, 'brier', rep.test[fam][m].brier);
})();
