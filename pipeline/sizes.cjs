'use strict';
// П.6. Таблица сайзингов по базе: для пула и для топов (рег-кластер, ≥3000 рук, винрейт > 0; tops_v8.json — A∪B).
// Ключ: room|action|group|side (см. lib/sizing.js). Для каждого ключа: n, мода (шаг 0.05 bb у опена/изо, 0.1 у кратных),
// доля моды, перцентили, доли корзин. Плюс проверка порога «размер ≥ 40% эфф. стека → олл-ин»: как часто топы
// в этих точках действительно пушат, а не рейзят меньше.
// Запуск: TOPS=out/tops_v8.json node pipeline/sizes.cjs   → data/sizes_v8.json, out/sizes_report.json
const fs = require('fs'), path = require('path');
const C = require('./common.cjs'), SP = require('../lib/spots.js'), SZ = require('../lib/sizing.js');
const P_ = C.loadParser(), { frames } = P_, parse = C.makeParse(P_);
const TOPS = process.env.TOPS || path.join(C.OUT, 'tops_v8.json');
let tops = new Set();
let tops5 = new Set(); // топы-2 (≥ 5 bb/100, с топами-1) — запасной слой, если у топов-1 в ключе мало рук
if (fs.existsSync(TOPS)) { const t = JSON.parse(fs.readFileSync(TOPS, 'utf8')); tops = new Set([...Object.keys(t.A || {}), ...Object.keys(t.B || {})]); tops5 = new Set([...Object.keys(t.A5 || {}), ...Object.keys(t.B5 || {})]); }
// топы по лимиту (владелец, 20.11.2026): у каждого бай-ина свой порог винрейта; лимит без своих топов — общие
const topsSt = {};
if (fs.existsSync(TOPS)) { const t = JSON.parse(fs.readFileSync(TOPS, 'utf8')); for (const st in t.bySt || {}) { const b = t.bySt[st]; if (Object.keys(b.A).length >= 30 && Object.keys(b.B).length >= 30) topsSt[st] = { t1: new Set([...Object.keys(b.A), ...Object.keys(b.B)]), t2: new Set([...Object.keys(b.A5 || {}), ...Object.keys(b.B5 || {})]) }; } }
const isT1 = (k, st) => (topsSt[st] ? topsSt[st].t1 : tops).has(k), isT2 = (k, st) => (topsSt[st] ? topsSt[st].t2 : tops5).has(k);
C.log('sizes: топов-1', tops.size, 'топов-2 (с топами-1)', tops5.size, '| по лимитам:', Object.keys(topsSt).join(',') || 'нет');
const STG = require('../lib/stage.js');
// классы игроков (кластеры): размер против рега, нита и фиша считается отдельно
const CLU = require('../lib/clusters.js');
const clFile = process.env.PLAYERS_CL || path.join(C.OUT, 'players_cl_all.json');
const CL = fs.existsSync(clFile) ? JSON.parse(fs.readFileSync(clFile, 'utf8')) : {};
const TIGHT = process.env.TIGHT_FILE && fs.existsSync(process.env.TIGHT_FILE) ? JSON.parse(fs.readFileSync(process.env.TIGHT_FILE, 'utf8')) : null; // см. passV8
C.log('sizes: игроков с классом', Object.keys(CL).length, '(' + path.basename(clFile) + ')');
const tournFile = process.env.TOURN || path.join(C.OUT, 'tourn_v8.json');
const TOURN = fs.existsSync(tournFile) ? JSON.parse(fs.readFileSync(tournFile, 'utf8')) : {};

