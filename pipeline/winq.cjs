'use strict';
// ============================================================================
// ВИНРЕЙТ ПО ЧЕТВЕРТЯМ БАЗЫ — для отбора топов (решение владельца 19.11.2026).
// Только реги-кластеры с большой выборкой (по players_cl_all.json: рук ≥ 0,9 × MIN_HANDS_TOP). Для каждого —
// результат в bb по четвертям базы (common.quarterOf: A1 A2 | B1 B2), всего и по формату (фризаут / PKO / Mystery).
// У PokerStars, WPN, iPoker — с поправкой на олл-ин (как в статах), у CoinPoker — по факту.
// Выход: out/winq.json { "рум:ник": [ [вся игра] [фризаут] [PKO] [Mystery] × 4 четверти × (n, Σbb, Σbb²) ] } — 48 чисел.
// Потоки: tools/shards.cjs winq (SHARD_TAG / STATE_ONLY / MERGE_SHARDS / RESUME — как у sizes.cjs).
// ============================================================================
const fs = require('fs'), path = require('path');
const C = require('./common.cjs'), K = require('../lib/cards.js'), CLU = require('../lib/clusters.js');
const P_ = C.loadParser(), { frames } = P_, parse = C.makeParse(P_);
const MIN_HANDS = +(process.env.MIN_HANDS_TOP || 10000);
const clFile = process.env.PLAYERS_CL || path.join(C.OUT, 'players_cl_all.json');
const CL = JSON.parse(fs.readFileSync(clFile, 'utf8'));
const WANT = new Set(Object.keys(CL).filter(k => CLU.GROUP[CL[k][0]] === 'reg' && CL[k][4] >= MIN_HANDS * 0.9));
C.log('winq: регов с выборкой ≥', Math.round(MIN_HANDS * 0.9), 'рук —', WANT.size);
const FI = { n: 1, k: 2, m: 3 };
let W = {}, done = [], hands = 0, shardTag = process.env.SHARD_TAG || null, mergedTags = [];
let seen = new C.IdSet();
const STATE = path.join(C.OUT, 'winq_state.json'), IDSF = path.join(C.OUT, 'winq_ids.bin');
const saveState = () => { const tmp = STATE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ shardTag, mergedTags, done, hands, W })); fs.renameSync(tmp, STATE); C.saveIds(seen, IDSF); };
const addW = (A, B) => { for (const k in B) { const a = A[k] = A[k] || new Array(48).fill(0); for (let i = 0; i < 48; i++) a[i] += B[k][i]; } };

(async () => {
  if (process.env.RESUME === '1' && fs.existsSync(STATE) && fs.existsSync(IDSF)) { let o; ({ W, done, hands, mergedTags = [] } = o = JSON.parse(fs.readFileSync(STATE, 'utf8'))); if (o.shardTag) shardTag = o.shardTag; seen = C.loadIds(IDSF); C.log('winq: продолжаю, архивов', done.length); }
  if (process.env.SHARD_TAG) shardTag = process.env.SHARD_TAG;
  let merged = false;
  for (const dir of (process.env.MERGE_SHARDS || '').split(';').filter(Boolean)) {
    const SF = path.join(dir, 'winq_state.json'); if (!fs.existsSync(SF)) continue;
    const o = JSON.parse(fs.readFileSync(SF, 'utf8')); if (!o.shardTag || mergedTags.includes(o.shardTag)) { C.log('winq: поток ' + dir + ' уже сложен'); continue; }
    addW(W, o.W); hands += o.hands; done.push(...o.done); mergedTags.push(o.shardTag); merged = true;
    C.log('winq: сложен поток', dir, '— рук', hands);
  }
  if (merged) saveState();
  const part = C.partLimiter(); let unsaved = false;
  for await (const x of C.iterHands(C.sourceFiles(), new Set(done))) {
    if (x.end) { done.push(x.end); const ck = done.length % C.CK_EVERY === 0, hit = part.hit(); if (ck || hit) saveState(); unsaved = !(ck || hit); C.progress('winq', done.length); C.log('winq: пройден', x.end, '— рук', hands); if (hit) process.exit(C.PART_EXIT); continue; }
    let rp; try { rp = parse(x.hand); } catch (e) { continue; }
    if (!rp || !rp.n || !rp.bb) continue;
    const room = C.roomOf(x.hand), keys = rp.nm.map(nk => C.playerKey(room, nk));
    if (!keys.some(k => WANT.has(k))) { seen.add(room, rp.handId); continue; }
    if (!seen.add(room, rp.handId)) continue;
    const fr = frames(rp), fin = fr[fr.length - 1]; if (!C.handIntact(rp, fin, x.hand)) continue;
    const SD = {};
    if (C.SHOWDOWN_TRUSTED(room)) for (const [k, v] of Object.entries(rp.sh || {})) { const c = K.parseCards(v); if (c && c.length === 2) SD[+k] = { c }; }
    let net; try { net = C.netAdjusted(rp, fin, SD).net; } catch (e) { continue; }
    const q = C.quarterOf(rp.handId), fo = FI[C.kindOf(rp, x.hand, x.fp)] || 0;
    for (let i = 0; i < rp.n; i++) {
      if (!WANT.has(keys[i])) continue;
      const a = W[keys[i]] = W[keys[i]] || new Array(48).fill(0), b = net[i] / rp.bb;
      for (const o of [q * 3, fo * 12 + q * 3]) { a[o]++; a[o + 1] += b; a[o + 2] += b * b; }
    }
    hands++;
  }
  if (unsaved || process.env.KEEP_STATE === '1') saveState();
  if (process.env.STATE_ONLY === '1') { C.log('winq: поток готов'); return; }
  const out = {}; for (const k in W) out[k] = W[k].map(v => Math.round(v * 100) / 100);
  fs.writeFileSync(path.join(C.OUT, 'winq.json'), JSON.stringify(out));
  C.log('winq: готово — игроков', Object.keys(out).length, 'рук с ними', hands);
})();
