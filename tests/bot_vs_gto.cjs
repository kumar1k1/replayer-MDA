'use strict';
// БОТ ПРОТИВ GTO (префлоп): наш движок принимает решения во всех узлах GTO-базы HRC (8-max, равные стеки,
// анте 12%, глубины 10–125 bb) со всеми 169 руками; ответ сравнивается с решением GTO для этой руки.
//  • совпадение — с какой частотой GTO сам делает выбранное нами действие этой рукой (100% — чистое GTO-действие);
//  • грубая ошибка — GTO делает это действие этой рукой реже 5%;
//  • потеря к GTO, bb — EV смеси GTO − EV нашего действия (EV из той же базы HRC, к фолду). Считается, где EV
//    нашего действия известен (фолд — всегда 0); действие вне опоры GTO — отдельно («потеря не оценена»).
// Соперники — неизвестные игроки (как без статистики), турнир — фризаут $50 (страта mid), стадия — нет.
//   node --max-old-space-size=8000 tests/bot_vs_gto.cjs [папка app/dist] → pipeline/out/БОТ_ПРОТИВ_GTO.md
const fs = require('fs'), path = require('path'), vm = require('vm');
const C = require('../pipeline/common.cjs'), K = require('../lib/cards.js'), E8 = require('../engine/engine_v8.js');
const DIST = process.argv[2] || process.env.DIST || path.join(__dirname, '..', 'app', 'dist');
const W = {}; const ctx = vm.createContext({ window: W });
for (const f of ['model', 'eq169', 'sizes', 'lineup', 'gto_profile', 'ranges']) { const p = path.join(DIST, 'data', f + '.js'); if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx); }
const ENG = E8.create(W.RM_MODEL, W.RM_EQ, { sizes: W.RM_SIZES, lineup: W.RM_LINEUP, gto: W.RM_GTO, ranges: W.RM_RANGES });
const G = W.RM_GTO, parse = C.makeParse(C.loadParser());
// места 8-max: порядок хода префлопа
const ORDER = ['UTG', 'EP', 'MP', 'HJ', 'CO', 'BU', 'SB', 'BB'];
const SEAT = { BU: 1, SB: 2, BB: 3, UTG: 4, EP: 5, MP: 6, HJ: 7, CO: 8 };
const SUITS = ['h', 'd', 'c', 's'];
const cardsOf = (lbl) => { const r1 = lbl[0], r2 = lbl[1]; if (lbl.length === 2) return r1 + 'h ' + r2 + 'd'; return lbl[2] === 's' ? r1 + 'h ' + r2 + 'h' : r1 + 'h ' + r2 + 'd'; };
const BB = 100;
function handText(kind, P, X, depth, lbl) {
  const st = depth * BB, ante = BB * 0.125;
  let t = `PokerStars Hand #1: Tournament #1, $50+$5 USD Hold'em No Limit - Level I (${BB / 2}/${BB}) - 2026/01/01 12:00:00 ET\nTable '1 1' 8-max Seat #1 is the button\n`;
  for (const p of ORDER.slice().sort((a, b) => SEAT[a] - SEAT[b])) t += `Seat ${SEAT[p]}: ${p} (${st} in chips)\n`;
  for (const p of ORDER) t += `${p}: posts the ante ${ante}\n`;
  t += `SB: posts small blind ${BB / 2}\nBB: posts big blind ${BB}\n*** HOLE CARDS ***\nDealt to ${P} [${cardsOf(lbl)}]\n`;
  const openTo = (who) => (who === 'SB' ? 3 : depth <= 15 ? 2 : 2.2) * BB;
  const opener = kind === 'VSO' ? X : kind === 'VS3' ? P : null;
  const threeB = kind === 'VS3' ? X : null;
  let cur = BB;
  const act = (p) => {
    if (p === opener) { const to = openTo(p); t += `${p}: raises ${to - cur} to ${to}\n`; cur = to; return; }
    if (p === threeB) { const ip = ORDER.indexOf(p) > ORDER.indexOf(opener) && p !== 'SB' && p !== 'BB'; let to = Math.round(cur * (ip ? 3 : 4)); if (to >= st * 0.4) to = st; t += `${p}: raises ${to - cur} to ${to}${to >= st ? ' and is all-in' : ''}\n`; cur = to; return; }
    t += `${p}: folds\n`;
  };
  // проход: все до героя (в VS3 — круг до героя ещё раз)
  for (const p of ORDER) { if (p === P && kind !== 'VS3') break; if (p === P && kind === 'VS3') { act(p); continue; } act(p); }
  if (kind === 'VS3') { for (const p of ORDER) { if (p === P) break; /* уже сфолдили */ } }
  t += `${P}: folds\n*** SUMMARY ***\nTotal pot 1 | Rake 0\n`;
  return t;
}
const CLS = (a) => ({ open: 'raise', iso: 'raise', '3bet': 'raise', '4bet': 'raise', raise: 'raise', limp: 'limp', call: 'call', check: 'check', fold: 'fold', shove: 'shove' })[a] || a;
const DBG = process.env.DBG === '1';
const res = {}; const CAT = {}, TOT = {}; const worst = [];
let nCalls = 0, fails = 0;
for (const key of Object.keys(G.nodes).filter(k => !process.env.ONLY || new RegExp(process.env.ONLY).test(k))) {
  const [d, kind, P, X] = key.split('|'), depth = +d, nd = G.nodes[key];
  const k = kind + (kind === 'RFI' ? '' : ' против ' + X) + '|' + P; // по позиции
  const R = res[kind + '|' + depth] = res[kind + '|' + depth] || { w: 0, agree: 0, gross: 0, loss: 0, lossW: 0, unk: 0, n: 0 };
  for (const lbl of Object.keys(nd.hands)) {
    const g = nd.hands[lbl], w = lbl.length === 2 ? 6 : lbl[2] === 's' ? 4 : 12;
    // если GTO этой рукой здесь только фолдит и наш ответ тоже фолд — всё равно считаем (это часть стратегии)
    let a = null;
    try {
      const rp = parse(handText(kind, P, X, depth, lbl)); nCalls++;
      const hi = rp.nm.indexOf(P);
      const ds = E8.decisionsBacking(rp, () => 'unk', '', 'ps', { stage: null, tour: { S: 0, P: 50, B: 0, r: 1 } });
      const dd = ds.filter(x => x.i === hi); const dec = kind === 'VS3' ? dd[dd.length - 1] : dd[0];
      if (!dec) { fails++; continue; }
      a = ENG.advise(dec, K.parseCards(cardsOf(lbl)), () => null);
    } catch (e) { fails++; continue; }
    let my = CLS(a.rec.act); if (my === 'raise' && a.rec.size && a.rec.size.allin) my = 'shove';
    let ki = nd.acts.indexOf(my); if (ki < 0 && my === 'raise') ki = nd.acts.indexOf('shove'); if (ki < 0 && my === 'shove') ki = nd.acts.indexOf('raise');
    const f = ki >= 0 ? g[ki][0] : 0;
    // GTO смесь: EV = Σ f·ev (фолд = 0); EV нашего действия — из базы, если GTO его делает этой рукой
    let evMix = 0, ok = true; for (let q = 0; q < nd.acts.length; q++) { if (g[q][0] > 0.01) { if (g[q][1] == null) { ok = false; } else evMix += g[q][0] * g[q][1]; } }
    const evMy = my === 'fold' ? 0 : ki >= 0 && g[ki][1] != null && g[ki][0] > 0.01 ? g[ki][1] : null;
    // категория расхождения: наше действие → основное действие GTO (по комбинациям), по типу спота и глубине
    { const gm = nd.acts.map((x, q) => [x, g[q][0]]).sort((a2, b2) => b2[1] - a2[1])[0][0]; const ck = kind + '|' + (depth <= 20 ? '10-20' : depth <= 40 ? '25-40' : '50-125') + '|' + my + '→' + gm; CAT[ck] = CAT[ck] || { w: 0, ex: [] }; CAT[ck].w += w * (1 - f); if (f < 0.5 && CAT[ck].ex.length < 6) CAT[ck].ex.push(depth + 'bb ' + P + (X ? ' vs ' + X : '') + ' ' + lbl); const tk = kind + '|' + (depth <= 20 ? '10-20' : depth <= 40 ? '25-40' : '50-125'); TOT[tk] = (TOT[tk] || 0) + w; }
    R.w += w; R.n++; R.agree += w * f; if (f < 0.05) R.gross += w;
    // в равновесии все действия из опоры GTO равноценны (разница EV между ними в базе — шум симуляции): потеря 0;
    // фолд там, где GTO играет, — потеря = EV смеси GTO; розыгрыш там, где GTO фолдит, — EV не известен («не оценено»)
    if (f >= 0.05) { R.lossW += w; }
    else if (ok && my === 'fold') { const l = Math.max(0, evMix); R.loss += w * l; R.lossW += w; if (l > 0.3) worst.push([l, depth + 'bb ' + k + ' ' + lbl + ': наш ' + a.rec.act + ', GTO ' + nd.acts.map((x, q) => g[q][0] > 0.01 ? x + ' ' + Math.round(g[q][0] * 100) + '%' : null).filter(Boolean).join(' / ')]); }
    else { R.unk += w; if (DBG) worst.push([0, depth + 'bb ' + k + ' ' + lbl + ': наш ' + a.rec.act + (a.rec.size ? ' до ' + a.rec.size.to : '') + ', GTO ' + nd.acts.map((x, q) => g[q][0] > 0.01 ? x + ' ' + Math.round(g[q][0] * 100) + '%' : null).filter(Boolean).join(' / ') + ' — ' + a.rec.why]); }
  }
}
const pct = (x) => (Math.round(x * 1000) / 10) + '%';
const L = ['# Бот против GTO — префлоп', '', `Узлов GTO: ${Object.keys(G.nodes).length}, решений бота: ${nCalls} (сбоев ${fails}). База GTO: ${G.src}.`, '',
  'Совпадение — с какой частотой GTO сам делает наше действие этой рукой (по комбинациям). Грубые — GTO так почти не играет (<5%). Потеря — сколько bb на решение мы отдаём GTO там, где EV нашего действия есть в базе; «не оценено» — грубые отклонения, для которых в базе нет EV.', '',
  '| спот | глубина | рук | совпадение | грубые | потеря, bb/решение | не оценено |', '|---|---|---|---|---|---|---|'];