// гистограммы значений с точностью 0,01 (а не все значения подряд): на полной базе — десятки миллионов рейзов
let H = { pool: {}, tops: {}, tops5: {}, regs: {} };
const add = (L, k, v) => { const h = H[L][k] = H[L][k] || {}, q = Math.round(v * 100); h[q] = (h[q] || 0) + 1; };
// реальные суммы 3-бета / сквиза / 4-бета в bb (шаг 0,1) при данном размере предыдущего рейза: «до сколько ставят на опен 2,8»
let HA = { pool: {}, tops: {}, tops5: {}, regs: {} };
const addA = (L, k, ref, to) => { const h = HA[L][k] = HA[L][k] || {}, r = (Math.round(ref * 10) / 10).toFixed(1), g = h[r] = h[r] || {}, q = Math.round(to * 10); g[q] = (g[q] || 0) + 1; };
// проверка порога COMMIT: x = (мода пула для спота) / eff, корзины по 0.1; [пуш, рейз]
let commit = { pool: {}, tops: {}, tops5: {}, regs: {} };
let nDec = 0, nAiEff = 0, nRaise = 0, done = [];
let seen = new C.IdSet();
// чекпоинт после каждого архива (RESUME=1 — продолжить, MAX_SOURCES=N — часть)
const STATE = path.join(C.OUT, 'sizes_state.json'), IDSF = path.join(C.OUT, 'sizes_ids.bin');
let shardTag = process.env.SHARD_TAG || null, mergedTags = [];
const saveState = () => { const tmp = STATE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ shardTag, mergedTags, done, nDec, nAiEff, nRaise, commit, H, HA })); fs.renameSync(tmp, STATE); C.saveIds(seen, IDSF); };
// сложение гистограмм параллельного потока
const addH = (A, B) => { for (const L in B) for (const k in B[L]) { A[L] = A[L] || {}; const a = A[L][k] = A[L][k] || {}; for (const q in B[L][k]) a[q] = (a[q] || 0) + B[L][k][q]; } };
const addHA = (A, B) => { for (const L in B) for (const k in B[L]) { A[L] = A[L] || {}; const a = A[L][k] = A[L][k] || {}; for (const r in B[L][k]) { const g = a[r] = a[r] || {}; for (const q in B[L][k][r]) g[q] = (g[q] || 0) + B[L][k][r][q]; } } };

