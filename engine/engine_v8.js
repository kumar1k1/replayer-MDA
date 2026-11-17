'use strict';
// ============================================================================
// ДВИЖОК ПОДСКАЗОК v8 (п.8) — по модели passV8 (model_v8.json), таблице эквити 169×169 (eq169.json),
// сайзингам (data/sizes_v8.json, lib/sizing.js) и лайнапу (data/lineup_v8.json, lib/lineup.js).
// Основа и формулы EV — как в v7 (docs/АЛГОРИТМ_v7.md). Что нового:
//  • действие — класс (опен / изо / 3-бет / 4-бет / колл / лимп / пуш); EV выбирает класс, размер даёт lib/sizing.js
//    по топам; если размер ≥30% эфф. стека — рейз заменяется пушем;
//  • P(все сфолдят) после опена и шанс колла пуша — по конкретным игрокам за спиной (их статы → кластер → пул,
//    с поправкой на позицию и размер), а не средняя частота спота;
//  • 3-бет: P(все сфолдят) из спота поправляется на фолд к 3-бету именно этого открывшего;
//  • пуш поверх рейза: частота колла из спота поправляется на склонность конкретного игрока коллировать олл-ины;
//  • стек в ключах — банды владельца по эффективному стеку.
// Работает в браузере (window.RMEngine8) и в Node (require).
// ============================================================================
(function (root, factory) {
  if (typeof module !== 'undefined') module.exports = factory(require('../lib/cards.js'), require('../lib/spots.js'), require('../lib/sizing.js'), require('../lib/lineup.js'));
  else root.RMEngine8 = factory(root.RMCards, root.RMSpots, root.SIZING, root.LINEUP);
})(typeof self !== 'undefined' ? self : this, function (K, SP, SZ, LU) {
  const ERR_BB = 0.5; // «ошибка» — только от 0,5 bb (план D13; подбирается на раздачах владельца)
  const K_SPOT = 60, K_HAND = 40, K_CLASS = 80, ALPHA_R = 12, MIN_HAND_N = 400;
  let DEBUG = null;
  const ACTS = {
    RFI: ['fold', 'limp', 'open', 'shove'],
    ISO: ['fold', 'check', 'limp', 'iso', 'shove'],
    VSO: ['fold', 'call', '3bet', 'shove'],
    VS3: ['fold', 'call', '4bet', 'shove'],
    AI: ['fold', 'call']
  };
  const RU = { fold: 'фолд', limp: 'лимп', check: 'чек', call: 'колл', shove: 'олл-ин', open: 'опен', iso: 'изо', '3bet': '3-бет', '4bet': '4-бет', raise: 'рейз' };
  const KD_RU = { n: 'фризаут', k: 'PKO', m: 'Mystery Bounty' };
  const actClass = (a) => (a === 'raise' ? 'shove' : String(a).split(':')[0]);
  const clamp = (p) => Math.min(0.999, Math.max(0.001, p));
  const oddsMul = (p, r) => { const o = clamp(p) / (1 - clamp(p)) * r; return o / (1 + o); };

  // opts: {sizes: data/sizes_v8.json, lineup: data/lineup_v8.json}
  function create(model, eqTable, opts) {
    // EV неолл-ин действий по вскрытиям (src «рука» / «класс руки») смещён: рука попадает в оценку, только если дошла до вскрытия,
    // а банки, выигранные без вскрытия, теряются (AKo-опен на полной базе: −1,4 bb при n = 3 426). Пока нет поправки (GTO-профиль),
    // такой EV — только справка: «играть или нет» решают частоты топов, а точными остаются фолд, пуш и колл олл-ина (эквити).
    const HC_TRUST = !!(opts && opts.hcTrust);
    // Поправка через GTO-профиль (data/gto_profile.json, 20 млн раздач HRC, карты видны всегда):
    // уровень — реальный EV продолжения спота по ВСЕМ раздачам (карты не нужны), разница между руками — из GTO:
    //   cont(рука) = cont(спот, реально) + [EV_GTO(рука) − средний EV_GTO диапазона] / (1 − P(все сбросят)),  стек — между ближайшими глубинами.
    const GTO = opts && opts.gto && opts.gto.nodes ? opts.gto : null;
    const G_DEPTHS = GTO ? GTO.depths.slice().sort((a, b) => a - b) : [];
    const COMBOS = (h) => { const l = K.H169[h].label; return l.length === 2 ? 6 : l[2] === 's' ? 4 : 12; };
    const H_OF = {}; for (let h = 0; h < 169; h++) H_OF[K.H169[h].label] = h;
    const POS_SEATS = { 2: ['BTN/SB', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['BTN', 'SB', 'BB', 'CO'], 5: ['BTN', 'SB', 'BB', 'UTG', 'CO'], 6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'], 7: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'CO'], 8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'HJ2', 'CO'], 9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'HJ', 'HJ2', 'CO'] };
    function pos8(lbl, ns) { // позиция 8-max HRC по расстоянию до баттона
      if (lbl === 'SB' || lbl === 'BB') return lbl; if (lbl === 'BTN') return 'BU';
      const L = POS_SEATS[ns] || POS_SEATS[9], i = L.indexOf(lbl); if (i < 3) return null;
      const d = L.length - i; return ['BU', 'CO', 'HJ', 'MP', 'EP'][d] || 'UTG';
    }
    const GCLS = { open: 'raise', iso: 'raise', '3bet': 'raise', '4bet': 'raise', limp: 'limp', call: 'call' };
    function gtoNodeKey(sp) {
      const P = pos8(sp.pos, sp.ns), X = sp.oppPos ? pos8(sp.oppPos, sp.ns) : null; if (!P) return null;
      if (sp.tbl === 'RFI') return 'RFI|' + P;
      if (sp.tbl === 'VSO' && X && (sp.C || 'C0') === 'C0') return 'VSO|' + P + '|' + X;
      if (sp.tbl === 'VS3' && X && sp.openI === sp.i && (sp.C || 'C0') === 'C0') return 'VS3|' + P + '|' + X;
      if (sp.tbl === 'ISO' && P === 'BB' && X === 'SB') return 'ISO|BB|SB';
      return null;
    }
    // разница EV руки и среднего диапазона этого действия в GTO (bb), по двум ближайшим глубинам
    function gtoShape(sp, h, act) {
      if (!GTO || h == null) return null;
      const c = GCLS[String(act).split('@')[0]]; if (!c) return null;
      const key = gtoNodeKey(sp); if (!key) return null;
      const e = Math.max(G_DEPTHS[0], Math.min(G_DEPTHS[G_DEPTHS.length - 1], sp.eff || 0));
      let i = 0; while (i < G_DEPTHS.length - 1 && G_DEPTHS[i + 1] < e) i++;
      const d0 = G_DEPTHS[i], d1 = G_DEPTHS[Math.min(i + 1, G_DEPTHS.length - 1)];
      const w1 = d1 === d0 ? 0 : Math.log(e / d0) / Math.log(d1 / d0);
      const one = (d) => {
        const nd = GTO.nodes[d + '|' + key]; if (!nd) return null; const k = nd.acts.indexOf(c); if (k < 0) return null;
        const r = nd.hands[K.H169[h].label]; if (!r || r[k][1] == null) return null;
        let sw = 0, sm = 0; for (const l in nd.hands) { const x = nd.hands[l][k]; if (x[1] == null) continue; const w = COMBOS(H_OF[l]) * x[0]; sw += w; sm += w * x[1]; }
        if (!(sw > 0)) return null;
        return { d: r[k][1] - sm / sw, se: r[k][3] || 0, n: r[k][2], depth: d };
      };
      const a = one(d0), b = d1 !== d0 ? one(d1) : null;
      if (a && b) return { d: (1 - w1) * a.d + w1 * b.d, se: Math.sqrt(((1 - w1) * a.se) ** 2 + (w1 * b.se) ** 2), n: Math.round((1 - w1) * a.n + w1 * b.n), key, depths: d0 + '–' + d1 };
      const x = a && (w1 < 0.5 || !b) ? a : b || a; if (!x) return null;
      if (Math.abs(Math.log((sp.eff || x.depth) / x.depth)) > 0.45) return null; // ближайшая глубина слишком далеко
      return { d: x.d, se: x.se, n: x.n, key, depths: String(x.depth) };
    }
    // EV руки: реальный уровень спота + GTO-форма (вместо смещённого EV по вскрытиям)
    function handEVgto(sp, act, h, sl, pfa, mfa) {
      const g = gtoShape(sp, h, act); if (!g) return null;
      const raw = sl.raw.find(x => x && x.n > (x.nfa || 0)); if (!raw) return null;
      const nc = raw.n - (raw.nfa || 0); if (nc < 30) return null;
      const contAll = (raw.n * raw.m - (raw.nfa || 0) * (raw.mfa || 0)) / nc;
      const pS = Math.min(0.95, sl.pfa || 0);
      const cont = contAll + g.d / (1 - pS);
      const se = Math.sqrt(((raw.sd || 0) / Math.sqrt(nc)) ** 2 + (g.se / (1 - pS)) ** 2) * (1 - pfa);
      return { m: pfa * mfa + (1 - pfa) * cont, se, n: Math.min(nc, g.n), src: 'GTO-поправка', gto: g, contAll };
    }
    opts = opts || {};
    const EQ = eqTable.eq ? Float32Array.from(eqTable.eq, v => v / 10000) : eqTable;
    const EV = model.EV, HC = model.HC;
    const LM = opts.lineup ? LU.create(opts.lineup) : null;
    const SIZES = opts.sizes || null;
    const rCache = new Map();
    function range(map, key) {
      if (rCache.has(key)) return rCache.get(key);
      const s = map[key]; let a = null;
      if (s) { a = new Float64Array(169); for (const p of s.split(',')) { const [h, c] = p.split(':'); a[+h] = +c; } }
      rCache.set(key, a); return a;
    }
    const RANK = (() => {
      const v = K.H169.map((H, h) => { let s = 0, w = 0; for (let r = 0; r < 169; r++) { s += EQ[h * 169 + r] * K.H169[r].combos; w += K.H169[r].combos; } return [h, s / w]; });
      v.sort((a, b) => b[1] - a[1]); return v.map(x => x[0]);
    })();
    function topRange(p) {
      const a = new Float64Array(169); let need = Math.max(0.01, Math.min(1, p)) * 1326;
      for (const h of RANK) { if (need <= 0) break; const c = K.H169[h].combos, take = Math.min(c, need); a[h] = take; need -= take; }
      return a;
    }
    const sum = (a) => { let s = 0; for (const v of a) s += v; return s; };
    const norm = (a) => { const s = sum(a); if (!s) return null; const o = new Float64Array(169); for (let h = 0; h < 169; h++) o[h] = a[h] / s; return o; };
    function mixPrior(cnt, prior, alpha) { const o = new Float64Array(169); for (let h = 0; h < 169; h++) o[h] = cnt[h] + alpha * prior[h]; return o; }
    function mixRange(fine, coarse, fallbackP) {
      const prior = coarse ? norm(coarse) : norm(topRange(fallbackP));
      if (!fine) return { r: coarse ? mixPrior(coarse, norm(topRange(fallbackP)), ALPHA_R) : prior, n: coarse ? sum(coarse) : 0, src: coarse ? 'обобщённо' : 'запасной' };
      return { r: mixPrior(fine, prior, ALPHA_R), n: sum(fine), src: 'точно' };
    }
    const cellEV = (k) => { const c = EV[k]; return c ? { n: c[0], m: c.length > 1 ? c[1] : null, sd: c[2] || 0, nfa: c[3] || 0, mfa: c[4] || 0 } : null; };
    const evOK = (c) => (c && c.m !== null ? c : null);
    const cellHC = (k) => { const c = HC[k]; return c ? { n: c[0], m: c[1], sd: c[2] || 0 } : null; };
    function shrink(cells, k) {
      let m = null, n = 0, sd = 0, lvl = -1;
      for (let q = cells.length - 1; q >= 0; q--) {
        const c = cells[q]; if (!c || !c.n) continue;
        if (m === null) { m = c.m; n = c.n; sd = c.sd; lvl = q; continue; }
        m = (c.n * c.m + k * m) / (c.n + k); n = c.n; sd = c.sd || sd; lvl = q;
      }
      return m === null ? null : { m, n, sd, lvl, se: sd / Math.sqrt(n + k) };
    }
    // ---------- ключи спота (как в passV8: банд эффективного стека) ----------
    function keys(sp) {
      const tk = sp.tb + sp.kd, b = SP.bandOf(sp.eff);
      return {
        S: [sp.tbl, sp.st, tk, sp.pos, sp.oppPos, b, sp.L, sp.C].join('|'),
        Sb: '~' + [sp.tbl, sp.st, tk, SP.posBand(sp.pos), sp.oppPos ? SP.posBand(sp.oppPos) : '', b, sp.L, sp.C].join('|')
      };
    }
    // стадия турнира — слой поверх (план C9): ячейка «Z|стадия|…» стягивается к общей с весом K_STAGE
    const K_STAGE = 200;
    function withStage(sp, coh, key, base) {
      if (!sp.stage) return base;
      const z = cellEV('Z|' + sp.stage + '|' + coh + '|' + key); if (!z || !z.n) return base;
      if (!base || base.m === null || z.m === null) return base;
      const w = z.n / (z.n + K_STAGE);
      return Object.assign({}, base, { m: w * z.m + (1 - w) * base.m, nfa: base.nfa, stageN: z.n });
    }
    function spotLevel(coh, sp, act) {
      const { S, Sb } = keys(sp);
      const c = [cellEV(coh + '|' + S + '|' + act + '|' + sp.oppGrp), withStage(sp, coh, S + '|' + act + '|*', cellEV(coh + '|' + S + '|' + act + '|*')), withStage(sp, coh, Sb + '|' + act + '|*', cellEV(coh + '|' + Sb + '|' + act + '|*'))].map(evOK);
      if (coh === 'T') c.push(evOK(cellEV('F|' + S + '|' + act + '|*')), evOK(cellEV('F|' + Sb + '|' + act + '|*')));
      const ev = shrink(c, K_SPOT);
      const fa = c.find(x => x && x.n >= 20) || c.find(Boolean);
      return { ev, pfa: fa ? fa.nfa / fa.n : 0, mfa: fa && fa.nfa ? fa.mfa : 0, raw: c, pfaSrc: 'спот' };
    }
    function freqs(coh, sp, acts) {
      const { S, Sb } = keys(sp);
      const pick = (pref) => acts.map(a => { const c = cellEV(coh + '|' + pref + '|' + a + '|*'); return c ? c.n : 0; });
      const pickZ = (pref) => acts.map(a => { const c = sp.stage ? cellEV('Z|' + sp.stage + '|' + coh + '|' + pref + '|' + a + '|*') : null; return c ? c.n : 0; });
      let pref = S, v = pick(S); let tot = v.reduce((s, x) => s + x, 0), lvl = 'точно';
      if (tot < 30) { pref = Sb; v = pick(Sb); tot = v.reduce((s, x) => s + x, 0); lvl = 'обобщённо'; }
      let f = v.map(x => (tot ? x / tot : 0)), stageN = 0;
      if (sp.stage && tot) { const z = pickZ(pref), zt = z.reduce((s, x) => s + x, 0); if (zt) { stageN = zt; f = f.map((x, q) => (z[q] + K_STAGE * x) / (zt + K_STAGE)); } }
      return { f, n: tot, lvl, stageN };
    }

    // ---------- лайнап: кто за спиной ----------
    // info(j) → {pf, cl} — счётчики и кластер игрока на месте j (из базы игроков); нет — пул
    function behindOf(sp, info) {
      return (sp.others || []).filter(o => o.stack - o.inv > 0.01).map(o => {
        const I = (info && info(o.j)) || {};
        return { j: o.j, pos: o.pos, band: SP.bandOf(Math.min(o.behind != null ? o.behind : o.stack - o.inv, sp.behind)), pf: I.pf || null, cl: I.cl != null ? I.cl : null, o };
      });
    }
    // персональная поправка: отношение шансов «игрок / пул» в семействе fam для действия a
    function personalOR(fam, band, pos, I, a) {
      if (!LM || !I || (!I.pf && I.cl == null)) return 1;
      const p = LM.prob(fam, band, pos, I.pf || null, I.cl != null ? I.cl : null), q = LM.prob(fam, band, pos, null, null);
      if (!p || !q || !(q[a] > 0) || !(q[a] < 1)) return 1;
      return (clamp(p[a]) / (1 - clamp(p[a]))) / (clamp(q[a]) / (1 - clamp(q[a])));
    }
    // P(все сфолдят) для рейза-класса: опен — по игрокам за спиной; 3-бет — спот × фолд к 3-бету открывшего
    function foldAllFor(sp, act, sl, info, sizeBucket) {
      if (!LM) return null;
      if (act === 'open' && sp.tbl === 'RFI') {
        const B = behindOf(sp, info); if (!B.length) return null;
        const r = LM.foldAll('vso', B, { aggPos: SP.posBand(sp.pos), size: sizeBucket || '*', fmt: sp.kd0 || sp.kd, stage: sp.stage });
        return { p: r.p, src: 'лайнап (' + B.length + ' за спиной)', each: B.map((b, k) => ({ pos: b.pos, fold: r.each[k] ? r.each[k].fold : null, src: r.each[k] ? r.each[k].src : null })) };
      }
      if (act === '3bet' && sp.tbl === 'VSO' && sp.refI >= 0 && sl.pfa > 0) {
        const o = (sp.others || []).find(x => x.j === sp.refI); if (!o) return null;
        const I = (info && info(o.j)) || {};
        const OR = personalOR('vs3', SP.bandOf(Math.min(o.behind, sp.behind)), o.pos, I, 'fold');
        if (OR === 1) return null;
        return { p: oddsMul(sl.pfa, OR), src: 'спот × фолд к 3-бету открывшего (×' + OR.toFixed(2) + ' к шансам)' };
      }
      return null;
    }

    // ---------- EV руки по слою вскрытий (неолл-ин действия) ----------
    function handEV(sp, act, h, sl, pfa, mfa) {
      const { S, Sb } = keys(sp);
      const cl = K.C12OF[h];
      const raw = sl.raw.find(x => x && x.n > (x.nfa || 0));
      const contAll = raw && raw.n > raw.nfa ? (raw.n * raw.m - raw.nfa * raw.mfa) / (raw.n - raw.nfa) : null;
      const shown = cellHC('T|' + Sb + '|' + act + '|*') || cellHC('F|' + Sb + '|' + act + '|*');
      const shift = contAll !== null && shown && shown.n >= 30 ? shown.m - contAll : 0;
      const cells = [];
      for (const coh of ['T', 'F']) cells.push(cellHC(coh + '|' + Sb + '|' + act + '|h' + h), cellHC(coh + '|' + S + '|' + act + '|' + cl), cellHC(coh + '|' + Sb + '|' + act + '|' + cl));
      const hc = shrink(cells.map(c => c && { n: c.n, m: c.m - shift, sd: c.sd }), K_HAND);
      if (!hc) return null;
      let cont = hc.m;
      if (contAll !== null) cont = (hc.n * hc.m + K_CLASS * contAll) / (hc.n + K_CLASS);
      const ev = pfa * mfa + (1 - pfa) * cont;
      return { m: ev, n: hc.n, se: (1 - pfa) * hc.se, src: hc.lvl === 0 || hc.lvl === 3 ? 'рука' : 'класс руки', shift };
    }

    // ---------- баунти PKO (план B) ----------
    // Общепринятое правило: учитывается только прямой баунти — половина баунти соперника, которую получаете сразу;
    // пересчёт в фишки: фишки в игре / (оставшийся баунти-пул + призовой пул) ≈ S / (P + B − (1 − r)·0,59·B),
    // S — стартовый стек, P и B — призовая и баунти-части бай-ина, r — доля оставшихся игроков (на старте 1/4 стека за стартовый баунти).
    // Хедз-ап (осталось 2): последний нокаут — весь баунти соперника + свой. Учитывается, только если герой перекрывает соперника.
    function bountyBB(sp, j) {
      if ((sp.kd0 || sp.kd) !== 'k' || !sp.bounty || !sp.tour || !(sp.tour.S > 0) || !(sp.tour.P > 0) || !(sp.tour.B > 0)) return null;
      const bo = sp.bounty[j]; if (!(bo > 0)) return null;
      const o = (sp.others || []).find(x => x.j === j); if (!o) return null;
      if (sp.stack + 1e-9 < o.stack) return { bb: 0, why: 'соперник перекрывает вас — его баунти не забрать' };
      const T = sp.tour, r = T.r > 0 ? Math.min(1, T.r) : 1;
      const perUsd = T.S / (T.P + T.B - (1 - r) * 0.59 * T.B);
      const hu = T.R === 2, usd = hu ? bo + (sp.bounty[sp.i] || 0) : bo / 2;
      const bb = usd * perUsd / (sp.bbChips || 1);
      return { bb, usd, why: (hu ? 'хедз-ап: весь баунти соперника и ваш' : 'прямой баунти $' + (Math.round(usd * 100) / 100)) + ' ≈ ' + Math.round(bb * 10) / 10 + ' bb' };
    }
    // ---------- точный пуш: сумма по первому коллеру ----------
    function shoveEV(sp, cards, info) {
      const h = K.h169(cards[0], cards[1]), tk = sp.tb + sp.kd;
      let pAll = 1, ev = 0, nR = 0; const bounties = [];
      const Rd = sp.tbl === 'VSO' ? 2 : sp.tbl === 'VS3' ? 3 : 1, Rn = 'R' + Rd;
      const pot = sp.potBefore;
      for (const b of behindOf(sp, info)) {
        const o = b.o, eff = Math.min(sp.stack, o.stack);
        const sB = SP.stackB(Math.min(sp.behind, o.behind != null ? o.behind : o.stack - (o.inv || 0)));
        const g = 'g' + o.grp;
        let pc, pcSrc;
        if (LM && Rd === 1 && !(o.inv > 1.3)) {
          // пуш первым: частота колла конкретного игрока (его статы → кластер → пул + поправка на позицию пушера)
          const r = LM.prob('ai', b.band, o.pos, b.pf, b.cl, { aggPos: SP.posBand(sp.pos), size: '*', fmt: sp.kd0 || sp.kd, stage: sp.stage });
          pc = r ? r.call : 0.15; pcSrc = 'лайнап: ' + (r ? r.src : 'нет');
        } else {
          const S = ['AI', sp.st, tk, o.pos, sp.pos, SP.bandOf(Math.min(sp.behind, o.behind)), Rn, 'C0'].join('|');
          const Sb = '~' + ['AI', sp.st, tk, SP.posBand(o.pos), SP.posBand(sp.pos), SP.bandOf(Math.min(sp.behind, o.behind)), Rn, 'C0'].join('|');
          const cnt = (pref) => { const c = cellEV(pref + '|call|' + sp.grp) || cellEV(pref + '|call|*'), f = cellEV(pref + '|fold|' + sp.grp) || cellEV(pref + '|fold|*'); return c || f ? { c: c ? c.n : 0, f: f ? f.n : 0 } : null; };
          const fr = cnt(g + '|' + S) || cnt('F|' + S) || cnt('F|' + Sb);
          pc = fr && fr.c + fr.f >= 10 ? (fr.c + 1) / (fr.c + fr.f + 4) : 0.15; pcSrc = fr ? 'спот' : 'запасной 15%';
          const OR = personalOR('ai', b.band, o.pos, b, 'call');
          if (OR !== 1) { pc = oddsMul(pc, OR); pcSrc += ' × игрок'; }
        }
        const prior = sp.tbl === 'VS3' && o.j === sp.refI ? 0.08 : (o.inv || 0) > 1.3 ? 0.25 : 1;
        const R = mixRange(range(model.RC, [g, sp.st, tk, o.pos, sp.pos, sB, Rn].join('|')), range(model.RC, ['*', sp.st, tk, SP.posBand(o.pos), SP.posBand(sp.pos), sB, Rn].join('|')), pc * prior);
        nR += R.n;
        let sR = 0, sA = 0; for (let r = 0; r < 169; r++) if (R.r[r]) { sR += R.r[r]; sA += R.r[r] * K.availCombos(r, cards) / K.H169[r].combos; }
        if (sR > 0) pc = Math.min(0.99, pc * (1326 / 1225) * sA / sR);
        const eq = K.eqVsRange(EQ, cards, R.r);
        const cH = eff - sp.inv, cO = eff - (o.inv || 0);
        const bt = bountyBB(sp, o.j), bAdd = bt ? bt.bb : 0; if (bt && bt.bb > 0) bounties.push(o.pos + ': +' + (Math.round(bt.bb * 10) / 10) + ' bb (' + bt.why + ')');
        const win = eq * (pot + cH + cO + bAdd) - cH;
        if (DEBUG) DEBUG.push({ pos: o.pos, pc: +pc.toFixed(3), pcSrc, eq: +eq.toFixed(3), win: +win.toFixed(2), bounty: bAdd, rsrc: R.src });
        ev += pAll * pc * win; pAll *= 1 - pc;
      }
      // калибровка P(все сбросят) на пуш первым по проверке лайнапа на отложенной половине (полный прогон 17.11.2026):
      // до 74% модель точна, выше чуть завышает (83,4 → 81,5; 91,1 → 88,6). Части «колл» масштабируются пропорционально.
      if (Rd === 1 && LM && pAll > 0.741 && pAll < 1) {
        const P = [[0.741, 0.741], [0.834, 0.815], [0.911, 0.886], [1, 0.975]];
        let k = 0; while (k < P.length - 2 && pAll > P[k + 1][0]) k++;
        const [x0, y0] = P[k], [x1, y1] = P[k + 1], pc2 = y0 + (y1 - y0) * (pAll - x0) / (x1 - x0);
        ev *= (1 - pc2) / (1 - pAll); pAll = pc2;
      }
      ev += pAll * pot;
      return { m: ev, n: nR, se: null, src: 'эквити', pFold: pAll, h, bounty: bounties.length ? bounties.join('; ') : null };
    }
    function callAllinEV(sp, cards) {
      const tk = sp.tb + sp.kd, g = 'g' + (sp.oppGrp || 'unk');
      const ctxS = sp.refTbl === 'RFI' || sp.refTbl === 'ISO' || !sp.refTbl ? 'O' : sp.refTbl;
      const sBs = sp.refSB || SP.stackB(sp.refBehind || sp.behind);
      const R = mixRange(range(model.RS, [g, ctxS, sp.st, tk, sp.oppPos, sBs].join('|')), range(model.RS, ['*', ctxS, sp.st, tk, SP.posBand(sp.oppPos), sBs].join('|')), 0.25);
      let eq = K.eqVsRange(EQ, cards, R.r);
      const nc = sp.C === 'C2' ? 2 : sp.C === 'C1' ? 1 : 0;
      for (let q = 0; q < nc; q++) eq *= K.eqVsRange(EQ, cards, norm(topRange(0.12)));
      const callAmt = Math.min(sp.toCall, sp.stack - sp.inv);
      const excess = Math.max(0, sp.toCall - callAmt);
      const P = sp.potBefore - excess * (1 + nc) + callAmt;
      const bt = sp.refI >= 0 ? bountyBB(sp, sp.refI) : null, bAdd = bt ? bt.bb : 0;
      return { bounty: bt ? bt.why : null, bountyBB: bAdd, m: eq * (P + bAdd) - callAmt, n: R.n, se: null, src: nc ? 'эквити (мультивей, приближённо)' : 'эквити', eq, rangeSrc: R.src };
    }

    // ---------- «что топы делают с этой рукой» ----------
    const AGGR = (a) => ({ shove: 0, '4bet': 1, '3bet': 2, open: 3, iso: 3, call: 4, limp: 5, check: 6 })[a] != null ? ({ shove: 0, '4bet': 1, '3bet': 2, open: 3, iso: 3, call: 4, limp: 5, check: 6 })[a] : 9;
    const pctS = (p) => (p < 0.01 ? (p * 100).toFixed(1) : String(Math.round(p * 100)));
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
      // глубже 25 bb пуш — не самое сильное действие диапазона: премиум-руки топы разыгрывают рейзом (3-бет/изо/опен),
      // а пушат руками ниже (пары, Ax), которым неудобно играть против 4-бета. Поэтому на глубоких стеках пуш
      // ставится сразу после рейза-класса; на коротких — первым (там пуш и есть основной рейз).
      const ag = (a) => (a === 'shove' && sp.eff > 25 ? 3.5 : AGGR(a));
      const order = acts.map((a, q) => ({ a, f: F.f[q] })).filter(x => x.f > 0).sort((x, y) => ag(x.a) - ag(y.a));
      let acc = 0;
      for (const x of order) { acc += x.f; if (pct <= acc + 1e-9) return { act: x.a, pct, band: x.f }; }
      return { act: 'fold', pct, band: 0 };
    }

    // ---------- варианты размеров рейза: EV по каждому, как часто их делают топы, фолд соперника ----------
    const SZACT = (act, sp) => (act === 'open' ? 'open' : act === 'iso' ? 'iso' : act === '3bet' ? (sp.C === 'C0' ? '3bet' : 'sqz') : act === '4bet' ? '4bet' : null);
    const CL_RU = { pp_prem: 'старшие пары', pp_mid: 'средние пары', pp_sm: 'мелкие пары', AK: 'AK', ax_str: 'сильные Ax', axs: 'Ax одномастные', axo: 'Ax разномастные', br_conn: 'бродвей', su_conn: 'одномастные коннекторы', su_weak: 'слабые одномастные', off_conn: 'разномастные коннекторы', offsuit: 'слабые разномастные' };
    // как часто сбрасывает тот, против кого действие: опен — все за спиной (лайнап); 3-бет — открывший
    // (по базе для этого размера 3-бета, × его личная склонность сбрасывать на 3-бет)
    function oppFoldFor(sp, act, bucket, m, info, sl) {
      if (act === 'open') { const fa = foldAllFor(sp, 'open', sl, info, bucket); return fa ? { p: fa.p, who: 'все за спиной', src: fa.src } : null; }
      if (act === '3bet' && sp.refI >= 0) {
        const b3 = SZ.bucketOf('3bet', m), tk = sp.tb + sp.kd, bd = SP.bandOf(sp.eff);
        const cnt = (pre) => { const r = {}; let n = 0; for (const a of ['fold', 'call', '4bet', 'shove']) { const c = cellEV(pre + '|' + a); r[a] = c ? c.n : 0; n += r[a]; } return { r, n }; };
        let c = cnt('R|' + [sp.st, tk, SP.posBand(sp.oppPos), SP.posBand(sp.pos), bd, b3].join('|')), lvl = 'точно';
        if (c.n < 30) { c = cnt('R|' + [sp.st, tk, '*', '*', bd, b3].join('|')); lvl = 'обобщённо'; }
        if (c.n < 30) return null;
        let p = (c.r.fold + 1) / (c.n + 2), src = 'база: открывший против 3-бета ' + b3 + ' (' + lvl + ', n=' + c.n + ')';
        const o = (sp.others || []).find(x => x.j === sp.refI);
        if (o) { const OR = personalOR('vs3', SP.bandOf(Math.min(o.behind, sp.behind)), o.pos, (info && info(o.j)) || {}, 'fold'); if (OR !== 1) { p = oddsMul(p, OR); src += ' × его фолд к 3-бету'; } }
        return { p, who: 'открывший (' + sp.oppPos + ')', src, n: c.n };
      }
      return null;
    }
    function sizeVariants(sp, act, cards, h, info) {
      const sa = SZACT(act, sp); if (!sa) return null;
      const { S, Sb } = keys(sp);
      const ctx = { room: sp.room || 'ps', refTo: sp.refTo, prevTo: sa === '4bet' ? sp.openTo : null, nLimp: sp.nLimp, eff: sp.eff, fmt: sp.kd0 || sp.kd };
      const out = []; let totT = 0, totF = 0;
      for (const b of SZ.BUCKETS[sa].names) {
        const A = act + '@' + b, nc = (coh) => ((cellEV(coh + '|' + S + '|' + A + '|*') || cellEV(coh + '|' + Sb + '|' + A + '|*') || { n: 0 }).n);
        const nT = nc('T'), nF = nc('F'); if (nT + nF < 20) continue;
        const m = SZ.repOf(sa, b), to = SZ.toFor(sa, m, ctx);
        const v = { bucket: b, A, to, m, nT, nF, allin: sp.eff > 0 && to >= sp.eff * SZ.COMMIT, ev: null, n: 0, src: 'нет данных' };
        const sl = spotLevel('T', sp, A);
        const of = oppFoldFor(sp, act, b, m, info, sl); v.oppFold = of;
        let pfa = sl.pfa, mfa = sl.mfa;
        if (act === 'open' && of) { pfa = of.p; mfa = sp.potBefore; }
        v.pFold = pfa;
        if (cards) { const g = !HC_TRUST ? handEVgto(sp, A, h, sl, pfa, mfa) : null; const r = g || handEV(sp, A, h, sl, pfa, mfa); if (r) Object.assign(v, { ev: r.m, se: r.se, n: r.n, src: r.src }, g ? { gto: g.gto } : {}); }
        else if (sl.ev) Object.assign(v, { ev: sl.ev.m, se: sl.ev.se, n: sl.ev.n, src: 'диапазон' });
        v.reliable = v.ev !== null && v.n >= MIN_HAND_N && !v.allin && (HC_TRUST || v.src === 'GTO-поправка');
        out.push(v); totT += nT; totF += nF;
      }
      out.forEach(v => { v.shareT = totT ? v.nT / totT : null; v.shareF = totF ? v.nF / totF : null; });
      return out;
    }
    // выбор размера: лучший EV среди надёжных; если надёжных нет — лучший EV среди оценок с n ≥ 50 (предварительно);
    // если и таких нет — самый частый размер у топов (п.6)
    function pickSize(sp, act, vars) {
      const ok = (vars || []).filter(v => !v.allin && v.ev !== null);
      const rel = ok.filter(v => v.reliable), pre = ok.filter(v => v.n >= 50);
      const best = (L) => L.reduce((a, b) => (b.ev > a.ev ? b : a));
      if (rel.length) { const v = best(rel); return { to: v.to, bucket: v.bucket, by: 'ev', why: 'размер с лучшим EV (' + v.bucket + ', n=' + v.n + ')', v }; }
      if (pre.length >= 2) { const v = best(pre); return { to: v.to, bucket: v.bucket, by: 'ev-pre', why: 'размер с лучшим EV — предварительно, мало вскрытий (' + v.bucket + ', n=' + v.n + ')', v }; }
      return null;
    }

    // ---------- размер для рейза-класса ----------
    function sizeFor(sp, act) {
      const a = act === 'open' ? 'open' : act === 'iso' ? 'iso' : act === '3bet' ? (sp.C === 'C0' ? '3bet' : 'sqz') : act === '4bet' ? '4bet' : null;
      if (!a) return null;
      return SZ.recommend({ room: sp.room || 'ps', action: a, band: SP.bandOf(sp.eff), pos: SP.posBand(sp.pos), refTo: sp.refTo, prevTo: a === '4bet' ? sp.openTo : null, nLimp: sp.nLimp, eff: sp.eff, fmt: sp.kd0 || sp.kd }, SIZES);
    }

    // ---------- главное ----------
    // sp — решение из RMSpots.preflopDecisions (с others) + st, tb, kd, room; cards — [c,c] или null; info(j) → {pf, cl}
    // страта (лимиты бай-инов): если в своей страте спот пуст — ближайшая с данными (micro ↔ low ↔ mid ↔ high).
    // Без этого рука с лимита, которого нет в базе, оставалась вовсе без совета.
    const STRATA = ['micro', 'low', 'mid', 'high'];
    function pickStratum(sp, acts) {
      const i0 = STRATA.indexOf(sp.st);
      const order = i0 < 0 ? ['mid', 'low', 'high', 'micro'] : STRATA.slice().sort((a, b) => Math.abs(STRATA.indexOf(a) - i0) - Math.abs(STRATA.indexOf(b) - i0) || STRATA.indexOf(a) - STRATA.indexOf(b));
      const kinds = sp.kd === 'm' ? ['m', 'k', 'n'] : sp.kd === 'k' ? ['k', 'n'] : ['n', 'k'];
      for (const kd of kinds) for (const st of order) { const t = Object.assign({}, sp, { st, kd }); if (freqs('T', t, acts).n >= 30 || freqs('F', t, acts).n >= 30) return { st, kd }; }
      return { st: sp.st, kd: sp.kd };
    }
    function advise(sp0, cards, info) {
      const acts0 = ACTS[sp0.tbl];
      const pk = pickStratum(sp0, acts0), stUsed = pk.st, kdData = pk.kd;
      // формат в ключах модели — с данными; формат турнира для баунти и лайнапа — настоящий
      const sp = stUsed === sp0.st && kdData === sp0.kd ? sp0 : Object.assign({}, sp0, { st: stUsed, kd: kdData, kdReal: sp0.kd });
      if (sp.kdReal) sp.kd0 = sp.kdReal;
      const acts = ACTS[sp.tbl].filter(a => !(a === 'check' && sp.toCall > 0.001) && !(a === 'shove' && sp.eff > 40) && !(a === 'fold' && sp.toCall <= 0.001 && sp.tbl === 'ISO'));
      const h = cards ? K.h169(cards[0], cards[1]) : null;
      const FT = freqs('T', sp, acts), FF = freqs('F', sp, acts);
      const rows = acts.map((act, q) => {
        const row = { act, ru: RU[act] || act, freqT: FT.f[q], freqF: FF.f[q] };
        if (act === 'fold') return Object.assign(row, { ev: 0, se: 0, src: 'точно', n: null });
        let size = sizeFor(sp, act);
        const vars = sizeVariants(sp, act, cards, h, info);
        if (vars && vars.length) {
          row.sizes = vars;
          const pk = pickSize(sp, act, vars);
          if (pk) size = Object.assign({}, size, { to: pk.to, bucket: pk.bucket, by: pk.by, why: pk.why, share: pk.v.shareT != null ? Math.round(pk.v.shareT * 100) : null, src: 'ev', allin: pk.v.allin });
          else if (size) size.why = 'размер — самый частый у топов (' + size.bucket + (size.share ? ', ' + Math.round(size.share) + '%' : '') + '); EV по размерам пока не оценить — мало вскрытий';
          const ch = vars.find(v => v.bucket === (size && size.bucket));
          if (ch && ch.oppFold) row.oppFold = ch.oppFold;
        }
        if (size) { row.size = size; row.ru = RU[act] + ' до ' + size.to + ' bb'; if (size.allin) row.asShove = true; }
        if (cards && act === 'shove' && sp.tbl !== 'AI' && sp.others) { const r = shoveEV(sp, cards, info); return Object.assign(row, { ev: r.m, se: r.se, src: r.src, n: r.n, pFold: r.pFold, bounty: r.bounty }); }
        if (cards && act === 'call' && sp.tbl === 'AI') { const r = callAllinEV(sp, cards); return Object.assign(row, { ev: r.m, se: r.se, src: r.src, n: r.n, eq: r.eq, bounty: r.bounty }); }
        const sl = spotLevel('T', sp, act);
        let pfa = sl.pfa, mfa = sl.mfa, pfaSrc = 'спот';
        const fa = foldAllFor(sp, act, sl, info, size && size.bucket);
        if (fa) { pfa = fa.p; pfaSrc = fa.src; row.lineup = fa.each || null; if (act === 'open') mfa = sp.potBefore; }
        row.pFold = pfa; row.pFoldSrc = pfaSrc;
        if (cards) {
          const g = !HC_TRUST ? handEVgto(sp, act, h, sl, pfa, mfa) : null;
          if (g) return Object.assign(row, { ev: g.m, se: g.se, src: g.src, n: g.n, gto: g.gto, evSpot: sl.ev ? sl.ev.m : null });
          const r = handEV(sp, act, h, sl, pfa, mfa);
          if (r) return Object.assign(row, { ev: r.m, se: r.se, src: r.src, n: r.n, evSpot: sl.ev ? sl.ev.m : null });
          return Object.assign(row, { ev: null, se: null, src: 'нет данных по руке', n: 0, evSpot: sl.ev ? sl.ev.m : null });
        }
        if (sl.ev) return Object.assign(row, { ev: sl.ev.m, se: sl.ev.se, src: 'диапазон', n: sl.ev.n });
        return Object.assign(row, { ev: null, se: null, src: 'нет данных', n: 0 });
      });
      rows.forEach(r => { r.reliable = !r.asShove && (r.act === 'fold' || /^эквити/.test(r.src) || (HC_TRUST && r.ev !== null && (r.src === 'рука' || r.src === 'класс руки') && r.n >= MIN_HAND_N) || (r.src === 'GTO-поправка' && r.ev !== null && r.n >= MIN_HAND_N)); if (!HC_TRUST && (r.src === 'рука' || r.src === 'класс руки')) r.biased = true; });
      let best = rows[0];
      for (const r of rows) if (r.reliable && r.ev > best.ev) best = r;
      const ra = cards ? rangeAct(sp, acts, FT.n >= 30 ? FT : FF, h) : null;
      const rowOf = (a) => rows.find(r => r.act === a);
      let rec;
      const Fsrc = FT.n >= 30 ? FT : FF, who = FT.n >= 30 ? 'топов' : 'поля';
      if (!cards && Fsrc.n >= 30) {
        // карты неизвестны (чужая раздача без вскрытия): EV конкретной руки не посчитать — показываем, как играют топы
        const q = Fsrc.f.reduce((m, v, k) => (v > Fsrc.f[m] ? k : m), 0);
        best = rowOf(acts[q]) || rows[0];
        rec = { act: acts[q], why: 'карты неизвестны — чаще всего ' + who + ' здесь: ' + (RU[acts[q]] || acts[q]) + ' ' + Math.round(Fsrc.f[q] * 100) + '%', byFreq: true, freq: Fsrc.f, freqActs: acts };
      } else if (best.act === 'shove' && sp.eff > 15 && ra && ra.act !== 'shove' && ra.act !== 'fold' && rowOf(ra.act) && !rowOf(ra.act).reliable && !rowOf(ra.act).asShove) {
        best = rowOf(ra.act);
        rec = { act: ra.act, why: 'частоты ' + (FT.n >= 30 ? 'топов' : 'поля') + ': рука в лучших ' + pctS(ra.pct) + '%' };
      } else if (best.act !== 'fold') rec = { act: best.act, why: 'максимальный EV (' + best.src + ')' };
      else {
        let rr = ra && ra.act !== 'fold' ? rowOf(ra.act) : null;
        if (rr && rr.asShove && rowOf('shove')) rr = rowOf('shove'); // рейз этого размера = пуш по смыслу
        if (rr && !rr.reliable) { best = rr; rec = { act: rr.act, why: 'частоты ' + (FT.n >= 30 ? 'топов' : 'поля') + ': рука в лучших ' + pctS(ra.pct) + '%' }; }
        else if (rr && rr.reliable && rr.act === 'shove' && rr.ev < 0) rec = { act: 'fold', why: 'по частотам — рейз, но при таком стеке это пуш, а он хуже фолда' };
        else rec = { act: 'fold', why: rows.some(r => r.reliable && r.act !== 'fold') ? 'все надёжные варианты хуже фолда' : (ra ? 'по частотам базы — фолд (рука в лучших ' + pctS(ra.pct) + '%)' : 'нет надёжных данных') };
      }
      const recRow = rowOf(rec.act);
      if (recRow && recRow.asShove && rowOf('shove')) { rec = { act: 'shove', why: rec.why + '; ' + recRow.size.why }; best = rowOf('shove'); }
      rec.size = recRow && recRow.size && !recRow.asShove ? recRow.size : null;
      rec.ru = rec.size ? RU[rec.act] + ' до ' + rec.size.to + ' bb' : RU[rec.act] || rec.act;
      let compare = null;
      const callR = rowOf('call'), raiseR = ['3bet', 'iso', '4bet', 'open'].map(rowOf).find(r => r && r.size);
      if (callR && raiseR && callR.ev != null) {
        const v = raiseR.sizes && raiseR.sizes.find(x => x.bucket === raiseR.size.bucket);
        const rev = v && v.ev != null ? v.ev : raiseR.ev, rn = v && v.ev != null ? v.n : raiseR.n;
        if (rev != null) compare = { call: callR.ev, callN: callR.n, raise: rev, raiseN: rn, raiseRu: raiseR.ru, diff: rev - callR.ev, reliable: callR.reliable && rn >= MIN_HAND_N };
      }
      let classTops = null;
      if (h != null) {
        const cl = K.C12OF[h], { Sb } = keys(sp); const c = {}; let n = 0;
        for (const a of acts) if (a !== 'fold') { const x = cellHC('T|' + Sb + '|' + a + '|' + cl); c[a] = x ? x.n : 0; n += c[a]; }
        if (n >= 10) classTops = { cls: CL_RU[cl] || cl, n, share: Object.fromEntries(Object.entries(c).map(([a, v]) => [a, v / n])) };
      }
      return { compare, classTops, tbl: sp.tbl, pos: sp.pos, band: SP.bandOf(sp.eff), st: stUsed, stNote: [stUsed !== sp0.st ? 'лимита «' + sp0.st + '» в базе нет — взят ближайший «' + stUsed + '»' : '', kdData !== sp0.kd ? 'по формату «' + KD_RU[sp0.kd] + '» в этом споте мало данных — взят «' + KD_RU[kdData] + '»' : ''].filter(Boolean).join('; ') || null, kd: sp0.kd, kdData, stage: sp0.stage || null, stageN: FT.stageN, hand: h != null ? K.H169[h].label : null, rows, best, rec, range: ra, freqN: FT.n, freqLvl: FT.lvl };
    }
    // вердикт фактическому действию: act — метка из разметки (open:x2.2 / shove / …), sz — корзина сайза (d.sz)
    function verdict(adv, act, sz) {
      const a = actClass(act);
      const sizeNote = () => (adv.rec.size && sz && sz !== adv.rec.size.bucket ? '; сайз: у вас ' + sz + ', у топов ' + adv.rec.size.bucket + ' (до ' + adv.rec.size.to + ' bb)' : '');
      if (adv.rec && /^частоты/.test(adv.rec.why)) {
        if (a === adv.rec.act) return { kind: 'лучшее', d: 0, text: 'совпадает с базой (' + adv.rec.why + ')' + sizeNote() };
        return { kind: 'отклонение', text: 'по базе здесь «' + adv.rec.ru + '» (' + adv.rec.why + ')' };
      }
      const r = adv.rows.find(x => x.act === a);
      const b = adv.best;
      if (adv.rec.byFreq) {
        // без карт: оцениваем, насколько действие типично для топов в этом споте
        const q = adv.rec.freqActs.indexOf(a), f = q >= 0 ? adv.rec.freq[q] : 0;
        if (a === adv.rec.act) return { kind: 'лучшее', d: 0, text: 'самое частое действие топов здесь (' + Math.round(f * 100) + '%)' + sizeNote() };
        if (f >= 0.15) return { kind: 'частое у топов', text: 'топы так играют в ' + Math.round(f * 100) + '% случаев; чаще — «' + adv.rec.ru + '»' };
        return { kind: 'редкое у топов', text: 'топы так играют редко (' + Math.round(f * 100) + '%); обычно — «' + adv.rec.ru + '»' };
      }
      if (adv.rec.act === 'fold' && /^нет надёжных данных/.test(adv.rec.why)) return { kind: 'нет данных', text: 'по этому споту в базе мало данных — оценки нет' };
      if (a === adv.rec.act) return { kind: 'лучшее', d: 0, text: 'лучшее действие (' + adv.rec.why + ')' + sizeNote() };
      if (!r || r.ev === null) return { kind: 'нет данных', text: 'по вашему действию данных нет; по базе — «' + adv.rec.ru + '» (' + adv.rec.why + ')' };
      const d = b.ev - r.ev;
      if (d <= 0.05) return { kind: 'лучшее', d: 0, text: 'не хуже лучшего варианта' };
      if (d < ERR_BB) return { kind: 'близко', d, text: 'близко к лучшему («' + adv.rec.ru + '» +' + d.toFixed(2) + ' bb — меньше ' + ERR_BB + ' bb)' };
      if (!r.reliable) return { kind: 'вероятно хуже', d, text: '«' + adv.rec.ru + '» лучше на ~' + d.toFixed(2) + ' bb (оценка вашего действия неточная: ' + r.src + ', n=' + r.n + ')' };
      const noise = 1.96 * Math.sqrt((r.se || 0) ** 2 + (b.se || 0) ** 2) + 0.05;
      if (d <= noise) return { kind: 'близко', d, text: 'близко к лучшему («' + adv.rec.ru + '» +' + d.toFixed(2) + ' bb, в пределах шума)' };
      return { kind: 'ошибка', d, text: 'ошибка: −' + d.toFixed(2) + ' bb против «' + adv.rec.ru + '»' };
    }
    return { debug: (on) => { DEBUG = on ? [] : null; return DEBUG; }, advise, verdict, shoveEV, callAllinEV, topRange, RANK, ACTS, RU, actClass };
  }
  // ctx (необязательно): { stage, tour: { S, P, B, r, R } } — стадия и сведения о турнире (lib/stage.js, app.js)
  function decisionsBacking(rp, grpOf, fp, room, ctx) {
    const st = SP.stratumOf(fp || '', rp.title), tb = SP.tableOf(rp.n), kd = SP.kindOf(rp, rp.text || '', fp);
    const bounty = bountiesOf(rp);
    return SP.preflopDecisions(rp, grpOf, true).map(d => Object.assign(d, { st, tb, kd, room: room || 'ps', ns: rp.n, bounty, bbChips: rp.bb || 1, stage: ctx && ctx.stage || null, tour: ctx && ctx.tour || null }));
  }
  // баунти по местам из строк «Seat N: ник (стек in chips, $X bounty)»
  function bountiesOf(rp) {
    const t = String(rp.text || ''); if (!/bounty\)/.test(t)) return null;
    const out = new Array(rp.n).fill(0);
    for (const m of t.matchAll(/^Seat \d+: (.+?) \([\d.,]+ in chips, [$€£₮]?([\d.,]+) bounty\)/gm)) { const j = rp.nm.indexOf(m[1]); if (j >= 0) out[j] = parseFloat(m[2].replace(/,/g, '')); }
    return out;
  }
  function fromMda(rp, names) {
    return {
      title: rp.t || '', bb: 1, n: rp.pl.length, pl: rp.pl.map(p => [p[0], p[1]]), nm: rp.pl.map((p, i) => (names && names[i]) || (i === rp.h ? 'Hero' : 'P' + i)),
      stacks: rp.pl.map(p => p[1]), ev: rp.ev.map(e => ({ st: e[0], i: e[1], t: e[2], a: e[3], ai: !!e[4] })), sh: rp.sh || {}, bd: rp.bd || [],
      hc: rp.hc ? { [rp.h]: rp.hc } : null, hero: rp.h
    };
  }
  return { create, decisionsBacking, fromMda, ACTS, actClass };
});
