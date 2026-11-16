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
// [префлоп 315][кластер: половина A/B × формат short/full × 11 статов × (возможность, попадание)][рук short, full]
const O_CL = ST.PF_SLOTS, O_N = O_CL + 2 * 2 * NCL * 2, NU = O_N + 2;
const players = new Map(); // ключ → { u: Uint32Array(NU), f: Float64Array(24) } — результат: [вся игра][фризаут][PKO][Mystery] × (nA, ΣA, Σ²A, nB, ΣB, Σ²B)
const FI = { n: 1, k: 2, m: 3 };
// ход турниров (для стадии и баунти): места вылета, призовые места, стартовый стек (уровень I), средний стек и число столов по времени
const TOUR = new Map(), BUCKET = 600; // 10 минут
const ROMAN = (r) => { const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; let n = 0; for (let i = 0; i < r.length; i++) { const a = v[r[i]], b = v[r[i + 1]] || 0; n += a < b ? -a : a; } return n; };
const tsOf = (d) => { const m = /(\d{4})\/(\d{2})\/(\d{2}) (\d{1,2}):(\d{2}):(\d{2})/.exec(d || ''); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 : 0; };
function tourOf(room, text, rp, kd) {
  const m = /Tournament #(\d+)/.exec(text); if (!m) return;
  const key = room + ':' + m[1]; let T = TOUR.get(key);
  if (!T) { T = { kd, N: 0, Pb: 0, win: 0, ev: [], s0: [], bk: new Map(), lv: [99, 0], title: rp.title || '' }; TOUR.set(key, T); }
  const t = tsOf(rp.date), lm = /Level ([IVXLCDM]+)\b/.exec(text), lv = lm ? ROMAN(lm[1]) : 0;
  if (lv) { T.lv[0] = Math.min(T.lv[0], lv); T.lv[1] = Math.max(T.lv[1], lv); }
  if (lv === 1 && T.s0.length < 400) for (const v of rp.stacks) T.s0.push(v);
  if (t) {
    const b = Math.floor(t / BUCKET); let B = T.bk.get(b); if (!B) { B = [0, 0, new Set()]; T.bk.set(b, B); }
    for (const v of rp.stacks) { B[0] += v; B[1]++; }
    const tb = /^Table '([^']*)'/m.exec(text); if (tb) B[2].add(tb[1]);
  }
  for (const e of text.matchAll(/finished the tournament in (\d+)(?:st|nd|rd|th) place( and received)?/g)) { const pl = +e[1]; T.ev.push([t, pl]); T.N = Math.max(T.N, pl); if (e[2]) T.Pb = Math.max(T.Pb, pl); }
  if (/wins the tournament/.test(text)) T.win = 1;
}
let IDS = new C.IdSet();
let st = { hands: 0, dups: 0, broken: 0, errs: 0, done: [] };
// чекпоинт после каждого архива: RESUME=1 — продолжить; MAX_SOURCES=N — пройти N архивов и выйти (часть готова)
const STATE = path.join(C.OUT, 'stats_state.ndjson'), IDSF = path.join(C.OUT, 'stats_ids.bin');
function saveState() {
  const w = C.ndWriter(STATE);
  w.put(['s', st]);
  for (const [k, p] of players) { const sp = []; for (let i = 0; i < p.u.length; i++) if (p.u[i]) sp.push(i, p.u[i]); w.put(['p', k, sp, Array.from(p.f)]); }
  for (const [k, T] of TOUR) w.put(['t', k, Object.assign({}, T, { bk: [...T.bk].map(([b, B]) => [b, B[0], B[1], [...B[2]]]) })]);
  w.close(); C.saveIds(IDS, IDSF);
}
async function loadState() {
  await C.ndRead(STATE, (r) => {
    if (r[0] === 's') st = r[1];
    else if (r[0] === 'p') { const p = { u: new Uint32Array(NU), f: Float64Array.from(r[3]) }; for (let i = 0; i < r[2].length; i += 2) p.u[r[2][i]] = r[2][i + 1]; players.set(r[1], p); }
    else if (r[0] === 't') { const T = r[2]; T.bk = new Map(T.bk.map(([b, s0, n, tb]) => [b, [s0, n, new Set(tb)]])); TOUR.set(r[1], T); }
  });
  IDS = C.loadIds(IDSF);
}
function P(key) { let p = players.get(key); if (!p) { p = { u: new Uint32Array(NU), f: new Float64Array(24) }; players.set(key, p); } return p; }

