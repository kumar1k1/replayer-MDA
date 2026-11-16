'use strict';
// П.3 СТАТЫ ИГРОКОВ по одной раздаче. Определения — docs/КЛАСТЕРЫ.md (согласованы с владельцем 16.11.2026).
// handStats(rp, frames) → { cl: [[игрок, стат, попадание 0/1], …], pf: [[игрок, ключ префлоп-действия], …] }
//  cl — 11 статов кластера (каждая запись = одна возможность; попадание 1 — действие сделано);
//  pf — каждое префлоп-решение: банд стека | контекст | позиция | позиция соперника | действие (для лайнапа и подсказок).
(function (root, factory) {
  if (typeof module !== 'undefined') module.exports = factory(require('./spots.js'));
  else root.RMStats = factory(root.RMSpots);
})(typeof self !== 'undefined' ? self : this, function (SP) {
  const CL = ['VPIP', 'PFR', 'LimpNSB', '3BetNAI', 'F3Bet', 'WS', 'LS', 'WN', 'LN', 'BetRiverHU', 'FoldRiverBetHU'];
  const isSB = (p) => p === 'SB' || p === 'BTN/SB';

  function handStats(rp, fr) {
    const n = rp.n, cl = [], pf = [];
    const fin = fr[fr.length - 1];
    const decs = SP.preflopDecisions(rp, () => '');
    // ---------- префлоп: VPIP / PFR / Limp nSB / 3Bet nAI / F3Bet ----------
    const had = new Array(n).fill(false), vp = new Array(n).fill(false), pr = new Array(n).fill(false);
    const slots = [], openedPrev = new Array(n).fill(false);
    const first = new Array(n).fill(null), limped = new Array(n).fill(false), opened = new Array(n).fill(false);
    for (const d of decs) {
      const i = d.i;
      had[i] = true;
      if (d.act === 'limp' || d.act === 'call' || /^(open|iso|3bet)|^4bet$|^shove$|^raise$/.test(d.act)) vp[i] = true;
      if (/^(open|iso|3bet)|^4bet$|^shove$|^raise$/.test(d.act)) pr[i] = true;
      // Limp nSB: первое решение игрока, рейзов не было, игрок не на МБ и не на ББ (ББ не лимпит — у него чек)
      if (first[i] === null) {
        first[i] = d;
        if (d.nR === 0 && !isSB(d.pos) && d.pos !== 'BB') cl.push([i, 'LimpNSB', d.act === 'limp' ? 1 : 0]);
      }
      // 3Bet nAI: перед игроком ровно один рейз (не олл-ин); игрок до этого не лимповал (лимп-рейз — не 3-бет).
      // Попадание — 3-бет не олл-ином; 3-бет олл-ином — возможность без попадания («без учёта олл-инов»).
      // Возможность — и против опена олл-ином (так считает Hand2Note: среднее пула 5,01% против 5,11% у тренера;
      // без этих возможностей выходило 5,64%). Сверено с MDA Lab по 81 752 вашим раздачам.
      // Попадание — любой рейз не олл-ином, в том числе изоляционный рейз поверх опена олл-ином.
      if (d.nR === 1 && !limped[i]) cl.push([i, '3BetNAI', (/^3bet/.test(d.act) || (d.act === 'raise' && !d.aiAct)) ? 1 : 0]);
      // F3Bet: игрок открылся (опен-рейз не олл-ином), и следующим к нему пришёл ровно 3-бет (2 рейза в банке)
      if (opened[i] && d.nR === 2) { cl.push([i, 'F3Bet', d.act === 'fold' ? 1 : 0]); opened[i] = false; }
      else if (opened[i]) opened[i] = false; // пришёл 4-бет и выше — не возможность F3Bet
      if (/^open:/.test(d.act)) opened[i] = true;
      if (d.act === 'limp') limped[i] = true;
      // префлоп-таблица действий для лайнапа: банд | контекст | позиция | позиция соперника | лимперы/коллеры | действие
      const sl = pfSlots(d, openedPrev[i]); if (sl) slots.push([i, sl[0], sl[1]]);
      openedPrev[i] = /^open:/.test(d.act);
      const act = d.act.replace(/:.*/, ''); // сайз — отдельно (п.6)
      pf.push([i, [SP.bandOf(d.eff), d.tbl, SP.posBand(d.pos), d.oppPos ? SP.posBand(d.oppPos) : '', d.L || d.C, act].join('|')]);
    }
    for (let i = 0; i < n; i++) if (had[i]) { cl.push([i, 'VPIP', vp[i] ? 1 : 0]); cl.push([i, 'PFR', pr[i] ? 1 : 0]); }

    // ---------- постфлоп 1 на 1: флоп увидели ровно двое, до флопа никто не в олл-ине ----------
    const fl = fr.find(f => f.street === 1);
    if (fl && (rp.bd || []).length >= 3) {
      const inn = []; for (let i = 0; i < n; i++) if (!fl.folded[i]) inn.push(i);
      const preAI = inn.some(i => fl.stacks[i] <= 1e-9) || rp.ev.some(e => e.st === 0 && e.ai);
      if (inn.length === 2 && !preAI) {
        const [a, b] = inn;
        const sd = !fin.folded[a] && !fin.folded[b];
        for (const i of inn) {
          const won = fin.won[i] > 0;
          cl.push([i, 'WS', sd && won ? 1 : 0]); cl.push([i, 'LS', sd && !won ? 1 : 0]);
          cl.push([i, 'WN', !sd && won ? 1 : 0]); cl.push([i, 'LN', !sd && !won ? 1 : 0]);
        }
        // ривер: оба дошли, у игрока есть решение
        const riv = rp.ev.filter(e => e.st === 3 && e.i >= 0 && 'fxcbr'.indexOf(e.t) >= 0);
        if (riv.length && (rp.bd || []).length >= 5) {
          // Bet River HU — у игрока ход, ставок на ривере ещё не было (первый ходящий; второй — если первый прочекал).
          // Fold to River Bet HU — игрок отвечает на первую ставку соперника на ривере.
          let bettor = -1;
          const br = new Set();
          for (const e of riv) {
            if (bettor < 0) {
              if (!br.has(e.i)) { br.add(e.i); cl.push([e.i, 'BetRiverHU', e.t === 'b' ? 1 : 0]); }
              if (e.t === 'b') bettor = e.i;
            } else if (e.i !== bettor) { cl.push([e.i, 'FoldRiverBetHU', e.t === 'f' ? 1 : 0]); break; }
          }
        }
      }
    }
    return { cl, pf, slots };
  }
  // ---------- компактная раскладка префлоп-статов игрока (для лайнапа): 45 счётчиков на банд × 7 бандов ----------
  // RFI (до игрока все сфолдили, не ББ): 5 позиций × [возможн., опен, лимп, пуш]                    0..19
  // против опена без коллеров: ББ / МБ / остальные × [возможн., колл, 3-бет, пуш]                 20..31
  // против опена с коллерами (сквиз-спот): [возможн., колл, рейз/пуш]                                32..34
  // открывший против 3-бета: [возможн., фолд, колл, 4-бет/пуш]                                       35..38
  // против лимперов (ISO): [возможн., изо-рейз, лимп/чек, пуш]                                        39..42
  // против олл-ина: [возможн., колл]                                                                   43..44
  const PF_PER_BAND = 45, NB = SP.BAND_NAMES.length;
  const RFI_POS = { EP: 0, MP: 1, CO: 2, BTN: 3, SB: 4 };
  const PF_SLOTS = PF_PER_BAND * NB;
  function pfSlots(d, openedBefore) { // → [индекс возможности, индекс действия | -1]
    const b = SP.BAND_NAMES.indexOf(SP.bandOf(d.eff)) * PF_PER_BAND, a = d.act;
    const isR = /^(open|iso|3bet)|^4bet$|^raise$/.test(a);
    if (openedBefore && d.nR === 2) { const o = b + 35; return [o, a === 'fold' ? o + 1 : a === 'call' ? o + 2 : (isR || a === 'shove') ? o + 3 : -1]; }
    if (d.tbl === 'RFI' && d.pos !== 'BB') { const pi = RFI_POS[SP.posBand(d.pos)]; if (pi == null) return null; const o = b + pi * 4; return [o, isR ? o + 1 : a === 'limp' ? o + 2 : a === 'shove' ? o + 3 : -1]; }
    if (d.tbl === 'VSO' && d.C === 'C0') { const g = d.pos === 'BB' ? 0 : (d.pos === 'SB' || d.pos === 'BTN/SB') ? 1 : 2, o = b + 20 + g * 4; return [o, a === 'call' ? o + 1 : isR ? o + 2 : a === 'shove' ? o + 3 : -1]; }
    if (d.tbl === 'VSO') { const o = b + 32; return [o, a === 'call' ? o + 1 : (isR || a === 'shove') ? o + 2 : -1]; }
    if (d.tbl === 'ISO') { const o = b + 39; return [o, isR ? o + 1 : (a === 'limp' || a === 'check') ? o + 2 : a === 'shove' ? o + 3 : -1]; }
    if (d.tbl === 'AI') { const o = b + 43; return [o, a === 'call' ? o + 1 : -1]; }
    return null;
  }
  return { CL, handStats, PF_PER_BAND, PF_SLOTS, RFI_POS, pfSlots };
});
