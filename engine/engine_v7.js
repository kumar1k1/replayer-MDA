'use strict';
// ============================================================================
// ДВИЖОК ПОДСКАЗОК v7 — по модели passV7 (model_v7.json) и таблице эквити 169×169 (eq169.json).
// Работает в браузере (window.RMEngine) и в Node (require).
//
// Для решения игрока на префлопе возвращает все варианты действия с EV ОТНОСИТЕЛЬНО ФОЛДА (фолд = 0):
//   • пуш первым / против лимперов и колл олл-ина — точный расчёт для конкретной руки через эквити против
//     диапазонов из базы (диапазоны пушей и коллов по вскрытиям олл-инов не смещены) и частоты коллов;
//   • остальные действия — EV топов: P(все сфолдили) × банк + (1 − P) × EV продолжения для этой руки
//     (рука → класс → спот, иерархическое стягивание), с поправкой на сдвиг вскрытий;
//   • рука неизвестна — EV диапазона (средний по споту) и частоты топов.
// Вердикт фактическому действию: «лучшее», «близко (в пределах шума)» или «ошибка −X bb».
// ============================================================================
(function (root, factory) {
  if (typeof module !== 'undefined') module.exports = factory(require('../lib/cards.js'), require('../lib/spots.js'));
  else root.RMEngine = factory(root.RMCards, root.RMSpots);
})(typeof self !== 'undefined' ? self : this, function (K, SP) {
  const K_SPOT = 60;   // стягивание спот-уровня к обобщённому (в «руках»)
  const K_HAND = 40;   // рука → класс
  const K_CLASS = 80;  // класс → среднее продолжение спота
  const ALPHA_R = 12;  // диапазоны: вес обобщённого диапазона (Дирихле) при смешивании
  const ACTS = {
    RFI: ['fold', 'limp', 'open:x2.0', 'open:x2.2', 'open:x2.7', 'open:x3.5', 'shove'],
    ISO: ['fold', 'check', 'limp', 'iso:x2.2', 'iso:x2.7', 'iso:x3.5', 'shove'],
    VSO: ['fold', 'call', '3bet:x2.7', '3bet:x3.5', 'shove'],
    VS3: ['fold', 'call', '4bet', 'shove'],
    AI: ['fold', 'call']
  };
  const RU = { fold: 'фолд', limp: 'лимп', check: 'чек', call: 'колл', shove: 'олл-ин', '4bet': '4-бет', raise: 'рейз',
    'open:x2.0': 'опен 2×', 'open:x2.2': 'опен 2.2×', 'open:x2.7': 'опен 2.7×', 'open:x3.5': 'опен 3.5×',
    'iso:x2.2': 'изо 2.2×', 'iso:x2.7': 'изо 2.7×', 'iso:x3.5': 'изо 3.5×', '3bet:x2.7': '3-бет 2.7×', '3bet:x3.5': '3-бет 3.5×' };

  function create(model, eqTable) {
    const EQ = eqTable.eq ? Float32Array.from(eqTable.eq, v => v / 10000) : eqTable;
    const EV = model.EV, HC = model.HC;
    // разбор диапазонов (лениво, с кэшем)
    const rCache = new Map();
    function range(map, key) {
      if (rCache.has(key)) return rCache.get(key);
      const s = map[key]; let a = null;
      if (s) { a = new Float64Array(169); for (const p of s.split(',')) { const [h, c] = p.split(':'); a[+h] = +c; } }
      rCache.set(key, a); return a;
    }
    // рейтинг рук для запасного диапазона «лучшие p%»: эквити против случайной руки
    const RANK = (() => {
      const v = K.H169.map((H, h) => { let s = 0, w = 0; for (let r = 0; r < 169; r++) { s += EQ[h * 169 + r] * K.H169[r].combos; w += K.H169[r].combos; } return [h, s / w]; });
      v.sort((a, b) => b[1] - a[1]); return v.map(x => x[0]);
    })();
    function topRange(p) {
      const a = new Float64Array(169); let need = Math.max(0.01, Math.min(1, p)) * 1326;
      for (const h of RANK) { if (need <= 0) break; const c = K.H169[h].combos, take = Math.min(c, need); a[h] = take; need -= take; }
      return a;
    }
    const norm = (a) => { let s = 0; for (const v of a) s += v; if (!s) return null; const o = new Float64Array(169); for (let h = 0; h < 169; h++) o[h] = a[h] / s; return o; };
    // диапазон: точный ключ + обобщённый как априорный (Дирихле), запасной — «лучшие p%»
    function mixRange(fine, coarse, fallbackP) {
      const prior = coarse ? norm(coarse) : norm(topRange(fallbackP));
      if (!fine) return { r: coarse ? mixPrior(coarse, norm(topRange(fallbackP)), ALPHA_R) : prior, n: coarse ? sum(coarse) : 0, src: coarse ? 'обобщённо' : 'запасной' };
      return { r: mixPrior(fine, prior, ALPHA_R), n: sum(fine), src: 'точно' };
    }
    const sum = (a) => { let s = 0; for (const v of a) s += v; return s; };
    function mixPrior(cnt, prior, alpha) { const o = new Float64Array(169); for (let h = 0; h < 169; h++) o[h] = cnt[h] + alpha * prior[h]; return o; }

    const cellEV = (k) => { const c = EV[k]; return c ? { n: c[0], m: c[1], sd: c[2] || 0, nfa: c[3] || 0, mfa: c[4] || 0 } : null; };
    const cellHC = (k) => { const c = HC[k]; return c ? { n: c[0], m: c[1], sd: c[2] || 0 } : null; };
    // иерархическое стягивание: cells — от точного к общему; каждый уровень тянется к следующему с весом k
    function shrink(cells, k) {
      let m = null, n = 0, sd = 0, lvl = -1;
      for (let q = cells.length - 1; q >= 0; q--) {
        const c = cells[q]; if (!c || !c.n) continue;
        if (m === null) { m = c.m; n = c.n; sd = c.sd; lvl = q; continue; }
        m = (c.n * c.m + k * m) / (c.n + k); n = c.n; sd = c.sd || sd; lvl = q;
      }
      return m === null ? null : { m, n, sd, lvl, se: sd / Math.sqrt(n + k) };
    }

    // ---------- ключи спота (как в passV7) ----------
    function keys(sp) {
      const tk = sp.tb + sp.kd;
      return {
        S: [sp.tbl, sp.st, tk, sp.pos, sp.oppPos, sp.sB, sp.L, sp.C].join('|'),
        Sb: [sp.tbl, sp.st, tk, SP.posBand(sp.pos), sp.oppPos ? SP.posBand(sp.oppPos) : '', sp.sB, sp.L, sp.C].join('|')
      };
    }
    // EV действия по спот-уровню и частота у когорты
    function spotLevel(coh, sp, act) {
      const { S, Sb } = keys(sp);
      const c = [cellEV(coh + '|' + S + '|' + act + '|' + sp.oppGrp), cellEV(coh + '|' + S + '|' + act + '|*'), cellEV(coh + '|' + Sb + '|' + act + '|*')];
      if (coh === 'T') c.push(cellEV('F|' + S + '|' + act + '|*'), cellEV('F|' + Sb + '|' + act + '|*')); // топов мало — тянем к полю
      const ev = shrink(c, K_SPOT);
      const fa = c.find(x => x && x.n >= 20) || c.find(Boolean);
      return { ev, pfa: fa ? fa.nfa / fa.n : 0, mfa: fa && fa.nfa ? fa.mfa : 0, raw: c };
    }
    function freqs(coh, sp, acts) {
      const { S, Sb } = keys(sp);
      const pick = (pref) => acts.map(a => { const c = cellEV(coh + '|' + pref + '|' + a + '|*'); return c ? c.n : 0; });
      let v = pick(S); let tot = v.reduce((s, x) => s + x, 0), lvl = 'точно';
      if (tot < 30) { v = pick(Sb); tot = v.reduce((s, x) => s + x, 0); lvl = 'обобщённо'; }
      return { f: v.map(x => (tot ? x / tot : 0)), n: tot, lvl };
    }

    // ---------- EV конкретной руки по слою вскрытий (не олл-ин действия) ----------
    function handEV(sp, act, h, sl) {
      const { S, Sb } = keys(sp);
      const cl = K.C12OF[h];
      // среднее продолжения по ВСЕМ раздачам (без карт) — несмещённое; по вскрытым — сдвинутое
      const all = sl.ev ? sl : null; const raw = sl.raw.find(x => x && x.n > (x.nfa || 0));
      const contAll = raw && raw.n > raw.nfa ? (raw.n * raw.m - raw.nfa * raw.mfa) / (raw.n - raw.nfa) : null;
      const shown = cellHC('T|' + Sb + '|' + act + '|*') || cellHC('F|' + Sb + '|' + act + '|*');
      const shift = contAll !== null && shown && shown.n >= 30 ? shown.m - contAll : 0; // сдвиг вскрытий
      const cells = [];
      for (const coh of ['T', 'F']) cells.push(cellHC(coh + '|' + Sb + '|' + act + '|h' + h), cellHC(coh + '|' + S + '|' + act + '|' + cl), cellHC(coh + '|' + Sb + '|' + act + '|' + cl));
      // порядок: рука(T) → класс(T) → класс-обобщ.(T) → рука(F) → … ; поле — запасной априор
      const hc = shrink([cells[0], cells[1], cells[2], cells[3], cells[4], cells[5]].map(c => c && { n: c.n, m: c.m - shift, sd: c.sd }), K_HAND);
      if (!hc && contAll === null) return null;
      let cont = hc ? hc.m : contAll;
      if (hc && contAll !== null) cont = (hc.n * hc.m + K_CLASS * contAll) / (hc.n + K_CLASS);
      const ev = sl.pfa * sl.mfa + (1 - sl.pfa) * cont;
      const se = hc ? (1 - sl.pfa) * hc.se : (all && all.ev ? all.ev.se : 1);
      return { m: ev, n: hc ? hc.n : 0, se, src: hc ? (hc.lvl === 0 || hc.lvl === 3 ? 'рука' : 'класс руки') : 'спот', shift };
    }

    // ---------- точный пуш первым (RFI/ISO): сумма по первому коллеру ----------
    function shoveEV(sp, cards) {
      const h = K.h169(cards[0], cards[1]), tk = sp.tb + sp.kd;
      let pAll = 1, ev = 0, nR = 0;
      const pot = sp.potBefore;
      const others = (sp.others || []).filter(o => o.stack - o.inv > 0.01);
      for (const o of others) {
        const eff = Math.min(sp.stack, o.stack);
        const sB = SP.stackB(Math.min(sp.behind, o.stack - (o.inv || 0)));
        // частота колла этого игрока против пуша: AI-спот с его стороны
        const S = ['AI', sp.st, tk, o.pos, sp.pos, sB, '', 'C0'].join('|');
        const Sb = ['AI', sp.st, tk, SP.posBand(o.pos), SP.posBand(sp.pos), sB, '', 'C0'].join('|');
        const g = 'g' + o.grp;
        const cnt = (pref) => { const c = cellEV(pref + '|call|' + sp.grp) || cellEV(pref + '|call|*'), f = cellEV(pref + '|fold|' + sp.grp) || cellEV(pref + '|fold|*'); return c || f ? { c: c ? c.n : 0, f: f ? f.n : 0 } : null; };
        const fr = cnt(g + '|' + S) || cnt('F|' + S) || cnt('F|' + Sb);
        let pc = fr && fr.c + fr.f >= 10 ? (fr.c + 1) / (fr.c + fr.f + 4) : 0.15; // сглаживание, запасной — 15%
        const R = mixRange(range(model.RC, [g, sp.st, tk, o.pos, sp.pos, sB].join('|')), range(model.RC, ['*', sp.st, tk, SP.posBand(o.pos), SP.posBand(sp.pos), sB].join('|')), pc);
        nR += R.n;
        const eq = K.eqVsRange(EQ, cards, R.r);
        const cH = eff - sp.inv, cO = eff - (o.inv || 0);
        const win = eq * (pot + cH + cO) - cH;
        ev += pAll * pc * win; pAll *= 1 - pc;
      }
      ev += pAll * pot; // все сфолдили — забираем банк
      return { m: ev, n: nR, se: null, src: 'эквити', pFold: pAll, h };
    }
    // ---------- точный колл олл-ина ----------
    function callAllinEV(sp, cards) {
      const tk = sp.tb + sp.kd, sh = sp.ref || {};
      const g = 'g' + (sp.oppGrp || 'unk');
      const ctxS = sh.tbl === 'RFI' || sh.tbl === 'ISO' || !sh.tbl ? 'O' : sh.tbl;
      const sBs = SP.stackB(sh.behind != null ? sh.behind : sp.refBehind || sp.behind);
      const R = mixRange(range(model.RS, [g, ctxS, sp.st, tk, sp.oppPos, sBs].join('|')), range(model.RS, ['*', ctxS, sp.st, tk, SP.posBand(sp.oppPos), sBs].join('|')), 0.25);
      const eq = K.eqVsRange(EQ, cards, R.r);
      const callAmt = Math.min(sp.toCall, sp.stack - sp.inv);
      const excess = Math.max(0, sp.toCall - callAmt);
      const P = sp.potBefore - excess + callAmt;
      return { m: eq * P - callAmt, n: R.n, se: null, src: 'эквити', eq, rangeSrc: R.src };
    }

    // ---------- главное: все варианты для решения ----------
    // sp — объект решения из RMSpots.preflopDecisions (с others) + st, tb, kd; cards — [c,c] или null
    function advise(sp, cards) {
      const acts = ACTS[sp.tbl].filter(a => !(a === 'check' && sp.toCall > 0.001) && !(a === 'shove' && sp.behind > 40) && !(a === 'fold' && sp.toCall <= 0.001 && sp.tbl === 'ISO'));
      const h = cards ? K.h169(cards[0], cards[1]) : null;
      const FT = freqs('T', sp, acts), FF = freqs('F', sp, acts);
      const rows = acts.map((act, q) => {
        const row = { act, ru: RU[act] || act, freqT: FT.f[q], freqF: FF.f[q] };
        if (act === 'fold') return Object.assign(row, { ev: 0, se: 0, src: 'точно', n: null });
        if (cards && act === 'shove' && (sp.tbl === 'RFI' || sp.tbl === 'ISO') && sp.others) { const r = shoveEV(sp, cards); return Object.assign(row, { ev: r.m, se: r.se, src: r.src, n: r.n, pFold: r.pFold }); }
        if (cards && act === 'call' && sp.tbl === 'AI') { const r = callAllinEV(sp, cards); return Object.assign(row, { ev: r.m, se: r.se, src: r.src, n: r.n, eq: r.eq }); }
        const sl = spotLevel('T', sp, act);
        if (cards) { const r = handEV(sp, act, h, sl); if (r) return Object.assign(row, { ev: r.m, se: r.se, src: r.src, n: r.n }); }
        if (sl.ev) return Object.assign(row, { ev: sl.ev.m, se: sl.ev.se, src: cards ? 'спот (руки нет в базе)' : 'диапазон', n: sl.ev.n });
        return Object.assign(row, { ev: null, se: null, src: 'нет данных', n: 0 });
      });
      // лучшее — максимальный EV (фолд = 0 участвует наравне); «нет данных» не выбирается
      let best = rows[0];
      for (const r of rows) if (r.ev !== null && r.ev > best.ev) best = r;
      return { tbl: sp.tbl, pos: sp.pos, hand: h != null ? K.H169[h].label : null, rows, best, freqN: FT.n, freqLvl: FT.lvl };
    }
    // вердикт фактическому действию
    function verdict(adv, act) {
      const r = adv.rows.find(x => x.act === act) || adv.rows.find(x => x.act.split(':')[0] === act.split(':')[0]);
      if (!r || r.ev === null) return { kind: 'нет данных', text: 'нет данных по этому действию' };
      const b = adv.best, d = b.ev - r.ev;
      const noise = 1.96 * Math.sqrt((r.se || 0) ** 2 + (b.se || 0) ** 2) + 0.05;
      if (r === b || d <= 0.05) return { kind: 'лучшее', d: 0, text: 'лучшее действие' };
      if (d <= noise) return { kind: 'близко', d, text: 'близко к лучшему (' + b.ru + ' +' + d.toFixed(2) + ' bb, в пределах шума)' };
      return { kind: 'ошибка', d, text: 'ошибка: −' + d.toFixed(2) + ' bb против «' + b.ru + '»' };
    }
    return { advise, verdict, shoveEV, callAllinEV, topRange, RANK, ACTS, RU };
  }

  // ---------- адаптеры ----------
  // Запись проекта Backing (parseHand): rp как есть. Возвращает решения с полями спота для advise().
  function decisionsBacking(rp, grpOf, fp) {
    const st = SP.stratumOf(fp || '', rp.title), tb = SP.tableOf(rp.n), kd = SP.kindOf(rp);
    return SP.preflopDecisions(rp, grpOf, true).map(d => Object.assign(d, { st, tb, kd }));
  }
  // Запись реплеера MDA Lab (rp: pl [поз, стек BB, …], h, hc, ev [улица, игрок, тип, сумма BB, олл-ин], bd, sh, t):
  // переводим в вид Backing (bb = 1, ники неизвестны — группа 'unk', если не передана своя функция).
  function fromMda(rp, names) {
    return {
      title: rp.t || '', bb: 1, n: rp.pl.length, pl: rp.pl.map(p => [p[0], p[1]]), nm: rp.pl.map((p, i) => (names && names[i]) || (i === rp.h ? 'Hero' : 'P' + i)),
      stacks: rp.pl.map(p => p[1]), ev: rp.ev.map(e => ({ st: e[0], i: e[1], t: e[2], a: e[3], ai: !!e[4] })), sh: rp.sh || {}, bd: rp.bd || [],
      hc: rp.hc ? { [rp.h]: rp.hc } : null, hero: rp.h
    };
  }
  return { create, decisionsBacking, fromMda };
});
