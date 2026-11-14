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
  const ALPHA_R = 12;
  let DEBUG = null; // отладка: массив разбивки пуша по соперникам
  const MIN_HAND_N = 400; // EV руки по вскрытиям считаем надёжным только при таком числе вскрытий  // диапазоны: вес обобщённого диапазона (Дирихле) при смешивании
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

    const cellEV = (k) => { const c = EV[k]; return c ? { n: c[0], m: c.length > 1 ? c[1] : null, sd: c[2] || 0, nfa: c[3] || 0, mfa: c[4] || 0 } : null; };
    const evOK = (c) => (c && c.m !== null ? c : null); // ячейка с одним счётчиком — для частот, не для EV
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
        Sb: '~' + [sp.tbl, sp.st, tk, SP.posBand(sp.pos), sp.oppPos ? SP.posBand(sp.oppPos) : '', sp.sB, sp.L, sp.C].join('|')
      };
    }
    // EV действия по спот-уровню и частота у когорты
    function spotLevel(coh, sp, act) {
      const { S, Sb } = keys(sp);
      const c = [cellEV(coh + '|' + S + '|' + act + '|' + sp.oppGrp), cellEV(coh + '|' + S + '|' + act + '|*'), cellEV(coh + '|' + Sb + '|' + act + '|*')].map(evOK);
      if (coh === 'T') c.push(evOK(cellEV('F|' + S + '|' + act + '|*')), evOK(cellEV('F|' + Sb + '|' + act + '|*'))); // топов мало — тянем к полю
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
      if (!hc) return null; // по руке нет ни одного вскрытия ни на одном уровне — не выдумываем (правило: нет данных → не играем)
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
      const Rn = 'R' + (sp.tbl === 'VSO' ? 2 : sp.tbl === 'VS3' ? 3 : 1); // каким по счёту рейзом будет наш пуш
      const pot = sp.potBefore;
      const others = (sp.others || []).filter(o => o.stack - o.inv > 0.01);
      for (const o of others) {
        const eff = Math.min(sp.stack, o.stack);
        const sB = SP.stackB(Math.min(sp.behind, o.behind != null ? o.behind : o.stack - (o.inv || 0))); // как в конвейере: стеки после блайндов/анте
        // частота колла этого игрока против пуша: AI-спот с его стороны
        const S = ['AI', sp.st, tk, o.pos, sp.pos, sB, Rn, 'C0'].join('|');
        const Sb = '~' + ['AI', sp.st, tk, SP.posBand(o.pos), SP.posBand(sp.pos), sB, Rn, 'C0'].join('|');
        const g = 'g' + o.grp;
        const cnt = (pref) => { const c = cellEV(pref + '|call|' + sp.grp) || cellEV(pref + '|call|*'), f = cellEV(pref + '|fold|' + sp.grp) || cellEV(pref + '|fold|*'); return c || f ? { c: c ? c.n : 0, f: f ? f.n : 0 } : null; };
        const fr = cnt(g + '|' + S) || cnt('F|' + S) || cnt('F|' + Sb);
        let pc = fr && fr.c + fr.f >= 10 ? (fr.c + 1) / (fr.c + fr.f + 4) : 0.15; // сглаживание, запасной — 15%
        // запасной диапазон «лучшие p%» должен учитывать, что игрок уже сузил диапазон своим рейзом:
        // 3-бетящий — ~8% рук, открывший — ~25%, ещё не входивший в банк — 100%
        const prior = sp.tbl === 'VS3' && o.j === sp.refI ? 0.08 : (o.inv || 0) > 1.3 ? 0.25 : 1;
        const R = mixRange(range(model.RC, [g, sp.st, tk, o.pos, sp.pos, sB, Rn].join('|')), range(model.RC, ['*', sp.st, tk, SP.posBand(o.pos), SP.posBand(sp.pos), sB, Rn].join('|')), pc * prior);
        nR += R.n;
        // блокеры: наши карты убирают часть комбинаций его диапазона колла → он коллирует реже.
        // P(колл | наши карты) = P(колл) × (1326/1225) × Σ R·avail/combos / Σ R
        let sR = 0, sA = 0; for (let r = 0; r < 169; r++) if (R.r[r]) { sR += R.r[r]; sA += R.r[r] * K.availCombos(r, cards) / K.H169[r].combos; }
        if (sR > 0) pc = Math.min(0.99, pc * (1326 / 1225) * sA / sR);
        const eq = K.eqVsRange(EQ, cards, R.r);
        const cH = eff - sp.inv, cO = eff - (o.inv || 0);
        const win = eq * (pot + cH + cO) - cH;
        if (DEBUG) DEBUG.push({ pos: o.pos, pc: +pc.toFixed(3), eq: +eq.toFixed(3), win: +win.toFixed(2), cH: +cH.toFixed(2), cO: +cO.toFixed(2), fr, rsrc: R.src });
        ev += pAll * pc * win; pAll *= 1 - pc;
      }
      ev += pAll * pot; // все сфолдили — забираем банк
      return { m: ev, n: nR, se: null, src: 'эквити', pFold: pAll, h };
    }
    // ---------- точный колл олл-ина ----------
    function callAllinEV(sp, cards) {
      const tk = sp.tb + sp.kd;
      const g = 'g' + (sp.oppGrp || 'unk');
      // диапазон пушащего — из ЕГО спота: пуш первым (O), пуш против опена (VSO), против 3-бета (VS3)
      const ctxS = sp.refTbl === 'RFI' || sp.refTbl === 'ISO' || !sp.refTbl ? 'O' : sp.refTbl;
      const sBs = sp.refSB || SP.stackB(sp.refBehind || sp.behind);
      const R = mixRange(range(model.RS, [g, ctxS, sp.st, tk, sp.oppPos, sBs].join('|')), range(model.RS, ['*', ctxS, sp.st, tk, SP.posBand(sp.oppPos), sBs].join('|')), 0.25);
      let eq = K.eqVsRange(EQ, cards, R.r);
      // коллеры до нас (C1/C2): их руки тоже в борьбе. Приближение: вероятность обыграть всех ≈ произведение
      // эквити против каждого; диапазон колла — по обобщённой таблице коллов, запасной — лучшие 12%.
      const nc = sp.C === 'C2' ? 2 : sp.C === 'C1' ? 1 : 0;
      for (let q = 0; q < nc; q++) eq *= K.eqVsRange(EQ, cards, norm(topRange(0.12)));
      const callAmt = Math.min(sp.toCall, sp.stack - sp.inv);
      const excess = Math.max(0, sp.toCall - callAmt);
      const P = sp.potBefore - excess * (1 + nc) + callAmt;
      return { m: eq * P - callAmt, n: R.n, se: null, src: nc ? 'эквити (мультивей, приближённо)' : 'эквити', eq, rangeSrc: R.src };
    }

    // ---------- диапазон топов по частотам: «что топы делают с этой рукой» ----------
    // Частоты действий топов в споте известны по ВСЕМ раздачам (карты не нужны). Раскладываем их по рейтингу рук:
    // самые сильные — самое агрессивное действие, дальше пассивные, хвост — фолд (линейный диапазон).
    // Рейтинг: эквити против случайной руки (первым в банк) или против диапазона рейзера «лучшие p%».
    const AGGR = (a) => a === 'shove' ? 0 : a === '4bet' ? 1 : /^(3bet|open|iso):x3\.5/.test(a) ? 2 : /^(3bet|open|iso):x2\.7/.test(a) ? 3 : /^(open|iso):x2\.2/.test(a) ? 4 : /^open:x2\.0/.test(a) ? 5 : a === 'call' ? 6 : a === 'limp' ? 7 : a === 'check' ? 8 : 9;
    const rankCache = new Map();
    function rankFor(p) {
      if (!p) return RANK;
      const key = Math.round(p * 100); if (rankCache.has(key)) return rankCache.get(key);
      const R = norm(topRange(p)); const v = K.H169.map((H, h) => { let e = 0; for (let r = 0; r < 169; r++) if (R[r]) e += R[r] * EQ[h * 169 + r]; return [h, e]; });
      v.sort((a, b) => b[1] - a[1]); const out = v.map(x => x[0]); rankCache.set(key, out); return out;
    }
    function rangeAct(sp, acts, F, h) {
      if (F.n < 30) return null;
      const oppP = sp.tbl === 'VSO' ? 0.25 : sp.tbl === 'VS3' ? 0.1 : sp.tbl === 'AI' ? 0.3 : 0;
      const rank = rankFor(oppP);
      let cum = 0, pct = 0; for (const r of rank) { cum += K.H169[r].combos; if (r === h) { pct = cum / 1326; break; } }
      const order = acts.map((a, q) => ({ a, f: F.f[q] })).filter(x => x.f > 0).sort((x, y) => AGGR(x.a) - AGGR(y.a));
      let acc = 0;
      for (const x of order) { acc += x.f; if (pct <= acc + 1e-9) return { act: x.a, pct, band: x.f }; }
      return { act: 'fold', pct, band: 0 };
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
        if (cards && act === 'shove' && sp.tbl !== 'AI' && sp.others) { const r = shoveEV(sp, cards); return Object.assign(row, { ev: r.m, se: r.se, src: r.src, n: r.n, pFold: r.pFold }); }
        if (cards && act === 'call' && sp.tbl === 'AI') { const r = callAllinEV(sp, cards); return Object.assign(row, { ev: r.m, se: r.se, src: r.src, n: r.n, eq: r.eq }); }
        const sl = spotLevel('T', sp, act);
        if (cards) {
          const r = handEV(sp, act, h, sl);
          if (r) return Object.assign(row, { ev: r.m, se: r.se, src: r.src, n: r.n, evSpot: sl.ev ? sl.ev.m : null });
          // руку знаем, а данных по ней нет: EV диапазона только справкой, в выбор лучшего не идёт
          return Object.assign(row, { ev: null, se: null, src: 'нет данных по руке', n: 0, evSpot: sl.ev ? sl.ev.m : null });
        }
        if (sl.ev) return Object.assign(row, { ev: sl.ev.m, se: sl.ev.se, src: cards ? 'спот (руки нет в базе)' : 'диапазон', n: sl.ev.n });
        return Object.assign(row, { ev: null, se: null, src: 'нет данных', n: 0 });
      });
      // надёжные оценки: фолд, точные расчёты через эквити, EV по руке/классу при n ≥ MIN_HAND_N.
      // EV по вскрытиям для неолл-ин действий смещён (tests/validate_bias.cjs) — при малом n решает диапазон топов.
      rows.forEach(r => { r.reliable = r.act === 'fold' || /^эквити/.test(r.src) || (r.ev !== null && (r.src === 'рука' || r.src === 'класс руки') && r.n >= MIN_HAND_N); });
      let best = rows[0];
      for (const r of rows) if (r.reliable && r.ev > best.ev) best = r;
      const ra = cards ? rangeAct(sp, acts, FT.n >= 30 ? FT : FF, h) : null;
      // решение: 1) надёжный EV лучше фолда → он; 2) иначе, если частоты базы для этой руки дают действие,
      // по которому EV ненадёжен или нет, → по частотам; 3) иначе фолд (правило владельца: нет данных → не играем)
      let rec;
      if (best.act === 'shove' && sp.behind > 15 && ra && ra.act !== 'shove' && ra.act !== 'fold' && !(rows.find(r => r.act === ra.act) || {}).reliable) {
        // глубже 15 bb пуш — единственное, что считается точно, но топы тут чаще играют меньшим рейзом/коллом:
        // советуем их действие, пуш показываем справкой (иначе модель тянула бы к пушам только потому, что их можно посчитать)
        best = rows.find(r => r.act === ra.act);
        rec = { act: ra.act, why: 'частоты ' + (FT.n >= 30 ? 'топов' : 'поля') + ': рука в лучших ' + Math.round(ra.pct * 100) + '%; пуш тоже +' + rows.find(r => r.act === 'shove').ev.toFixed(2) + ' bb' };
      } else if (best.act !== 'fold') rec = { act: best.act, why: 'максимальный EV (' + best.src + ')' };
      else {
        const rr = ra && ra.act !== 'fold' ? rows.find(r => r.act === ra.act) : null;
        if (rr && !rr.reliable) { best = rr; rec = { act: ra.act, why: 'частоты ' + (FT.n >= 30 ? 'топов' : 'поля') + ': рука в лучших ' + Math.round(ra.pct * 100) + '%' }; }
        else rec = { act: 'fold', why: rows.some(r => r.reliable && r.act !== 'fold') ? 'все надёжные варианты хуже фолда' : (ra ? 'по частотам базы — фолд (рука в лучших ' + Math.round(ra.pct * 100) + '%)' : 'нет надёжных данных') };
      }
      return { tbl: sp.tbl, pos: sp.pos, hand: h != null ? K.H169[h].label : null, rows, best, rec, range: ra, freqN: FT.n, freqLvl: FT.lvl };
    }
    // вердикт фактическому действию
    function verdict(adv, act) {
      const base = (a) => a.split(':')[0];
      if (adv.rec && /^частоты/.test(adv.rec.why)) { // решение — по диапазону топов, EV по руке ненадёжен
        if (act === adv.rec.act) return { kind: 'лучшее', d: 0, text: 'совпадает с базой (' + adv.rec.why + ')' };
        if (base(act) === base(adv.rec.act)) return { kind: 'близко', text: 'то же действие, другой сайз: по базе — «' + (RU[adv.rec.act] || adv.rec.act) + '»' };
        return { kind: 'отклонение', text: 'по базе здесь «' + (RU[adv.rec.act] || adv.rec.act) + '» (' + adv.rec.why + ')' };
      }
      const r = adv.rows.find(x => x.act === act) || adv.rows.find(x => base(x.act) === base(act));
      const b = adv.best, recRu = RU[adv.rec.act] || adv.rec.act;
      if (act === adv.rec.act) return { kind: 'лучшее', d: 0, text: 'лучшее действие (' + adv.rec.why + ')' };
      if (!r || r.ev === null) return { kind: 'нет данных', text: 'по вашему действию данных нет; по базе — «' + recRu + '» (' + adv.rec.why + ')' };
      const d = b.ev - r.ev;
      if (d <= 0.05) return { kind: 'лучшее', d: 0, text: 'не хуже лучшего варианта' };
      if (!r.reliable) return { kind: 'вероятно хуже', d, text: '«' + recRu + '» лучше на ~' + d.toFixed(2) + ' bb (оценка вашего действия неточная: ' + r.src + ', n=' + r.n + ')' };
      const noise = 1.96 * Math.sqrt((r.se || 0) ** 2 + (b.se || 0) ** 2) + 0.05;
      if (d <= noise) return { kind: 'близко', d, text: 'близко к лучшему («' + recRu + '» +' + d.toFixed(2) + ' bb, в пределах шума)' };
      return { kind: 'ошибка', d, text: 'ошибка: −' + d.toFixed(2) + ' bb против «' + recRu + '»' };
    }
    return { debug: (on) => { DEBUG = on ? [] : null; return DEBUG; }, advise, verdict, shoveEV, callAllinEV, topRange, RANK, ACTS, RU };
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