(async () => {
  const t0 = Date.now();
  if (process.env.RESUME === '1' && fs.existsSync(STATE) && fs.existsSync(IDSF)) { await loadState(); C.log('статы: продолжаю с чекпоинта — рук', st.hands, 'архивов пройдено', st.done.length); }
  const part = C.partLimiter();
  for await (const x of C.iterHands(C.sourceFiles(), new Set(st.done))) {
    if (x.end) {
      st.done.push(x.end); saveState(); C.progress('stats', st.done.length);
      C.log('статы: пройден', x.end, '— рук', st.hands, 'игроков', players.size, ((Date.now() - t0) / 60000).toFixed(1) + ' мин (чекпоинт сохранён)');
      if (part.hit()) { C.log('статы: часть готова (' + part.count() + ' арх.) — запустите снова, продолжу со следующего'); process.exit(C.PART_EXIT); }
      continue;
    }
    if (LIMIT && st.hands >= LIMIT) break;
    try {
      const rp = parseHand(x.hand);
      if (!rp || !rp.n || !rp.bb) continue;
      const room = C.roomOf(x.hand);
      if (!IDS.add(room, rp.handId)) { st.dups++; continue; }
      const fr = frames(rp), fin = fr[fr.length - 1];
      if (!C.handIntact(rp, fin, x.hand)) { st.broken++; continue; }
      const fi = FMT[C.tableFormat(x.hand).fmt], hA = C.halfOf(rp.handId) === 'A' ? 0 : 1, half = hA * 3;
      const kd = C.kindOf(rp, x.hand, x.fp), fo = FI[kd] * 6; st.kinds = st.kinds || {}; st.kinds[kd] = (st.kinds[kd] || 0) + 1;
      tourOf(room, x.hand, rp, kd);
      const SD = {};
      if (C.SHOWDOWN_TRUSTED(room)) for (const [k, v] of Object.entries(rp.sh || {})) { const c = K.parseCards(v); if (c && c.length === 2) SD[+k] = { c }; }
      const net = C.netAdjusted(rp, fin, SD).net;
      const pk = rp.nm.map(nk => P(C.playerKey(room, nk)));
      const r = ST.handStats(rp, fr);
      for (let i = 0; i < rp.n; i++) {
        const p = pk[i]; p.u[O_N + fi]++;
        const b = net[i] / rp.bb; p.f[half]++; p.f[half + 1] += b; p.f[half + 2] += b * b;
        p.f[fo + half]++; p.f[fo + half + 1] += b; p.f[fo + half + 2] += b * b; // то же — по формату турнира
      }
      for (const [i, s, h] of r.cl) { const o = O_CL + ((hA * 2 + fi) * NCL + ST.CL.indexOf(s)) * 2; pk[i].u[o]++; if (h) pk[i].u[o + 1]++; }
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
  // ход турниров → out/tourn_v8.json
  const TO = {};
  for (const [k, T] of TOUR) {
    // стартовый стек — самый частый стек на уровне I: у кого ещё не было банков, ровно стартовый (минус анте/блайнды не вычтены — стек «до раздачи»)
    const fq = new Map(); for (const v of T.s0) fq.set(v, (fq.get(v) || 0) + 1);
    let S = 0, best = 0; for (const [v, c] of fq) if (c > best || (c === best && v > S)) { S = v; best = c; }
    if (best < 3) S = 0; // нет повторов — не уверены
    T.ev.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    TO[k] = { kd: T.kd, N: T.N, Pb: T.Pb, win: T.win, S, lv: T.lv, title: T.title, ev: T.ev, bk: [...T.bk].sort((a, b) => a[0] - b[0]).map(([b, B]) => [b, Math.round(B[0] / B[1]), B[2].size]) };
  }
  fs.writeFileSync(path.join(C.OUT, 'tourn_v8.json'), JSON.stringify(TO));
  C.log('статы: турниров', TOUR.size, 'с местами вылета', Object.values(TO).filter(t => t.ev.length).length, 'со стартовым стеком', Object.values(TO).filter(t => t.S).length, '| форматы', JSON.stringify(st.kinds));
  fs.writeFileSync(path.join(C.OUT, 'pool_v8.json'), JSON.stringify({ layout: { CL: ST.CL, O_CL, O_N, PF_PER_BAND: ST.PF_PER_BAND, BANDS: require('../lib/spots.js').BAND_NAMES, FMT: Object.keys(FMT) }, stats: st, players: pool.players, kept, u: Array.from(pool.u) }));
  C.log('СТАТЫ ГОТОВО: рук', st.hands, 'повторов', st.dups, 'повреждённых', st.broken, 'ошибок', st.errs, '| игроков', players.size, 'выгружено (≥' + MIN_HANDS + ' рук)', kept, '|', ((Date.now() - t0) / 60000).toFixed(1), 'мин');
})();
