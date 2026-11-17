// GTO-профиль рук для поправки смещения EV по вскрытиям: из gto/out/8max_<стек>.json → data/gto_profile.json
// Узлы: RFI «P|-», ответ на опен «P|X:rA», ответ на 3-бет опенера «X|X:rA Y:rB», BB против лимпа SB «BB|SB:c».
// По каждой руке и классу действия (fold / call|limp / raise / shove): частота GTO, EV относительно фолда (bb), число раздач, ст. ошибка.
const fs = require('fs'), path = require('path');
const IN = process.argv[2] || path.join(__dirname, 'out'), OUTF = process.argv[3] || path.join(__dirname, '..', 'data', 'gto_profile.json');
const POS8 = ['UTG', 'EP', 'MP', 'HJ', 'CO', 'BU', 'SB', 'BB'];
const MIN_N = +(process.env.GTO_MIN_N || 60);
const cls = (c, node) => c === 'f' ? 'fold' : c === 'x' ? 'check' : c === 'c' ? (node.rfi ? 'limp' : 'call') : c === 'j' ? 'shove' : 'raise';
function nodeOut(nd, rfi) {
  // fold-EV одинаков для всех рук (потеря анте/блайнда) — берём среднее по узлу
  const fi = nd.act.indexOf('f'); let fs_ = 0, fn = 0;
  if (fi >= 0) for (const h in nd.hands) { const r = nd.hands[h]; if (r.n[fi]) { fs_ += r.ev[fi] * r.n[fi]; fn += r.n[fi]; } }
  const fEV = fn ? fs_ / fn : null; if (fEV === null) return null;
  const A = ['fold', rfi ? 'limp' : 'call', 'raise', 'shove'], out = { acts: A, hands: {}, n: 0 };
  for (const h in nd.hands) {
    const r = nd.hands[h], agg = A.map(() => ({ n: 0, s: 0, q: 0 }));
    nd.act.forEach((c, i) => { const k = A.indexOf(cls(c, { rfi })); if (k < 0 || !r.n[i]) return; const n = r.n[i], m = r.ev[i], sd = r.sd[i] || 0; agg[k].n += n; agg[k].s += m * n; agg[k].q += (sd * sd + m * m) * n; });
    const N = agg.reduce((s, x) => s + x.n, 0); if (!N) continue; out.n += N;
    // [частота, EV от фолда, n, ст.ошибка] по каждому классу действия; EV только при n ≥ MIN_N
    out.hands[h] = agg.map((x, k) => { const f = +(x.n / N).toFixed(4); if (k === 0) return [f, 0, x.n, 0]; if (x.n < MIN_N) return [f, null, x.n, null]; const m = x.s / x.n, sd = Math.sqrt(Math.max(0, x.q / x.n - m * m)); return [f, +(m - fEV).toFixed(3), x.n, +(sd / Math.sqrt(x.n)).toFixed(3)]; });
  }
  return out;
}
const mainRaise = (nd) => { let best = null, bn = -1; nd.act.forEach((c, i) => { if (/^r/.test(c) && nd.total[i] > bn) { bn = nd.total[i]; best = c; } }); return best; };
const prof = { v: 1, src: 'HRC selfplay 8-max, равные стеки, анте 12%, ChipEV', depths: [], nodes: {} };
for (const f of fs.readdirSync(IN).filter(f => /^8max_\d+bb\.json$/.test(f))) {
  const D = JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8')), d = D.depth, N = D.data; prof.depths.push(d);
  const put = (key, nd, rfi) => { if (!nd) return; const o = nodeOut(nd, rfi); if (o && o.n) prof.nodes[d + '|' + key] = o; };
  for (const P of POS8) {
    if (P === 'BB') continue;
    const rfiNode = N[P + '|-']; put('RFI|' + P, rfiNode, true);
    if (!rfiNode) continue;
    const rA = mainRaise(rfiNode); if (!rA) continue;
    for (const Q of POS8.slice(POS8.indexOf(P) + 1)) {
      const vso = N[Q + '|' + P + ':' + rA]; put('VSO|' + Q + '|' + P, vso, false);
      if (!vso) continue;
      const rB = mainRaise(vso); if (!rB) continue;
      put('VS3|' + P + '|' + Q, N[P + '|' + P + ':' + rA + ' ' + Q + ':' + rB], false);
    }
  }
  put('ISO|BB|SB', N['BB|SB:c'], false);
}
prof.depths.sort((a, b) => a - b);
fs.writeFileSync(OUTF, JSON.stringify(prof));
console.log('GTO-профиль:', OUTF, '| стеки', prof.depths.join(', '), '| узлов', Object.keys(prof.nodes).length, '|', (fs.statSync(OUTF).size / 1048576).toFixed(1), 'МБ');
