'use strict';
// ============================================================================
// П.3 ПРОХОД СТАТОВ ИГРОКОВ (заменяет passA_v7). Один проход по всей базе:
//  • 11 статов кластера (docs/КЛАСТЕРЫ.md) — по формату стола short / full, счётчики «возможность / попадание»;
//  • префлоп-статы для лайнапа — 45 счётчиков × 7 бандов эффективного стека (lib/stats.js, pfSlots);
//  • результат в bb по половинам базы A / B (для винрейта ≥ 3000 рук с проверкой на другой половине, п.5);
//    у PokerStars — с поправкой на олл-ин, у CoinPoker — по факту (вскрытия CoinPoker неполные, п.1).
// Ключ игрока — «рум:ник». Повторы и повреждённые истории отсеиваются (п.1).
// Выход: out/players_v8.ndjson (игроки с ≥ MIN_HANDS рук), out/pool_v8.json (суммы по всем игрокам — средние пула).
//   node --max-old-space-size=12288 pipeline/passStats.cjs     (RAW_DIRS, BACKING_DIR, OUT_DIR, MIN_HANDS=50, LIMIT)
// ============================================================================
const fs = require('fs'), path = require('path');
const C = require('../pipeline/common.cjs'), K = require('../lib/cards.js'), ST = require('../lib/stats.js');
const P_ = C.loadParser(), { frames } = P_, parseHand = C.makeParse(P_);
const MIN_HANDS = +(process.env.MIN_HANDS || 50), LIMIT = +(process.env.LIMIT || 0);
const NCL = ST.CL.length, FMT = { short: 0, full: 1 };
const O_CL = ST.PF_SLOTS, O_N = O_CL + 2 * NCL * 2, NU = O_N + 2; // [префлоп 315][кластер 2×11×2][рук short, full]
const players = new Map(); // ключ → { u: Uint32Array(NU), f: Float64Array(6) }
const IDS = new C.IdSet();
const st = { hands: 0, dups: 0, broken: 0, errs: 0 };
function P(key) { let p = players.get(key); if (!p) { p = { u: new Uint32Array(NU), f: new Float64Array(6) }; players.set(key, p); } return p; }

(async () => {
  const t0 = Date.now();
  for await (const x of C.iterHands(C.sourceFiles())) {
    if (x.end) { if (/\.rar$/i.test(x.end)) C.log('статы: пройден', x.end, '— рук', st.hands, 'игроков', players.size, ((Date.now() - t0) / 60000).toFixed(1) + ' мин'); continue; }
    if (LIMIT && st.hands >= LIMIT) break;
    try {
      const rp = parseHand(x.hand);
      if (!rp || !rp.n || !rp.bb) continue;
      const room = C.roomOf(x.hand);
      if (!IDS.add(room, rp.handId)) { st.dups++; continue; }
      const fr = frames(rp), fin = fr[fr.length - 1];
      if (!C.handIntact(rp, fin, x.hand)) { st.broken++; continue; }
      const fi = FMT[C.tableFormat(x.hand).fmt], half = C.halfOf(rp.handId) === 'A' ? 0 : 3;
      const SD = {};
      if (C.SHOWDOWN_TRUSTED(room)) for (const [k, v] of Object.entries(rp.sh || {})) { const c = K.parseCards(v); if (c && c.length === 2) SD[+k] = { c }; }
      const net = C.netAdjusted(rp, fin, SD).net;
      const pk = rp.nm.map(nk => P(C.playerKey(room, nk)));
      const r = ST.handStats(rp, fr);
      for (let i = 0; i < rp.n; i++) {
        const p = pk[i]; p.u[O_N + fi]++;
        const b = net[i] / rp.bb; p.f[half]++; p.f[half + 1] += b; p.f[half + 2] += b * b;
      }
      for (const [i, s, h] of r.cl) { const o = O_CL + (fi * NCL + ST.CL.indexOf(s)) * 2; pk[i].u[o]++; if (h) pk[i].u[o + 1]++; }
      for (const [i, o, a] of r.slots) { pk[i].u[o]++; if (a >= 0) pk[i].u[a]++; }
      st.hands++;
      if (st.hands % 1000000 === 0) C.log('статы:', st.hands, 'рук, игроков', players.size, ((Date.now() - t0) / 60000).toFixed(1) + ' мин');
    } catch (e) { if (++st.errs <= 8) C.log('статы ERR', e.message); }
  }
  // ---------- выгрузка ----------
  const pool = { u: new Float64Array(NU), players: 0, hands: st.hands };
  const fd = fs.openSync(path.join(C.OUT, 'players_v8.ndjson'), 'w');
  let buf = [], kept = 0;
  for (const [key, p] of players) {
    for (let k = 0; k < NU; k++) pool.u[k] += p.u[k];
    const n = p.u[O_N] + p.u[O_N + 1];
    if (n < MIN_HANDS) continue;
    kept++;
    buf.push(JSON.stringify({ k: key, n, ns: p.u[O_N], nf: p.u[O_N + 1], cl: Array.from(p.u.subarray(O_CL, O_N)), pf: Array.from(p.u.subarray(0, O_CL)), r: Array.from(p.f, v => Math.round(v * 100) / 100) }));
    if (buf.length >= 5000) { fs.writeSync(fd, buf.join('\n') + '\n'); buf = []; }
  }
  if (buf.length) fs.writeSync(fd, buf.join('\n') + '\n');
  fs.closeSync(fd);
  pool.players = players.size;
  fs.writeFileSync(path.join(C.OUT, 'pool_v8.json'), JSON.stringify({ layout: { CL: ST.CL, O_CL, O_N, PF_PER_BAND: ST.PF_PER_BAND, BANDS: require('../lib/spots.js').BAND_NAMES, FMT: Object.keys(FMT) }, stats: st, players: pool.players, kept, u: Array.from(pool.u) }));
  C.log('СТАТЫ ГОТОВО: рук', st.hands, 'повторов', st.dups, 'повреждённых', st.broken, 'ошибок', st.errs, '| игроков', players.size, 'выгружено (≥' + MIN_HANDS + ' рук)', kept, '|', ((Date.now() - t0) / 60000).toFixed(1), 'мин');
})();