(async () => {
  if (process.env.RESUME === '1' && fs.existsSync(STATE) && fs.existsSync(IDSF)) { let st0; ({ H, HA = { pool: {}, tops: {}, tops5: {}, regs: {} }, commit, nDec, nAiEff, nRaise, done, mergedTags = [] } = st0 = JSON.parse(fs.readFileSync(STATE, 'utf8'))); if (st0.shardTag) shardTag = st0.shardTag; seen = C.loadIds(IDSF); C.log('sizes: продолжаю с чекпоинта, архивов', done.length); }
  if (process.env.SHARD_TAG) shardTag = process.env.SHARD_TAG;
  let merged = false;
  for (const dir of (process.env.MERGE_SHARDS || '').split(';').filter(Boolean)) {
    const SF = path.join(dir, 'sizes_state.json'); if (!fs.existsSync(SF)) continue;
    const o = JSON.parse(fs.readFileSync(SF, 'utf8')); if (!o.shardTag || mergedTags.includes(o.shardTag)) { C.log('sizes: поток ' + dir + ' уже сложен — пропускаю'); continue; }
    addH(H, o.H); addHA(HA, o.HA || {}); for (const L in o.commit) for (const k in o.commit[L]) { commit[L] = commit[L] || {}; const c = commit[L][k] = commit[L][k] || [0, 0]; c[0] += o.commit[L][k][0]; c[1] += o.commit[L][k][1]; }
    nDec += o.nDec; nAiEff += o.nAiEff; nRaise += o.nRaise; done.push(...o.done); mergedTags.push(o.shardTag); merged = true;
    C.log('sizes: сложен поток', dir, '— рейзов всего', nRaise);
  }
  if (merged) saveState();
  const part = C.partLimiter(); let unsaved = false;
  for await (const x of C.iterHands(C.sourceFiles(), new Set(done))) {
    if (x.end) { done.push(x.end); const ck = done.length % C.CK_EVERY === 0, hit = part.hit(); if (ck || hit) saveState(); unsaved = !(ck || hit); C.progress('sizes', done.length); C.log('sizes: пройден', x.end, ck || hit ? '(чекпоинт)' : ''); if (hit) { C.log('sizes: часть готова'); process.exit(C.PART_EXIT); } continue; }
    let rp; try { rp = parse(x.hand); } catch (e) { continue; }
    if (!rp || !rp.n || !rp.bb) continue;
    const room = C.roomOf(x.hand);
    if (!seen.add(room, rp.handId)) continue;
    const fr = frames(rp); if (!C.handIntact(rp, fr[fr.length - 1], x.hand)) continue;
    const kd = C.kindOf(rp, x.hand, x.fp), stH = C.tbandOf(C.buyinOf(x.fp, rp.title));
    // Mystery Bounty в призовых (и без данных о стадии) — не учитываем (как в модели)
    if (kd === 'm') { const tm = /Tournament #(\d+)/.exec(x.hand), T = tm && TOURN[room + ':' + tm[1]]; if (!T || !STG.preITM(T, STG.tsOf(rp.date), rp.n)) continue; }
    const grpOf = (nick) => { const k = C.playerKey(room, nick), c = CL[k]; if (!c || (TIGHT && !TIGHT[k])) return 'unk'; return CLU.GROUP[c[0]] || 'unk'; };
    for (const d of SP.preflopDecisions(rp, grpOf)) {
      nDec++;
      if (d.act === 'shove' || (d.to && !d.aiAct && d.tbl !== 'AI')) {
        // точка «рейз или пуш» — для проверки порога
        const a = d.tbl === 'RFI' ? 'open' : d.tbl === 'VSO' ? (d.C === 'C0' ? '3bet' : 'sqz') : d.tbl === 'VS3' && d.nR === 2 ? '4bet' : null;
        if (a && a !== 'open' && d.eff > 0 && d.refTo > 0) {
          const sz = SZ.DEFAULT[a] * d.refTo / d.eff, b = Math.min(10, Math.floor(sz * 10)) / 10;
          const sh = d.act === 'shove' || d.aiEff ? 0 : 1;
          const pk0 = C.playerKey(room, rp.nm[d.i]), LS = ['pool'].concat(isT1(pk0, stH) ? ['tops'] : [], isT2(pk0, stH) ? ['tops5'] : []);
          for (const L of LS) { const c = commit[L][a + '|' + b] = commit[L][a + '|' + b] || [0, 0]; c[sh]++; }
        }
      }
      if (!d.to || d.aiAct) continue;
      nRaise++;
      if (d.aiEff) { nAiEff++; continue; }
      const a = d.szAct; if (!a) continue;
      const v = SZ.measure(a, d.to, d.refTo, d.nLimp);
      const pk1 = C.playerKey(room, rp.nm[d.i]), top = isT1(pk1, stH), top5 = isT2(pk1, stH), reg = d.grp === 'reg';
      // ключи: с форматом турнира (фризаут / PKO) и общие
      for (const k of SZ.ownKeys(room, a, SP.bandOf(d.eff), SP.posBand(d.pos), d.nLimp, kd, d.oppPos ? SP.posBand(d.oppPos) : null, { C: d.C, tb: C.tableOf(rp.n), v: SZ.vsOf(a, d) })) {
        // все румы вместе (владелец, 20.11.2026): только ключи «*|…»
        const kk = '*' + k.slice(k.indexOf('|'));
        if (top) add('tops', kk, v); if (top5) add('tops5', kk, v); if (reg) add('regs', kk, v);
        if (a !== 'open' && a !== 'iso' && d.refTo > 0) { if (top) addA('tops', kk, d.refTo, d.to); if (top5) addA('tops5', kk, d.refTo, d.to); if (reg) addA('regs', kk, d.refTo, d.to); }
      }
    }
  }
  if (unsaved) saveState();
  if (process.env.STATE_ONLY === '1') { C.log('sizes: поток готов — состояние сохранено'); return; }
  const table = { built: new Date().toISOString().slice(0, 10), tops: {}, tops5: {}, regs: {}, pool: {} };
  for (const L of ['tops', 'tops5', 'regs']) for (const [k, hg] of Object.entries(H[L] || {})) {
    const v = Object.entries(hg).map(([q, c]) => [+q / 100, c]).sort((a, b) => a[0] - b[0]); // [значение, сколько раз]
    const N = v.reduce((s, x) => s + x[1], 0); if (N < 50) continue;
    const act = k.split('|')[1], step = act === 'open' || act === 'iso' ? 0.05 : 0.1;
    const hist = {}; for (const [x, c] of v) { const b = (Math.round(x / step) * step).toFixed(2); hist[b] = (hist[b] || 0) + c; }
    const [mb, mc] = Object.entries(hist).sort((a, b) => b[1] - a[1])[0];
    const q = (p) => { const t = p * (N - 1); let acc = 0; for (const [x, c] of v) { acc += c; if (acc > t) return +x.toFixed(2); } return +v[v.length - 1][0].toFixed(2); };
    const buckets = {}; for (const [x, c] of v) { const b = SZ.bucketOf(act, x); buckets[b] = (buckets[b] || 0) + c; }
    // rec — мода внутри самой частой корзины: «размер, которым чаще всего играют» устойчивее общей моды
    const topB = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0][0];
    const hb = {}; for (const [x, c] of v) if (SZ.bucketOf(act, x) === topB) { const b = (Math.round(x / step) * step).toFixed(2); hb[b] = (hb[b] || 0) + c; }
    const rec = +Object.entries(hb).sort((a, b) => b[1] - a[1])[0][0];
    for (const b in buckets) buckets[b] = Math.round(buckets[b] / N * 1000) / 10;
    // мода внутри каждой корзины (типичный размер корзины) и для кратных — реальная сумма в bb при данном предыдущем рейзе
    const bmode = {}; { const hh = {}; for (const [x, c] of v) { const b = SZ.bucketOf(act, x), t = (Math.round(x / step) * step).toFixed(2); (hh[b] = hh[b] || {})[t] = ((hh[b] || {})[t] || 0) + c; } for (const b in hh) bmode[b] = +Object.entries(hh[b]).sort((a, b2) => b2[1] - a[1])[0][0]; }
    let babs = null;
    if (HA[L][k]) { babs = {}; for (const [r, g] of Object.entries(HA[L][k])) { const byB = {}; for (const [q, c] of Object.entries(g)) { const to = +q / 10, b = SZ.bucketOf(act, to / +r); (byB[b] = byB[b] || {})[to.toFixed(1)] = ((byB[b] || {})[to.toFixed(1)] || 0) + c; } for (const b in byB) { const e = Object.entries(byB[b]), tot = e.reduce((s2, x) => s2 + x[1], 0); if (tot < 20) continue; (babs[b] = babs[b] || {})[r] = +e.sort((a, b2) => b2[1] - a[1])[0][0]; } } }
    // abs: против конкретного предыдущего рейза (шаг 0,1 bb) — сколько раздач и 5 самых частых сумм «до» [до, раз]
    let abs = null;
    if (HA[L][k]) { abs = {}; for (const [r, g] of Object.entries(HA[L][k])) { const e = Object.entries(g).map(([q, c]) => [+q / 10, c]), n = e.reduce((s2, x) => s2 + x[1], 0); if (n < 20) continue; abs[r] = [n, e.sort((a, b2) => b2[1] - a[1]).slice(0, 5)]; } }
    table[L][k] = { n: N, abs, bmode, babs, mode: +mb, share: Math.round(mc / N * 1000) / 10, rec, recBucket: topB, recShare: buckets[topB], p10: q(.1), p50: q(.5), p90: q(.9), buckets };
  }
  const outT = path.join(__dirname, '..', 'data', 'sizes_v8.json');
  fs.writeFileSync(outT, JSON.stringify(table));
  const cm = {}; for (const L of ['pool', 'tops', 'tops5']) for (const [k, [sh, r]] of Object.entries(commit[L] || {}).sort()) if (sh + r >= 30) (cm[L] = cm[L] || {})[k] = { n: sh + r, shove: Math.round(sh / (sh + r) * 100) };
  const rep = { decisions: nDec, raises: nRaise, aiEffRaises: nAiEff, keysPool: Object.keys(table.pool).length, keysTops: Object.keys(table.tops).length, keysTops5: Object.keys(table.tops5).length, keysRegs: Object.keys(table.regs).length, tops: tops.size, commit: cm };
  fs.writeFileSync(path.join(C.OUT, 'sizes_report.json'), JSON.stringify(rep, null, 1));
  C.log('sizes: решений', nDec, 'рейзов', nRaise, 'эфф. олл-инов', nAiEff, 'ключей пул/топы', rep.keysPool, rep.keysTops);
})();
