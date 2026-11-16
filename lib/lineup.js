// Лайнап за спиной (п.7): вероятности ответов каждого игрока, который ещё будет ходить, и P(все сфолдят).
//
// Модель ответа игрока j в споте s (семейство из lib/stats.js pfSlots) при банде эффективного стека b:
//   1) пул:     q_pool[b]                        — по всем игрокам базы;
//   2) кластер: q_cl[b] = (x_cl + Kc·q_pool)/(n_cl + Kc)       — 20 кластеров тренера;
//   3) игрок:   p_j[b]  = (x_j  + Kp·q_cl)/(n_j + Kp)          — свои счётчики игрока в этом банде;
//   4) поправка на контекст, которого нет в счётчиках игрока (позиция открывшего, размер опена/пуша):
//      odds(p) × A[s|группа банда|позиция агрессора|корзина размера], A оценена на половине A базы.
// Kc, Kp подобраны по точному leave-one-out log-loss (pipeline/lineup.cjs), A — на половине A, проверка — на B.
// P(все сфолдят) = Π_j p_j(fold): каждый следующий игрок в этом сценарии видит тот же спот «опен без коллеров»,
// поэтому произведение — точная формула, а не допущение независимости типов.
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.LINEUP = f(); })(this, function () {
  // семейства слотов: смещение в банде и смещения действий (остаток — фолд), см. lib/stats.js
  const FAM = {
    rfi:  { acts: ['open', 'limp', 'shove'] },        // o = поз*4
    vso:  { acts: ['call', '3bet', 'shove'] },        // o = 20 + группа*4 (ББ / МБ / остальные)
    sqz:  { acts: ['call', 'raise'] },                // o = 32
    vs3:  { acts: ['fold', 'call', '4bet'], explicitFold: true }, // o = 35
    iso:  { acts: ['iso', 'limp', 'shove'] },         // o = 39
    ai:   { acts: ['call'] }                          // o = 43
  };
  const PER_BAND = 45;
  const BANDS = ['<12', '12-19', '20-35', '36-59', '60-99', '100-149', '150+'];
  const RFI_POS = { EP: 0, MP: 1, CO: 2, BTN: 3, SB: 4 };
  const vsoGroup = (pos) => pos === 'BB' ? 0 : (pos === 'SB' || pos === 'BTN/SB') ? 1 : 2;
  function slotOf(fam, band, pos) {
    const b = BANDS.indexOf(band); if (b < 0) return -1;
    const base = b * PER_BAND;
    if (fam === 'rfi') { const p = RFI_POS[pos]; return p == null ? -1 : base + p * 4; }
    if (fam === 'vso') return base + 20 + vsoGroup(pos) * 4;
    return base + { sqz: 32, vs3: 35, iso: 39, ai: 43 }[fam];
  }
  const famOfSlot = (o) => { const r = o % PER_BAND; return r < 20 ? 'rfi' : r < 32 ? 'vso' : r < 35 ? 'sqz' : r < 39 ? 'vs3' : r < 43 ? 'iso' : 'ai'; };
  // вектор [p_act1, p_act2, …, p_fold] из счётчиков pf (массив 315) в слоте o
  function vec(pf, o, fam) {
    const F = FAM[fam], n = pf ? pf[o] : 0, x = F.acts.map((_, k) => (pf ? pf[o + 1 + k] : 0));
    return { n, x };
  }
  const shrink = (x, n, prior, K) => prior.map((q, k) => (k < x.length ? (x[k] + K * q) / (n + K) : 0));
  function withFold(p, fam) {
    if (FAM[fam].explicitFold) return p.slice(0, FAM[fam].acts.length);
    const s = p.slice(0, FAM[fam].acts.length).reduce((a, b) => a + b, 0);
    return p.slice(0, FAM[fam].acts.length).concat([Math.max(0, 1 - s)]);
  }
  const foldIdx = (fam) => (FAM[fam].explicitFold ? 0 : FAM[fam].acts.length);
  const logit = (p) => Math.log(p / (1 - p)), sig = (z) => 1 / (1 + Math.exp(-z));

  // data: {pool:[315], cl:{'0':[315],…}, K:{fam:{Kc,Kp}}, adj:{key: delta_logit}}
  function create(data) {
    const poolV = (o, fam) => { const { n, x } = vec(data.pool, o, fam); return x.map(v => (n ? v / n : 0)); };
    function prob(fam, band, pos, pf, cl, ctx) {
      const o = slotOf(fam, band, pos); if (o < 0) return null;
      const K = (data.K && data.K[fam]) || { Kc: 50, Kp: 20 };
      const qp = poolV(o, fam);
      let q = qp;
      if (cl != null && data.cl && data.cl[cl]) { const v = vec(data.cl[cl], o, fam); q = shrink(v.x, v.n, qp, K.Kc); }
      let p = q, n = 0;
      if (pf) { const v = vec(pf, o, fam); n = v.n; p = shrink(v.x, v.n, q, K.Kp); }
      p = withFold(p, fam);
      // поправка контекста: сдвиг логита фолда, остальные действия масштабируются пропорционально
      const fi = foldIdx(fam);
      if (ctx && data.adj) {
        const d = data.adj[adjKey(fam, band, pos, ctx)];
        if (d && p[fi] > 0 && p[fi] < 1) {
          const nf = sig(logit(p[fi]) + d), r = (1 - nf) / (1 - p[fi]);
          p = p.map((v, k) => (k === fi ? nf : v * r));
        }
      }
      const names = FAM[fam].explicitFold ? FAM[fam].acts : FAM[fam].acts.concat(['fold']);
      const out = {}; names.forEach((a, k) => (out[a] = p[k]));
      out.n = n; out.src = pf && n ? 'игрок' : cl != null ? 'кластер' : 'пул';
      return out;
    }
    // behind: [{pos, band, pf, cl}] — игроки, которые будут ходить после агрессора; ctx — {aggPos, size}
    function foldAll(fam, behind, ctx) {
      let pr = 1; const each = [];
      for (const b of behind) { const r = prob(fam, b.band, b.pos, b.pf, b.cl, ctx); const f = r ? r.fold : 1; pr *= f; each.push(r); }
      return { p: pr, each };
    }
    return { prob, foldAll };
  }
  const SG = { '<12': '<20', '12-19': '<20', '20-35': '20-35', '36-59': '36-59', '60-99': '60+', '100-149': '60+', '150+': '60+' };
  const grpOfPos = (fam, pos) => (fam === 'vso' ? ['BB', 'SB', 'oth'][vsoGroup(pos)] : fam === 'ai' ? (pos === 'BB' ? 'BB' : pos === 'SB' ? 'SB' : 'oth') : pos);
  function adjKey(fam, band, pos, ctx) { return fam + '|' + grpOfPos(fam, pos) + '|' + SG[band] + '|' + (ctx.aggPos || '*') + '|' + (ctx.size || '*'); }
  return { FAM, BANDS, PER_BAND, slotOf, famOfSlot, vec, shrink, withFold, foldIdx, create, adjKey, logit, sig };
});
