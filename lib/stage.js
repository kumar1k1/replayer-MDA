// Стадия турнира (план C): по ходу турнира из базы (pipeline/passStats.cjs → out/tourn_v8.json).
//  • Точно — по местам вылета («finished the tournament in N place»): после вылета на месте N осталось N−1 игроков.
//    Участников ≈ самое большое место; пузырь — самое большое призовое место («… and received»).
//  • Оценка — где мест нет (CoinPoker и др.): фишки в турнире не исчезают, поэтому доля оставшихся ≈ стартовый стек /
//    средний стек по всем столам турнира в это время; финальный стол — когда активен один стол.
// Стадии: early — осталось > 60% поля; mid — до зоны пузыря; late — осталось ≤ 1,3 × призовых мест (пузырь и после);
//         ft — финальный стол (≤ 9 игроков, у 6-max — ≤ 6).
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.STAGE = f(); })(this, function () {
  const NAMES = { early: 'ранняя', mid: 'средняя', late: 'поздняя (пузырь и после)', ft: 'финальный стол' };
  const BUCKET = 600;
  function classify(R, N, Pb, tmax) {
    if (!(R > 0) || !(N > 0)) return null;
    const ftN = tmax && tmax <= 6 ? 6 : 9, paid = Pb > 0 ? Pb : Math.max(ftN, Math.round(N * 0.15));
    if (R <= ftN) return 'ft';
    if (R <= paid * 1.3) return 'late';
    if (R > N * 0.6) return 'early';
    return 'mid';
  }
  // точное число оставшихся к моменту t: минимальное место среди вылетов не позже t, минус 1; до первого вылета — N
  function remaining(T, t) {
    if (!T || !T.ev || !T.ev.length || !(T.N > 0)) return null;
    let R = T.N;
    for (const [te, pl] of T.ev) { if (te > t) break; if (pl - 1 < R) R = pl - 1; }
    return Math.max(1, R);
  }
  // оценка доли оставшихся по среднему стеку (без мест)
  // calib — data/stage_calib.json: поправка «стартовый / средний стек → истинная доля» по корзинам и часам от начала турнира
  // (обучена на PokerStars, проверена на другой половине турниров: стадия точно в 82%, ±1 стадия в 98,7%)
  function estimate(T, t, calib) {
    if (!T || !T.S || !T.bk || !T.bk.length) return null;
    const b = Math.floor(t / BUCKET);
    let best = null; for (const x of T.bk) if (!best || Math.abs(x[0] - b) < Math.abs(best[0] - b)) best = x;
    if (!best || Math.abs(best[0] - b) > 3) return null;
    let r = Math.min(1, T.S / best[1]);
    if (calib && calib.table) {
      const NB = calib.NB || 20, hrs = Math.min(3, Math.max(0, Math.floor((best[0] - T.bk[0][0]) * BUCKET / 3600)));
      const c = calib.table[Math.min(NB - 1, Math.floor(r * NB)) * 4 + hrs]; if (c != null) r = c;
    }
    return { r, tables: best[2] };
  }
  // T — турнир из tourn_v8.json; t — время раздачи (сек); tmax — мест за столом
  function stageAt(T, t, tmax, calib) {
    // файл одного игрока: места вылета видны только в призовой зоне (T.partial) — до первого вылета с местом стадия оценивается
    const R = T && T.partial && T.ev && T.ev.length && t < T.ev[0][0] ? null : remaining(T, t);
    if (R != null) { const st = classify(R, T.N, T.Pb, tmax); return st ? { stage: st, R, N: T.N, r: R / T.N, exact: true } : null; }
    const e = estimate(T, t, calib); if (!e) return null;
    const N = 1000, R2 = Math.round(e.r * N); // N условный: важна доля; призовых — 15%
    let st = classify(R2, N, 0, tmax);
    // «один активный стол → финалка» — только если в данных видны несколько столов турнира (в файле игрока стол всегда один)
    if (e.tables === 1 && st !== 'early' && !T.single) st = 'ft';
    return { stage: st, r: e.r, exact: false, tables: e.tables };
  }
  const tsOf = (d) => { const m = /(\d{4})\/(\d{2})\/(\d{2}) (\d{1,2}):(\d{2}):(\d{2})/.exec(d || ''); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 : 0; };
  // ход турнира по набору раздач (реплеер: загруженный турнир игрока). Тот же формат, что tourn_v8.json, + partial
  const ROMAN = (r) => { const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; let n = 0; for (let i = 0; i < r.length; i++) { const a = v[r[i]], b = v[r[i + 1]] || 0; n += a < b ? -a : a; } return n; };
  function collect(hands) { // hands: [{ text, rp }]
    const T = { N: 0, Pb: 0, ev: [], S: 0, bk: [], partial: false }, s0 = [], bk = new Map();
    for (const h of hands) {
      const t = tsOf(h.rp.date), lm = /Level ([IVXLCDM]+)\b/.exec(h.text), lv = lm ? ROMAN(lm[1]) : 0;
      if (lv === 1) for (const v of h.rp.stacks) s0.push(v);
      if (t) { const b = Math.floor(t / BUCKET); let B = bk.get(b); if (!B) { B = [0, 0, new Set()]; bk.set(b, B); } for (const v of h.rp.stacks) { B[0] += v; B[1]++; } const tb = /^Table '([^']*)'/m.exec(h.text); if (tb) B[2].add(tb[1]); }
      for (const e of h.text.matchAll(/finished the tournament in (\d+)(?:st|nd|rd|th) place( and received)?/g)) { const pl = +e[1]; T.ev.push([t, pl]); T.N = Math.max(T.N, pl); if (e[2]) T.Pb = Math.max(T.Pb, pl); }
      if (/finished the tournament\s*$/m.test(h.text)) T.partial = true; // вылеты без места — до призовой зоны места скрыты
    }
    const fq = new Map(); for (const v of s0) fq.set(v, (fq.get(v) || 0) + 1);
    let best = 0; for (const [v, c] of fq) if (c > best || (c === best && v > T.S)) { T.S = v; best = c; }
    if (best < 3) T.S = 0;
    T.ev.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    T.bk = [...bk].sort((a, b) => a[0] - b[0]).map(([b, B]) => [b, Math.round(B[0] / B[1]), B[2].size]);
    T.single = hands.length > 0 && hands.every(h => /^Dealt to /m.test(h.text)); // файл игрока: виден только его стол
    return T;
  }
  // доказанно ДО призовых? (владелец, 19.11.2026: Mystery Bounty в призовой зоне — из расчётов исключаем).
  // Точно: осталось больше, чем призовых мест (с запасом 5%); по оценке среднего стека — осталось больше 25% поля.
  // Нет данных — не доказано (false).
  function preITM(T, t, tmax, calib) {
    const sa = stageAt(T, t, tmax, calib); if (!sa) return false;
    if (sa.exact) { const paid = T.Pb > 0 ? T.Pb : Math.round(T.N * 0.15); return sa.R > paid * 1.05; }
    return sa.r > 0.25;
  }
  return { NAMES, classify, remaining, estimate, stageAt, preITM, tsOf, BUCKET, collect };
});
