'use strict';
// Разметка префлоп-спотов — общая для конвейера (Node) и движка в реплеере (браузер): одни и те же ключи.
// Логика контекстов (RFI / ISO / VSO / VS3 / AI) — как в passBC_v6, плюс то, чего там не было:
// сколько вложено до решения (фолд = потерять ровно это), размер стола, баунти, кто ещё будет ходить.
(function (root, factory) {
  if (typeof module !== 'undefined') module.exports = factory();
  else root.RMSpots = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // сайзинги (п.6): в Node — модуль рядом, в браузере — глобальный SIZING (подключить lib/sizing.js до spots.js)
  const SZ = typeof module !== 'undefined' ? require('./sizing.js') : (typeof SIZING !== 'undefined' ? SIZING : null);
// ---------- измерения ключей ----------
  // страта по бай-ину: сначала папка архива («$162-$215/$162__Knockout/…» — полный бай-ин), иначе заголовок турнира.
  // В заголовке бай-ин бывает из частей («$37.50+$112.50+$12.00») — берётся сумма (раньше — первая часть: $37.50 → low вместо mid).
  function stratumOf(fp, title) {
    const m1 = String(fp || '').match(/[$₮€]([\d.]+)/);
    let v = m1 ? parseFloat(m1[1]) : 0;
    if (!v) {
      const t = String(title || '').replace(/(\d),(\d{3})/g, '$1$2'), m = t.match(/[$₮€][\d.]+(?:\s*\+\s*[$₮€]?[\d.]+)*/);
      if (m) v = (m[0].match(/[\d.]+/g) || []).reduce((s, x) => s + parseFloat(x), 0);
    }
    if (!v) return 'unknown';
    return v < 11 ? 'micro' : v < 55 ? 'low' : v < 200 ? 'mid' : 'high';
  }
  // бакеты эффективного стека — как в v6 (s1 <10bb … s15 300+)
  const SB_EDGES = [10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 300];
  const stackB = (bb) => { let k = 0; while (k < SB_EDGES.length && bb >= SB_EDGES[k]) k++; return 's' + (k + 1); };
  // размер стола по числу сданных игроков: '6' (2–6) или '9' (7+); баунти — отдельный признак (в PKO колл шире)
  // банды эффективного стека (владелец, 15.11.2026): [0;12) [12;20) [20;36) [36;60) [60;100) [100;150) [150;∞)
  const BAND_EDGES = [12, 20, 36, 60, 100, 150];
  const BAND_NAMES = ['<12', '12-19', '20-35', '36-59', '60-99', '100-149', '150+'];
  const bandOf = (bb) => { let k = 0; while (k < BAND_EDGES.length && bb >= BAND_EDGES[k]) k++; return BAND_NAMES[k]; };
  const tableOf = (n) => (n <= 6 ? '6' : '9');
  // формат турнира: 'k' — PKO (прогрессивный нокаут), 'm' — Mystery Bounty, 'n' — фризаут.
  // Раньше — только по словам в названии; у PokerStars их нет («$50+$50+$9 USD Hold'em No Limit»), и почти все PKO
  // PokerStars считались фризаутами. Теперь — любой из признаков: «$X bounty» у игроков в раздаче, бай-ин из трёх частей,
  // папка архива («…__Knockout» / «…__Freezeout»), слова в названии.
  function kindOf(rp, text, fp) {
    const t = String((rp && rp.title) || ''), f = String(fp || ''), head = String(text || '').slice(0, 2000);
    if (/mystery/i.test(t) || /mystery/i.test(f)) return 'm';
    if (/freezeout/i.test(f)) return 'n';
    if (/bounty|knockout|pko|\bko\b/i.test(t) || (rp && rp.fmt === 'PKO')) return 'k';
    if (/^Seat \d+: .*\bbounty\)/mi.test(head)) return 'k';
    // iPoker / RedStar: бай-ин из трёх частей — баунти (BHS, Bounty Hunter); мистери там подписаны словом «Mystery»
    if (/^\s*iPoker Hand #/.test(head) && /[$€£₮][\d.,]+\s*\+\s*[$€£₮][\d.,]+\s*\+\s*[$€£₮][\d.,]+/.test(t)) return 'k';
    // бай-ин из трёх частей без «$X bounty» у мест — Mystery Bounty (конверт случайный, виден только при выбивании)
    if (/[$€£₮][\d.,]+\s*\+\s*[$€£₮][\d.,]+\s*\+\s*[$€£₮][\d.,]+/.test(t)) return text ? 'm' : 'k';
    if (/knockout|bounty|pko/i.test(f)) return 'k';
    return 'n';
  }
  // семейство позиций (для обобщённых уровней)
  const posBand = (p) => /^(UTG|EP|MP|LJ)/.test(p) ? 'EP' : /^HJ/.test(p) ? 'MP' : p === 'BTN/SB' ? 'SB' : p;
  const sizeOpen = (x) => (x <= 2.05 ? 'x2.0' : x <= 2.5 ? 'x2.2' : x <= 3.3 ? 'x2.7' : 'x3.5');
  const size3b = (to, open) => (open > 0 && to / open <= 2.9 ? 'x2.7' : 'x3.5');
  
  // ---------- разметка префлопа: каждая точка решения ----------
  // Возвращает [{k, i, tbl, pos, oppPos, oppGrp, sB, L, C, act, inv, potBefore, toCall, behind, eff, ai}]
  // inv — сколько игрок вложил до этого решения (анте + ставка улицы), в bb: фолд сейчас = потерять ровно inv.
  function preflopDecisions(rp, grpOf, withOthers) {
    const bb = rp.bb, n = rp.n;
    const ante = new Array(n).fill(0), cur = new Array(n).fill(0);
    for (const e of rp.ev) {
      if (e.t === 'A' && e.i >= 0) ante[e.i] += e.a;
      if ((e.t === 'SB' || e.t === 'BB') && e.i >= 0) cur[e.i] += e.a;
    }
    const posted = ante.map((a, i) => a + cur[i]);
    const behind0 = (i) => (rp.stacks[i] - posted[i]) / bb; // стек за спиной после блайндов/анте (как в v6)
    let raises = 0, limpers = 0, callers = 0, fcg = null, open = null, three = null, lastR = null;
    let pot = posted.reduce((s, x) => s + x, 0);
    const folded = new Array(n).fill(false);
    const out = [];
    rp.ev.forEach((e, k) => {
      if (e.st !== 0 || !(e.i >= 0) || 'rcfx'.indexOf(e.t) < 0) return;
      const i = e.i, pos = rp.pl[i][0], myB = behind0(i), toBb = (e.a || 0) / bb;
      const facingAI = lastR && (lastR.ai || lastR.toBb >= Math.min(lastR.behindBb, myB) * 0.93);
      const ctx = facingAI ? 'AI' : raises === 0 ? (limpers > 0 ? 'ISO' : 'RFI') : raises === 1 ? 'VSO' : 'VS3';
      const ref = ctx === 'AI' ? lastR : ctx === 'VSO' ? open : ctx === 'VS3' ? three : null;
      const sB = stackB(ref ? Math.min(myB, ref.behindBb) : myB);
      let act = null;
      if (e.t === 'f') act = 'fold';
      else if (e.t === 'x') act = 'check';
      else if (e.t === 'c') act = raises > 0 ? 'call' : 'limp';
      else if (e.t === 'r') {
        // e.a у рейза — «до» (сумма ставки улицы); олл-ин — флаг парсера или ставка ≥93% стека
        const aiMe = !!e.ai || (toBb >= ((rp.stacks[i] - ante[i]) / bb) * 0.93);
        if (ctx === 'AI') act = 'raise';
        else if (aiMe) act = 'shove';
        else if (ctx === 'VSO') act = '3bet:' + size3b(toBb, open.toBb);
        else if (ctx === 'VS3') act = '4bet';
        else if (ctx === 'ISO') act = 'iso:' + sizeOpen(toBb);
        else act = 'open:' + sizeOpen(toBb);
      }
      const maxBet = Math.max(...cur);
      out.push({
        k, i, tbl: ctx, pos, oppPos: ref ? ref.pos : '', oppGrp: ref ? ref.grp : 'none', sB,
        // ISO — число лимперов; AI — сколько рейзов было (R1 пуш первым, R2 пуш поверх опена, R3 поверх 3-бета):
        // без этого колл пуша-открытия (широкий) и колл ре-пуша (узкий) смешивались в одну ячейку
        L: ctx === 'ISO' ? 'L' + Math.min(limpers, 3) : ctx === 'AI' ? 'R' + Math.min(raises, 3) : '',
        C: ctx === 'VSO' || ctx === 'VS3' || ctx === 'AI' ? 'C' + Math.min(callers, 2) : '',
        fcg: callers > 0 ? fcg : '',
        act, inv: (ante[i] + cur[i]) / bb, potBefore: pot / bb, toCall: Math.max(0, maxBet - cur[i]) / bb,
        stackTot: (rp.stacks[i] - ante[i]) / bb, // фишки, которые ещё можно поставить на этой улице (с учётом блайнда в cur)
        behind: myB, refBehind: ref ? ref.behindBb : null, refTo: ref ? ref.toBb : null, refI: ref ? ref.i : -1, refTbl: ref ? ref.tbl : '', refSB: ref ? ref.sB : '', openTo: open ? open.toBb : null, openI: open ? open.i : -1,
        stack: rp.stacks[i] / bb, grp: grpOf(rp.nm[i]),
        nR: raises, // сколько рейзов было до решения
        to: e.t === 'r' ? toBb : 0, nLimp: limpers, // своя ставка «до» (bb) и число лимперов — для сайзингов (п.6)
        aiAct: e.t === 'r' && (!!e.ai || toBb >= ((rp.stacks[i] - ante[i]) / bb) * 0.93), // рейз игрока — олл-ин
        // эффективный стек решения: против рейзера, а если рейза нет — против самого глубокого из оставшихся в раздаче
        eff: ref ? Math.min(myB, ref.behindBb) : Math.min(myB, (() => { let m = 0; for (let j = 0; j < n; j++) if (j !== i && !folded[j]) m = Math.max(m, behind0(j)); return m; })()),
        // «эффективный олл-ин»: рейз покрывает эффективный стек, хотя свои фишки ещё остаются (SB 40bb ставит 20 против BB 15bb)
        aiEff: false,
        // кто ещё в раздаче (не сфолдил) — для точного расчёта пуша: позиция, весь стек, вложено, группа
        others: !withOthers ? null : rp.pl.map((p, j) => ({ j, pos: p[0], stack: rp.stacks[j] / bb, inv: (ante[j] + cur[j]) / bb, behind: behind0(j), grp: grpOf(rp.nm[j]) })).filter(o => o.j !== i && !folded[o.j])
      });
      {
        const d = out[out.length - 1];
        d.aiEff = e.t === 'r' && !d.aiAct && ctx !== 'AI' && d.eff > 0 && toBb >= d.eff * 0.93;
        // корзина сайзинга по пикам базы (lib/sizing.js); для олл-инов и эффективных олл-инов — null
        const sa = SZ ? SZ.actionOf(d) : null;
        d.szAct = sa; d.sz = sa ? SZ.bucketOf(sa, SZ.measure(sa, toBb, d.refTo, limpers)) : null;
      }
      if (e.t === 'f') folded[i] = true;
      // обновить состояние
      if (e.t === 'c') { const add = e.a || 0; cur[i] += add; pot += add; }
      if (e.t === 'r') { const add = Math.max(0, (e.a || 0) - cur[i]); cur[i] = e.a || 0; pot += add; }
      if (e.t === 'r') {
        const r = { i, pos, toBb, behindBb: myB, grp: grpOf(rp.nm[i]), ai: act === 'shove' || !!e.ai, tbl: ctx, sB };
        if (raises === 0) open = r; else three = r;
        lastR = r; raises++; callers = 0; fcg = null;
      } else if (e.t === 'c' && raises === 0) limpers++;
      else if (e.t === 'c') { callers++; if (!fcg) fcg = grpOf(rp.nm[i]); }
    });
    return out;
  }
  
  // после решения k игрока i все остальные сфолдили на префлопе и банк забран без вскрытия
  function foldedAround(rp, k, i) {
    for (let q = k + 1; q < rp.ev.length; q++) {
      const e = rp.ev[q];
      if (e.t === 'U' || e.t === 'W') continue;
      if (e.st !== 0) return false;
      if (e.i !== i && 'rcbx'.indexOf(e.t) >= 0) return false;
    }
    return true;
  }

  return { BAND_EDGES, BAND_NAMES, bandOf, stratumOf, stackB, SB_EDGES, tableOf, kindOf, posBand, sizeOpen, size3b, preflopDecisions, foldedAround };
});
