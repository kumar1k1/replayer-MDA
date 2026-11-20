'use strict';
// ============================================================================
// ИССЛЕДОВАНИЕ СТАДИЙ (владелец, 20.11.2026): насколько по-разному играют на разных стадиях турнира —
// прежде чем решать, на сколько стадий делить модель. Копим мелко (6 стадий), склейку решает отчёт.
// Стадии: s1 — вышло < 25% поля; s2 — 25–50%; s3 — 50% … подход к пузырю; bub — пузырь (осталось ≤ 1,3 × призовых
// до ITM); itm — в призах до финального стола; ft — финальный стол. Точно — по местам вылета; иначе оценка
// по среднему стеку (lib/stage.js) — копится отдельно (префикс «e:»), чтобы видеть, не искажает ли оценка.
// Метрики (по группе игрока reg/nit/fish/unk × полосе стека): опен первым, лимп первым, пуш первым,
// фолд на стил (SB/BB против CO/BTN/SB), фолд и 3-бет против опена, фолд на 3-бет, колл пуша первым,
// колл ре-пуша, размер опена.
// Попутно (владелец, 20.11.2026: хороший винрейт зависит от лимита) — винрейт регов по лимитам и четвертям базы:
// out/winq_st.json { "рум:ник": [ micro low mid high ] × 4 четверти × (n, Σbb, Σbb²) } — 48 чисел (как winq.cjs).
// Выход: out/stages.json { hands: {стадия: n}, M: { "стадия|метрика|группа|полоса": [n, x, x²] } }
// Потоки: tools/shards.cjs stages (SHARD_TAG / STATE_ONLY / MERGE_SHARDS / RESUME — как у winq.cjs).
// ============================================================================
const fs = require('fs'), path = require('path');
const C = require('./common.cjs'), SP = require('../lib/spots.js'), CLU = require('../lib/clusters.js'), STG = require('../lib/stage.js');
const P_ = C.loadParser(), { frames } = P_, parse = C.makeParse(P_);
const clFile = process.env.PLAYERS_CL || path.join(C.OUT, 'players_cl_all.json');
const CL = fs.existsSync(clFile) ? JSON.parse(fs.readFileSync(clFile, 'utf8')) : {};
const tournFile = process.env.TOURN || path.join(C.OUT, 'tourn_v8.json');
const TOURN = fs.existsSync(tournFile) ? JSON.parse(fs.readFileSync(tournFile, 'utf8')) : {};
const CALIB = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'stage_calib.json'), 'utf8')); } catch (e) { return null; } })();
const SAMPLE = +(process.env.SAMPLE || 1);
const K = require('../lib/cards.js');
const MIN_HANDS = +(process.env.MIN_HANDS_TOP || 10000);
const WANT = new Set(Object.keys(CL).filter(k => CLU.GROUP[CL[k][0]] === 'reg' && CL[k][4] >= MIN_HANDS * 0.9));
const STI = { micro: 0, low: 1, mid: 2, high: 3 };
let W = {}; // 1 — все раздачи; 2 — каждая вторая (по хэшу) и т. д.
C.log('стадии: игроков с кластером', Object.keys(CL).length, 'турниров', Object.keys(TOURN).length);

const BAND = (bb) => bb < 12 ? '<12' : bb < 20 ? '12-20' : bb < 30 ? '20-30' : bb < 50 ? '30-50' : '50+';
const grpOf = (key) => { const c = CL[key]; const g = c ? CLU.GROUP[c[0]] : null; return g === 'superfish' ? 'fish' : g || 'unk'; };
function stage6(T, t, tmax) {
  const sa = STG.stageAt(T, t, tmax, CALIB); if (!sa) return null;
  const ftN = tmax && tmax <= 6 ? 6 : 9;
  let R, N, paid;
  if (sa.exact) { R = sa.R; N = T.N; paid = T.Pb > 0 ? T.Pb : Math.max(ftN, Math.round(N * 0.15)); }
  else { N = 1000; R = Math.round(sa.r * N); paid = 150; if (sa.stage === 'ft') R = Math.min(R, ftN); }
  const out = 1 - R / N;
  const s = R <= ftN ? 'ft' : R <= paid ? 'itm' : R <= paid * 1.3 ? 'bub' : out < 0.25 ? 's1' : out < 0.5 ? 's2' : 's3';
  return sa.exact ? s : 'e:' + s;
}

let M = {}, H = {}, done = [], hands = 0, shardTag = process.env.SHARD_TAG || null, mergedTags = [];
let seen = new C.IdSet();
const STATE = path.join(C.OUT, 'stages_state.json'), IDSF = path.join(C.OUT, 'stages_ids.bin');
const saveState = () => { const tmp = STATE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ shardTag, mergedTags, done, hands, H, M, W })); fs.renameSync(tmp, STATE); C.saveIds(seen, IDSF); };
const add = (k, x) => { const a = M[k] || (M[k] = [0, 0, 0]); a[0]++; a[1] += x; a[2] += x * x; };
const LP = new Set(['CO', 'BTN', 'SB', 'BTN/SB']);

