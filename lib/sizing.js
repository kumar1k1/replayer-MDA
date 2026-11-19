// Сайзинги префлопа (п.6): корзины по пикам распределений базы и рекомендация размера.
//
// Мера размера зависит от действия (так её читают игроки и так она стабильна между стеками):
//   open  — «до» в bb;                       iso   — bb сверх лимперов: to − nLimp;
//   3bet  — кратность к опену: to / refTo;    sqz   — то же, но поверх опена с коллерами;
//   4bet  — кратность к 3-бету: to / refTo.
// Границы корзин стоят в провалах между пиками (см. docs/ОТЧЁТЫ.md, п.6): у опена пики 2.0 / 2.2–2.5 / 3–3.5,
// у 3-бета в позиции 2.5 / 3.0, из блайндов 3.5 / 4.0 / 4.5 и т.д.
// Олл-ин — отдельное действие (shove), в корзины не попадает. «Эффективный олл-ин» — ставка, которая покрывает
// эффективный стек (≥93% eff), хотя у самого игрока фишки остаются: по смыслу это пуш, а не сайзинг.
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.SIZING = f(); })(this, function () {
  const BUCKETS = {
    open: { edges: [2.15, 2.65, 3.25, 3.75], names: ['2x', '2.2-2.5x', '3x', '3.5x', '4x+'] },
    iso:  { edges: [1.5, 2.25, 2.75, 3.25, 3.75], names: ['+1', '+2', '+2.5', '+3', '+3.5', '+4+'] },
    '3bet': { edges: [2.65, 3.25, 3.75, 4.25, 4.75], names: ['≤2.5x', '3x', '3.5x', '4x', '4.5x', '5x+'] },
    sqz:  { edges: [3.75, 4.25, 4.75, 5.25, 5.75], names: ['≤3.5x', '4x', '4.5x', '5x', '5.5x', '6x+'] },
    '4bet': { edges: [1.95, 2.35, 2.75], names: ['≤1.9x', '2-2.3x', '2.4-2.7x', '2.8x+'] }
  };
  const AI_EFF = 0.93;   // ставка ≥93% эффективного стека — по смыслу олл-ин
  // порог «пуш вместо рейза»: размер ≥30% эффективного стека. Проверено по базе (out/sizes_report.json, commit):
  // при размере 20–30% eff топы пушат в 41% случаев, 30–40% — в 69%, 40–50% — в 83%: переход через 50% — около 0.3.
  const COMMIT = 0.3;

  // группа бандов для сайзингов: на <20 bb выборки мельче, а 60+ ведёт себя одинаково (см. отчёт п.6)
  const SIZE_GROUP = { '<12': '<20', '12-19': '<20', '20-35': '20-35', '36-59': '36-59', '60-99': '60+', '100-149': '60+', '150+': '60+' };
  const groupOf = (band) => SIZE_GROUP[band] || band;

  // действие для сайзинга из разметки решения (lib/spots.js): null — не рейз или олл-ин
  function actionOf(d) {
    if (!d || !d.to || d.aiAct || d.aiEff) return null;
    if (d.tbl === 'RFI') return 'open';
    if (d.tbl === 'ISO') return 'iso';
    if (d.tbl === 'VSO' && d.refTo > 0) return d.C === 'C0' ? '3bet' : 'sqz';
    if (d.tbl === 'VS3' && d.nR === 2 && d.refTo > 0) return '4bet';
    return null;
  }
  function measure(action, to, refTo, nLimp) {
    if (action === 'open') return to;
    if (action === 'iso') return to - (nLimp || 0);
    return refTo > 0 ? to / refTo : NaN;
  }
  function bucketOf(action, x) {
    const b = BUCKETS[action]; if (!b || !(x >= 0)) return null; // изо минимальным рейзом даёт x = 0 → корзина «+1»
    let k = 0; while (k < b.edges.length && x >= b.edges[k]) k++;
    return b.names[k];
  }
  const sideOf = (action, pos) => action === 'open' ? pos : action === 'iso' ? null : action === '4bet' ? '*' : (pos === 'SB' || pos === 'BB' ? 'blinds' : 'ip');

  // ключи таблицы (19.11.2026, владелец: «если SB — то именно SB, никаких BB»): room|action|банд|позиция[|oПозиция открывшего][|формат]
  //  позиция — своя (SB отдельно от BB, BTN отдельно от CO…); для изо — L1/L2 (число лимперов); o… — позиция того, на чей
  //  рейз отвечаем (3-бет, сквиз, 4-бет). Порядок — от точного к общему: точный стек и позиция соперника → без соперника →
  //  группа стеков → все стеки этой позиции → другие румы. Чужие позиции не подмешиваются (кроме опена «*» и изо L2→L1).
  // fmt — формат турнира ('n' фризаут, 'k' PKO, 'm' Mystery → как PKO)
  // запасные стеки (владелец, 19.11.2026): глубокие — только соседний глубокий стек; средние и короткие — только свой стек
  const BAND_NEAR = { '150+': ['100-149'], '100-149': ['150+', '60-99'], '60-99': ['100-149'] };
  // x — уточнения: { C: 'C1'|'C2' — коллеров перед сквизом, tb: '6'|'9' — размер стола }
  // изо — по своей позиции И числу лимперов («BTN|L1»): изо с BTN и из SB разные (без позиции — больше)
  function ownKeys(room, action, band, pos, nLimp, fmt, opp, x) {
    x = x || {};
    const f = fmt ? (fmt === 'n' ? 'n' : 'k') : null;
    const P = action === 'iso' ? pos + '|L' + Math.min(Math.max(nLimp || 1, 1), 2) : action === 'sqz' && x.C ? pos + '|' + (x.C === 'C1' ? 'c1' : 'c2') : pos;
    const O = (action === '3bet' || action === 'sqz' || action === '4bet') && opp ? 'o' + opp : null;
    const T = x.tb ? 't' + x.tb : null;
    const ks = [], add = (b, o, ff, t) => ks.push([room, action, b, P].concat(o ? [o] : []).concat(ff ? [ff] : []).concat(t ? [t] : []).join('|'));
    if (T) { if (O) add(band, O, f, T); add(band, null, f, T); }
    if (O) { if (f) add(band, O, f); add(band, O, null); }
    if (f) add(band, null, f);
    add(band, null, null);
    return ks;
  }
  function keysFor(room, action, band, pos, nLimp, fmt, opp, x) {
    const ks = ownKeys(room, action, band, pos, nLimp, fmt, opp, x);
    for (const nb of BAND_NEAR[band] || []) ks.push(...ownKeys(room, action, nb, pos, nLimp, fmt, opp, { C: x && x.C }).filter(k => !/\|[nk]$/.test(k)));
    if (action === 'iso' && (nLimp || 1) >= 2) ks.push(room + '|iso|' + band + '|' + pos + '|L1');
    const P = action === 'iso' ? pos + '|L' + Math.min(Math.max(nLimp || 1, 1), 2) : action === 'sqz' && x && x.C ? pos + '|' + (x.C === 'C1' ? 'c1' : 'c2') : pos;
    ks.push('*|' + action + '|' + band + '|' + P);
    return [...new Set(ks)];
  }

  // минимальный легальный рейз «до»: прошлый уровень + последний прирост (опен — минимум 2bb)
  function minRaise(action, refTo, prevTo) {
    if (action === 'open' || action === 'iso') return 2;
    const inc = refTo - (prevTo || (action === '3bet' || action === 'sqz' ? 1 : 0));
    return refTo + Math.max(1, inc);
  }
  const r05 = (x) => Math.round(x * 20) / 20, r01 = (x) => Math.round(x * 10) / 10;

  // Рекомендация размера после того, как EV выбрал «рейз».
  // ctx: {room, action, band, pos, refTo, prevTo, nLimp, eff}; table: data/sizes_v8.json (.tops / .pool)
  // Возврат: {to, measure, bucket, allin, src, n, share, why}
  function recommend(ctx, table) {
    const { room, action, band, pos, refTo, prevTo, nLimp, eff, fmt, opp, C, tb } = ctx;
    let row = null, src = null;
    // порядок: самый точный ключ — сначала у топов, потом у пула; только потом более общий ключ
    // (изо над двумя лимперами по пулу точнее, чем изо над одним по топам)
    outer: for (const k of keysFor(room, action, band, pos, nLimp, fmt, opp, { C, tb })) for (const layer of ['tops']) {
      const t = table && table[layer];
      if (t && t[k] && t[k].n >= (layer === 'tops' ? 100 : 200)) { row = t[k]; src = layer + ':' + k; break outer; }
    }
    // рекомендуемый размер — самая частая корзина у топов и мода внутри неё (rec); мода по всем значениям
    // у 3-бетов размазана (15–30%), а корзина — устойчива
    const m = row ? (row.rec != null ? row.rec : row.mode) : DEFAULT[action];
    // сумма «до» — как реально ставят топы в этой корзине при таком же предыдущем рейзе (не кратность × рейз: 8.8 → 8.5)
    const bk = row && row.recBucket ? row.recBucket : bucketOf(action, m);
    const to = table ? bucketTo(action, bk, ctx, table).to : toFor(action, m, ctx);
    // как в этом споте распределены размеры у топов (корзины от 5%): [{to, share}] — для пояснения в совете
    const dist = row && row.buckets && table ? Object.keys(row.buckets).filter(b => row.buckets[b] >= 5).map(b => ({ bucket: b, to: bucketTo(action, b, ctx, table).to, share: Math.round(row.buckets[b]) })).sort((a, b) => a.to - b.to) : null;
    const res = { dist, to, measure: m, bucket: bk, allin: false, src: src || 'default', n: row ? row.n : 0, share: row ? (row.recShare != null ? row.recShare : row.share) : null, why: '' };
    if (eff > 0 && to >= eff * COMMIT) {
      res.allin = true; res.to = r01(eff);
      res.why = 'размер ' + to + 'bb ≥ ' + Math.round(COMMIT * 100) + '% эффективного стека ' + r01(eff) + 'bb — после такого рейза фолд невозможен, ставим олл-ин';
    }
    return res;
  }
  // размер «до» в bb по мере m (bb для опена, bb сверх лимперов для изо, кратность для 3-бета/4-бета), не меньше минимального рейза
  function toFor(action, m, ctx) {
    let to = action === 'open' ? m : action === 'iso' ? m + (ctx.nLimp || 0) : m * ctx.refTo;
    to = Math.max(to, minRaise(action, ctx.refTo, ctx.prevTo));
    return action === 'open' || action === 'iso' ? r05(to) : r01(to);
  }
  // размер «до» в bb для варианта-корзины: по базе — самая частая реальная сумма в этой корзине при таком же предыдущем
  // рейзе (±0,15 bb), иначе мода корзины × предыдущий рейз, иначе середина корзины. ctx — как в recommend.
  function bucketTo(action, bucket, ctx, table) {
    const { room, band, pos, refTo, nLimp, fmt, opp, C, tb } = ctx;
    if (table) for (const k of keysFor(room || 'ps', action, band, pos, nLimp, fmt, opp, { C, tb })) for (const layer of ['tops']) {
      const row = table[layer] && table[layer][k]; if (!row || row.n < (layer === 'tops' ? 100 : 200)) continue;
      if (row.babs && row.babs[bucket] && refTo > 0) {
        let best = null, bd = 0.151; for (const r in row.babs[bucket]) { const dd = Math.abs(+r - refTo); if (dd < bd) { bd = dd; best = r; } }
        if (best != null) return { to: Math.max(row.babs[bucket][best], minRaise(action, refTo, ctx.prevTo)), src: 'база: чаще всего ставят до' };
      }
      if (row.bmode && row.bmode[bucket] != null) return { to: toFor(action, row.bmode[bucket], ctx), src: 'база: типичный размер корзины' };
    }
    return { to: toFor(action, repOf(action, bucket), ctx), src: 'середина корзины' };
  }
  // типичная мера для корзины (для показа варианта размера): «3.5x» → 3.5, «2.2-2.5x» → 2.3, «≤2.5x» → 2.5, «5x+» → 5, «+2.5» → 2.5
  function repOf(action, bucket) {
    const ns = String(bucket).match(/[\d.]+/g) || []; if (!ns.length) return DEFAULT[action];
    return ns.length === 2 ? Math.round((+ns[0] + +ns[1]) / 2 * 10) / 10 : +ns[0];
  }
  // запасные значения, если таблицы нет (моды пула по 1.4М раздач, PS+Coin)
  const DEFAULT = { open: 2, iso: 2.5, '3bet': 3, sqz: 4, '4bet': 2.2 };

  return { ownKeys, bucketTo, BUCKETS, AI_EFF, COMMIT, SIZE_GROUP, groupOf, actionOf, measure, bucketOf, keysFor, minRaise, recommend, toFor, repOf, DEFAULT };
});
