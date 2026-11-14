'use strict';
// Карты, 169 стартовых рук, 12 классов (как в v6), быстрая оценка 7 карт, эквити рука-против-диапазона.
// Работает и в Node (require), и в браузере (window.RMCards).
// Карта — число 0..51: ранг = c >> 2 (0 = двойка … 12 = туз), масть = c & 3 (c d h s).
(function (root, factory) {
  if (typeof module !== 'undefined') module.exports = factory();
  else root.RMCards = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RK = '23456789TJQKA', SU = 'cdhs';
  const cid = (s) => { const r = RK.indexOf(s[0]), u = SU.indexOf(s[1]); return r < 0 || u < 0 ? -1 : r * 4 + u; };
  const cstr = (c) => RK[c >> 2] + SU[c & 3];
  const parseCards = (x) => {
    const a = Array.isArray(x) ? x : String(x || '').trim().split(/\s+/);
    const out = a.map(cid);
    return out.length && out.every(c => c >= 0) && new Set(out).size === out.length ? out : null;
  };

  // ---------- 169 рук ----------
  // индекс: пары 0..12 (22..AA), одномастные и разномастные — по старшему/младшему рангу
  const H169 = []; // {label, hi, lo, s: 'p'|'s'|'o', combos}
  const IDX = {};
  for (let r = 0; r < 13; r++) { IDX[RK[r] + RK[r]] = H169.length; H169.push({ label: RK[r] + RK[r], hi: r, lo: r, s: 'p', combos: 6 }); }
  for (let hi = 1; hi < 13; hi++) for (let lo = 0; lo < hi; lo++) {
    IDX[RK[hi] + RK[lo] + 's'] = H169.length; H169.push({ label: RK[hi] + RK[lo] + 's', hi, lo, s: 's', combos: 4 });
    IDX[RK[hi] + RK[lo] + 'o'] = H169.length; H169.push({ label: RK[hi] + RK[lo] + 'o', hi, lo, s: 'o', combos: 12 });
  }
  function h169(c1, c2) {
    const r1 = c1 >> 2, r2 = c2 >> 2;
    if (r1 === r2) return IDX[RK[r1] + RK[r1]];
    const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    return IDX[RK[hi] + RK[lo] + ((c1 & 3) === (c2 & 3) ? 's' : 'o')];
  }
  // все комбинации руки (пары карт)
  function combosOf(h) {
    const H = H169[h], out = [];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      if (H.s === 'p') { if (b <= a) continue; out.push([H.hi * 4 + a, H.hi * 4 + b]); }
      else if (H.s === 's') { if (a !== b) continue; out.push([H.hi * 4 + a, H.lo * 4 + b]); }
      else { if (a === b) continue; out.push([H.hi * 4 + a, H.lo * 4 + b]); }
    }
    return out;
  }
  // сколько комбинаций руки h доступно, если на руках/столе лежат карты dead
  function availCombos(h, dead) {
    let n = 0; for (const [a, b] of combosOf(h)) if (!dead.includes(a) && !dead.includes(b)) n++;
    return n;
  }

  // ---------- 12 классов (совместимость с v6: hcOf в passBC_v6) ----------
  const CLASS12 = ['pp_prem', 'pp_mid', 'pp_sm', 'AK', 'ax_str', 'axs', 'axo', 'br_conn', 'su_conn', 'su_weak', 'off_conn', 'offsuit'];
  function class12(h) {
    const { hi, lo, s } = H169[h];
    if (s === 'p') return hi >= 8 ? 'pp_prem' : hi >= 5 ? 'pp_mid' : 'pp_sm';
    if (hi === 12) { if (lo === 11) return 'AK'; if (lo >= 10) return 'ax_str'; return s === 's' ? 'axs' : 'axo'; }
    if (lo >= 8) return 'br_conn';
    const gap = hi - lo - 1;
    if (s === 's') return gap <= 2 ? 'su_conn' : 'su_weak';
    return gap <= 2 ? 'off_conn' : 'offsuit';
  }
  const C12OF = H169.map((_, h) => class12(h));

  // ---------- оценка 7 карт ----------
  // результат — число: категория * 13^5 + кикеры (больше — сильнее)
  const P5 = 371293; // 13^5
  function topBits(m, k) { let v = 0; for (let r = 12; r >= 0 && k > 0; r--) if (m & (1 << r)) { v = v * 13 + r; k--; } while (k-- > 0) v *= 13; return v; }
  function straightTop(m) {
    // m — маска рангов; туз также младший
    const x = m | ((m >> 12) & 1 ? 0 : 0);
    for (let t = 12; t >= 4; t--) { const w = 31 << (t - 4); if ((x & w) === w) return t; }
    if ((m & 0x100f) === 0x100f) return 3; // A2345
    return -1;
  }
  const cnt = new Int8Array(13), sc = new Int8Array(4), sm = new Int32Array(4);
  function eval7(cs, len) {
    cnt.fill(0); sc.fill(0); sm.fill(0);
    let rm = 0;
    for (let i = 0; i < len; i++) { const c = cs[i], r = c >> 2, s = c & 3; cnt[r]++; sc[s]++; sm[s] |= 1 << r; rm |= 1 << r; }
    let fs = -1; for (let s = 0; s < 4; s++) if (sc[s] >= 5) fs = s;
    if (fs >= 0) {
      const st = straightTop(sm[fs]);
      if (st >= 0) return 8 * P5 + st;
      return 5 * P5 + topBits(sm[fs], 5);
    }
    let q = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1;
    for (let r = 12; r >= 0; r--) {
      const k = cnt[r];
      if (k === 4) q = r;
      else if (k === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
      else if (k === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
    }
    if (q >= 0) return 7 * P5 + q * 13 + topBits(rm & ~(1 << q), 1) / 1;
    if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) return 6 * P5 + t1 * 13 + (t2 > p1 ? t2 : p1);
    const st = straightTop(rm);
    if (st >= 0) return 4 * P5 + st;
    if (t1 >= 0) return 3 * P5 + t1 * 169 + topBits(rm & ~(1 << t1), 2);
    if (p1 >= 0 && p2 >= 0) return 2 * P5 + p1 * 169 + p2 * 13 + topBits(rm & ~(1 << p1) & ~(1 << p2), 1);
    if (p1 >= 0) return 1 * P5 + p1 * 2197 + topBits(rm & ~(1 << p1), 3);
    return topBits(rm, 5);
  }

  // ---------- эквити конкретных рук (точный перебор на флопе/тёрне, Монте-Карло на префлопе) ----------
  // hands: [[c,c],[c,c],...], board: [c...] (0/3/4/5 карт). Возвращает массив долей банка (дележ учтён).
  let SEED = 0x2545F491;
  function rnd() { SEED ^= SEED << 13; SEED >>>= 0; SEED ^= SEED >> 17; SEED ^= SEED << 5; SEED >>>= 0; return SEED / 4294967296; }
  function equity(hands, board, samples) {
    const nh = hands.length, used = new Uint8Array(52);
    for (const h of hands) for (const c of h) used[c] = 1;
    for (const c of board) used[c] = 1;
    const deck = []; for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);
    const need = 5 - board.length, eq = new Float64Array(nh), cs = new Array(7), vals = new Float64Array(nh);
    const b = board.slice(); let runs = 0;
    const score = () => {
      let m = -1, w = 0;
      for (let i = 0; i < nh; i++) { cs[0] = hands[i][0]; cs[1] = hands[i][1]; for (let j = 0; j < 5; j++) cs[2 + j] = b[j]; vals[i] = eval7(cs, 7); if (vals[i] > m) { m = vals[i]; w = 1; } else if (vals[i] === m) w++; }
      for (let i = 0; i < nh; i++) if (vals[i] === m) eq[i] += 1 / w;
      runs++;
    };
    if (need === 0) score();
    else if (need === 1) { for (const x of deck) { b[4] = x; score(); } }
    else if (need === 2) { for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) { b[3] = deck[i]; b[4] = deck[j]; score(); } }
    else {
      const N = samples || 600, L = deck.length;
      for (let k = 0; k < N; k++) {
        // частичная перетасовка: need карт
        for (let j = 0; j < need; j++) { const r = j + Math.floor(rnd() * (L - j)); const t = deck[j]; deck[j] = deck[r]; deck[r] = t; b[board.length + j] = deck[j]; }
        score();
      }
    }
    for (let i = 0; i < nh; i++) eq[i] /= runs;
    return Array.from(eq);
  }

  // ---------- эквити руки против диапазона по таблице 169×169 ----------
  // EQ — Float32Array(169*169) или массив: EQ[a*169+b] = эквити a против b (префлоп).
  // range — массив 169 весов (например, число увиденных рук в шоудаунах). Блокеры учитываются
  // через доступные комбинации: вес руки r умножается на avail(r | наши карты) / combos(r).
  function eqVsRange(EQ, myCards, range) {
    const h = h169(myCards[0], myCards[1]);
    let W = 0, S = 0;
    for (let r = 0; r < 169; r++) {
      const w0 = range[r]; if (!w0) continue;
      const w = w0 * availCombos(r, myCards) / H169[r].combos;
      if (!w) continue;
      W += w; S += w * EQ[h * 169 + r];
    }
    return W > 0 ? S / W : null;
  }

  return { RK, SU, cid, cstr, parseCards, H169, IDX, h169, combosOf, availCombos, CLASS12, class12, C12OF, eval7, equity, eqVsRange, rnd };
});