const tot = {};
for (const [k, R] of Object.entries(res).sort((a, b) => a[0].split('|')[0].localeCompare(b[0].split('|')[0]) || +a[0].split('|')[1] - +b[0].split('|')[1])) {
  const [kind, depth] = k.split('|');
  L.push(`| ${kind} | ${depth} | ${R.n} | ${pct(R.agree / R.w)} | ${pct(R.gross / R.w)} | ${R.lossW ? (R.loss / R.lossW).toFixed(3) : '—'} | ${pct(R.unk / R.w)} |`);
  const T = tot[kind] = tot[kind] || { w: 0, agree: 0, gross: 0, loss: 0, lossW: 0, unk: 0 }; for (const x of ['w', 'agree', 'gross', 'loss', 'lossW', 'unk']) T[x] += R[x];
}
L.push('', '## Итого по типу спота', '', '| спот | совпадение | грубые | потеря, bb/решение | не оценено |', '|---|---|---|---|---|');
for (const [kind, T] of Object.entries(tot)) L.push(`| ${kind} | ${pct(T.agree / T.w)} | ${pct(T.gross / T.w)} | ${(T.loss / T.lossW).toFixed(3)} | ${pct(T.unk / T.w)} |`);
worst.sort((a, b) => b[0] - a[0]);
L.push('', '## Самые дорогие фолды (GTO играет, потеря > 0.3 bb)', '', ...worst.filter(x => x[0] > 0).slice(0, 60).map(([l, s]) => '- ' + l.toFixed(2) + ' bb — ' + s));
if (DBG) L.push('', '## Розыгрыши там, где GTO фолдит или так не играет', '', ...worst.filter(x => x[0] === 0).map(([, s]) => '- ' + s));
L.push('', '## Где расходимся: наше действие → чаще всего у GTO (доля рук спота, где GTO так не играет)', '', '| спот | стеки | наше → GTO | доля | примеры |', '|---|---|---|---|---|');
for (const [k, c] of Object.entries(CAT).map(([k, c]) => [k, c]).filter(([k]) => { const [, , t] = k.split('|'); const [a, b] = t.split('→'); return a !== b; }).sort((a, b) => b[1].w / TOT[b[0].split('|').slice(0, 2).join('|')] - a[1].w / TOT[a[0].split('|').slice(0, 2).join('|')])) {
  const [kind, band, t] = k.split('|'), share = c.w / TOT[kind + '|' + band]; if (share < 0.01) continue;
  L.push(`| ${kind} | ${band} | ${t.replace('raise', 'рейз').replace('shove', 'пуш').replace('call', 'колл').replace('fold', 'фолд').replace('limp', 'лимп').replace('raise', 'рейз').replace('shove', 'пуш').replace('call', 'колл').replace('fold', 'фолд').replace('limp', 'лимп')} | ${pct(share)} | ${c.ex.join(', ')} |`);
}
const outF = path.join(__dirname, '..', 'pipeline', 'out', 'БОТ_ПРОТИВ_GTO.md'); fs.mkdirSync(path.dirname(outF), { recursive: true }); fs.writeFileSync(outF, L.join('\n'));
console.log(L.slice(0, 12).join('\n')); console.log('...\n' + outF);
