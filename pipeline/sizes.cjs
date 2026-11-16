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
if (fs.existsSync(TOPS)) { const t = JSON.parse(fs.readFileSync(TOPS, 'utf8')); tops = new Set([...Object.keys(t.A || {}), ...Object.keys(t.B || {})]); }
C.log('sizes: топов', tops.size);

// гистограммы значений с точностью 0,01 (а не все значения подряд): на полной базе — десятки миллионов рейзов
let H = { pool: {}, tops: {} };
const add = (L, k, v) => { const h = H[L][k] = H[L][k] || {}, q = Math.round(v * 100); h[q] = (h[q] || 0) + 1; };
// проверка порога COMMIT: x = (мода пула для спота) / eff, корзины по 0.1; [пуш, рейз]
let commit = { pool: {}, tops: {} };
let nDec = 0, nAiEff = 0, nRaise = 0, done = [];
let seen = new C.IdSet();
// чекпоинт после каждого архива (RESUME=1 — продолжить, MAX_SOURCES=N — часть)
const STATE = path.join(C.OUT, 'sizes_state.json'), IDSF = path.join(C.OUT, 'sizes_ids.bin');
const saveState = () => { const tmp = STATE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ H, commit, nDec, nAiEff, nRaise, done })); fs.renameSync(tmp, STATE); C.saveIds(seen, IDSF); };

(async () => {
  if (process.env.RESUME === '1' && fs.existsSync(STATE) && fs.existsSync(IDSF)) { ({ H, commit, nDec, nAiEff, nRaise, done } = JSON.parse(fs.readFileSync(STATE, 'utf8'))); seen = C.loadIds(IDSF); C.log('sizes: продолжаю с чекпоинта, архивов', done.length); }
  const part = C.partLimiter();
  for await (const x of C.iterHands(C.sourceFiles(), new Set(done))) {
    if (x.end) { done.push(x.end); saveState(); C.progress('sizes', done.length); C.log('sizes: пройден', x.end, '(чекпоинт)'); if (part.hit()) { C.log('sizes: часть готова'); process.exit(C.PART_EXIT); } continue; }
    let rp; try { rp = parse(x.hand); } catch (e) { continue; }
    if (!rp || !rp.n || !rp.bb) continue;
    const room = C.roomOf(x.hand);
    if (!seen.add(room, rp.handId)) continue;
    const fr = frames(rp); if (!C.handIntact(rp, fr[fr.length - 1], x.hand)) continue;
    const kd = C.kindOf(rp, x.hand, x.fp);
    for (const d of SP.preflopDecisions(rp, () => '')) {
      nDec++;
      if (d.act === 'shove' || (d.to && !d.aiAct && d.tbl !== 'AI')) {
        // точка «рейз или пуш» — для проверки порога
        const a = d.tbl === 'RFI' ? 'open' : d.tbl === 'VSO' ? (d.C === 'C0' ? '3bet' : 'sqz') : d.tbl === 'VS3' && d.nR === 2 ? '4bet' : null;
        if (a && a !== 'open' && d.eff > 0 && d.refTo > 0) {
          const sz = SZ.DEFAULT[a] * d.refTo / d.eff, b = Math.min(10, Math.floor(sz * 10)) / 10;
          const sh = d.act === 'shove' || d.aiEff ? 0 : 1;
          const isTop = tops.has(C.playerKey(room, rp.nm[d.i]));
          for (const L of isTop ? ['pool', 'tops'] : ['pool']) { const c = commit[L][a + '|' + b] = commit[L][a + '|' + b] || [0, 0]; c[sh]++; }
        }
      }
      if (!d.to || d.aiAct) continue;
      nRaise++;
      if (d.aiEff) { nAiEff++; continue; }
      const a = d.szAct; if (!a) continue;
      const v = SZ.measure(a, d.to, d.refTo, d.nLimp);
      const top = tops.has(C.playerKey(room, rp.nm[d.i]));
      // ключи: с форматом турнира (фризаут / PKO) и общие
      for (const k of SZ.keysFor(room, a, SP.bandOf(d.eff), SP.posBand(d.pos), d.nLimp, kd).slice(0, a === 'open' ? 3 : 2)) {
        add('pool', k, v); if (top) add('tops', k, v);
        const kk = '*' + k.slice(k.indexOf('|')); add('pool', kk, v); if (top) add('tops', kk, v);
      }
    }
  }
  const table = { built: new Date().toISOString().slice(0, 10), tops: {}, pool: {} };
  for (const L of ['pool', 'tops']) for (const [k, hg] of Object.entries(H[L])) {
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
    table[L][k] = { n: N, mode: +mb, share: Math.round(mc / N * 1000) / 10, rec, recBucket: topB, recShare: buckets[topB], p10: q(.1), p50: q(.5), p90: q(.9), buckets };
  }
  const outT = path.join(__dirname, '..', 'data', 'sizes_v8.json');
  fs.writeFileSync(outT, JSON.stringify(table));
  const cm = {}; for (const L of ['pool', 'tops']) for (const [k, [sh, r]] of Object.entries(commit[L]).sort()) if (sh + r >= 30) (cm[L] = cm[L] || {})[k] = { n: sh + r, shove: Math.round(sh / (sh + r) * 100) };
  const rep = { decisions: nDec, raises: nRaise, aiEffRaises: nAiEff, keysPool: Object.keys(table.pool).length, keysTops: Object.keys(table.tops).length, tops: tops.size, commit: cm };
  fs.writeFileSync(path.join(C.OUT, 'sizes_report.json'), JSON.stringify(rep, null, 1));
  C.log('sizes: решений', nDec, 'рейзов', nRaise, 'эфф. олл-инов', nAiEff, 'ключей пул/топы', rep.keysPool, rep.keysTops);
})();