(async () => {
  if (process.env.RESUME === '1' && fs.existsSync(STATE) && fs.existsSync(IDSF)) { let o; ({ M, H, W = {}, done, hands, mergedTags = [] } = o = JSON.parse(fs.readFileSync(STATE, 'utf8'))); if (o.shardTag) shardTag = o.shardTag; seen = C.loadIds(IDSF); C.log('стадии: продолжаю, архивов', done.length); }
  if (process.env.SHARD_TAG) shardTag = process.env.SHARD_TAG;
  let merged = false;
  for (const dir of (process.env.MERGE_SHARDS || '').split(';').filter(Boolean)) {
    const SF = path.join(dir, 'stages_state.json'); if (!fs.existsSync(SF)) continue;
    const o = JSON.parse(fs.readFileSync(SF, 'utf8')); if (!o.shardTag || mergedTags.includes(o.shardTag)) { C.log('стадии: поток ' + dir + ' уже сложен'); continue; }
    for (const k in o.M) { const a = M[k] || (M[k] = [0, 0, 0]); for (let i = 0; i < 3; i++) a[i] += o.M[k][i]; }
    for (const k in o.H) H[k] = (H[k] || 0) + o.H[k];
    for (const k in o.W || {}) { const a = W[k] || (W[k] = new Array(48).fill(0)); for (let i = 0; i < 48; i++) a[i] += o.W[k][i]; }
    hands += o.hands; done.push(...o.done); mergedTags.push(o.shardTag); merged = true;
    C.log('стадии: сложен поток', dir, '— рук', hands);
  }
  if (merged) saveState();
  const part = C.partLimiter(); let unsaved = false;
  for await (const x of C.iterHands(C.sourceFiles(), new Set(done))) {
    if (x.end) { done.push(x.end); const ck = done.length % C.CK_EVERY === 0, hit = part.hit(); if (ck || hit) saveState(); unsaved = !(ck || hit); C.progress('stages', done.length); C.log('стадии: пройден', x.end, '— рук', hands); if (hit) process.exit(C.PART_EXIT); continue; }
    const tm = /Tournament #(\d+)/.exec(x.hand); if (!tm) continue;
    let rp; try { rp = parse(x.hand); } catch (e) { continue; }
    if (!rp || !rp.n || !rp.bb) continue;
    if (SAMPLE > 1 && (C.quarterOf(rp.handId) + (rp.handId % SAMPLE)) % SAMPLE) continue;
    const room = C.roomOf(x.hand);
    if (!seen.add(room, rp.handId)) continue;
    const fr = frames(rp), fin = fr[fr.length - 1]; if (!C.handIntact(rp, fin, x.hand)) continue;
    const keys = rp.nm.map(nk => C.playerKey(room, nk));
    if (SAMPLE === 1 && keys.some(k => WANT.has(k))) { // винрейт по лимитам — по всем раздачам (без выборки)
      const SD = {};
      if (C.SHOWDOWN_TRUSTED(room)) for (const [k, v] of Object.entries(rp.sh || {})) { const c = K.parseCards(v); if (c && c.length === 2) SD[+k] = { c }; }
      let net = null; try { net = C.netAdjusted(rp, fin, SD).net; } catch (e) {}
      const si = STI[C.stratumOf(x.fp, rp.title)];
      if (net && si != null) { const q = C.quarterOf(rp.handId), o = si * 12 + q * 3;
        for (let i = 0; i < rp.n; i++) { if (!WANT.has(keys[i])) continue; const a = W[keys[i]] || (W[keys[i]] = new Array(48).fill(0)), b = net[i] / rp.bb; a[o]++; a[o + 1] += b; a[o + 2] += b * b; } }
    }
    const T = TOURN[room + ':' + tm[1]]; if (!T) { H.none = (H.none || 0) + 1; continue; }
    const st = stage6(T, STG.tsOf(rp.date), rp.n); if (!st) { H.none = (H.none || 0) + 1; continue; }
    H[st] = (H[st] || 0) + 1; hands++;
    const G = keys.map(grpOf);
    const ds = SP.preflopDecisions(rp, () => '', false);
    for (const d of ds) {
      const g = G[d.i], b = BAND(d.eff), pre = st + '|', suf = '|' + g + '|' + b, a = d.act || '';
      const raise = a === 'shove' || /^(open|iso|3bet)/.test(a) || a === '4bet' || a === 'raise';
      if (d.tbl === 'RFI' && d.pos !== 'BB') {
        const pb = SP.posBand(d.pos);
        add(pre + 'open:' + pb + suf, raise ? 1 : 0);
        add(pre + 'limp:' + pb + suf, a === 'limp' ? 1 : 0);
        add(pre + 'shove1' + suf, a === 'shove' ? 1 : 0);
        if (/^open/.test(a) && !d.aiEff && d.to > 0) add(pre + 'openTo' + suf, d.to);
      }
      if (d.tbl === 'VSO' && d.C === 'C0') {
        add(pre + 'vsoFold' + suf, a === 'fold' ? 1 : 0);
        add(pre + 'vso3b' + suf, raise ? 1 : 0);
        if ((d.pos === 'SB' || d.pos === 'BB') && LP.has(d.oppPos)) add(pre + 'stealFold' + suf, a === 'fold' ? 1 : 0);
      }
      if (d.tbl === 'VS3' && d.openI === d.i && d.C === 'C0') add(pre + 'vs3Fold' + suf, a === 'fold' ? 1 : 0);
      if (d.tbl === 'AI' && d.C === 'C0' && (d.L === 'R1' || d.L === 'R2')) add(pre + (d.L === 'R1' ? 'aiCall1' : 'aiCall2') + suf, a === 'call' ? 1 : 0);
    }
  }
  if (unsaved || process.env.KEEP_STATE === '1') saveState();
  if (process.env.STATE_ONLY === '1') { C.log('стадии: поток готов'); return; }
  { const out = {}; for (const k in W) out[k] = W[k].map(v => Math.round(v * 100) / 100); fs.writeFileSync(path.join(C.OUT, 'winq_st.json'), JSON.stringify(out)); C.log('стадии: винрейт по лимитам — игроков', Object.keys(out).length); }
  fs.writeFileSync(path.join(C.OUT, 'stages.json'), JSON.stringify({ built: new Date().toISOString().slice(0, 10), hands, H, M }));
  C.log('стадии: готово — рук', hands, JSON.stringify(H));
})();
