'use strict';
// П.11 ПРОВЕРКА ПОКРЫТИЯ И ЗДРАВОГО СМЫСЛА на полной модели реплеера (app/dist/data/*.js):
// по реальным решениям с известными картами (вскрытия) — откуда взят совет, где «нет данных», премиум-руки в фолд,
// мусор в игру, и «топы vs поле»: если модель права, регам должно доставаться меньше «ошибок», чем фишам.
//   RAW_DIRS=… DIST=app/dist N=60000 node tests/coverage.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const C = require('../pipeline/common.cjs'), K = require('../lib/cards.js'), SP = require('../lib/spots.js'), E8 = require('../engine/engine_v8.js'), CLU = require('../lib/clusters.js');
const DIST = process.env.DIST || path.join(__dirname, '..', 'app', 'dist');
const W = {}; const ctx = vm.createContext({ window: W });
for (const f of ['model', 'eq169', 'sizes', 'lineup', 'players', 'gto_profile']) { const p = path.join(DIST, 'data', f + '.js'); if (fs.existsSync(p) && fs.statSync(p).size) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx); }
const ENG = E8.create(W.RM_MODEL, W.RM_EQ, { sizes: W.RM_SIZES, lineup: W.RM_LINEUP, gto: W.RM_GTO || null });
const PL = W.RM_PLAYERS || {}, pfC = new Map();
function player(room, nick) { const k = room + ':' + nick, p = PL[k]; if (!p) return null; let pf = pfC.get(k); if (!pf) { pf = new Int32Array(315); if (p[5]) for (const s of p[5].split(',')) { const [o, v] = s.split(':'); pf[+o] = +v; } pfC.set(k, pf); } return { cl: p[0], d: p[1], cl2: p[2], hands: p[3], reliable: !!p[4], pf, grp: CLU.GROUP[p[0]] || 'unk' }; }
const parse = C.makeParse(C.loadParser());
const N = +(process.env.N || 60000);
const cnt = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
const S = { dec: 0, src: {}, srcBy: {}, kind: {}, kindByGrp: {}, errBBByGrp: {}, nByGrp: {}, premFold: [], trashPlay: [], noData: {}, gto: 0 };
const PREM = new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo']), TRASH = new Set(['72o', '82o', '83o', '92o', '93o', '62o', '63o', '73o', '42o', '52o', '32o', '43o', '53o']);
const srcOf = (a) => !a ? 'сбой' : /^карты неизвестны/.test(a.rec.why) ? 'без карт' : /^частоты|по частотам/.test(a.rec.why) ? 'частоты топов' : /нет надёжных данных/.test(a.rec.why) ? 'нет данных' : /GTO/.test(a.rec.why) || (a.best && a.best.src === 'GTO-поправка') ? 'EV: GTO-поправка' : /эквити/.test(a.rec.why) ? 'EV: эквити' : /все надёжные варианты хуже/.test(a.rec.why) ? 'фолд: всё хуже' : 'EV: другое';
(async () => {
  const files = C.sourceFiles(); let hands = 0;
  outer: for await (const x of C.iterHands(files)) {
    if (x.end) continue;
    let rp; try { rp = parse(x.hand); } catch (e) { continue; } if (!rp || !rp.n || !rp.bb) continue;
    rp.text = x.hand; const room = C.roomOf(x.hand); if (!C.SHOWDOWN_TRUSTED(room)) continue;
    const sh = rp.sh || {}; if (!Object.keys(sh).some(k => sh[k])) continue;
    hands++;
    const grpOf = (n) => { const p = player(room, n); return p ? p.grp : 'unk'; };
    let ds; try { ds = E8.decisionsBacking(rp, grpOf, '', room, null); } catch (e) { continue; }
    for (const d of ds) {
      const cs = sh[d.i]; const cards = cs ? K.parseCards(String(cs)) : null; if (!cards || cards.length !== 2) continue;
      if (d.act === 'check') continue;
      let a = null, v = null; try { a = ENG.advise(d, cards, (j) => player(room, rp.nm[j])); v = ENG.verdict(a, d.act, d.sz); } catch (e) { cnt(S.src, 'сбой'); continue; }
      S.dec++; const src = srcOf(a), band = SP.bandOf(d.eff), key = d.tbl + ' ' + band;
      cnt(S.src, src); S.srcBy[key] = S.srcBy[key] || {}; cnt(S.srcBy[key], src);
      if (src === 'нет данных') cnt(S.noData, d.tbl + ' ' + band + ' ' + d.kd);
      const g = grpOf(rp.nm[d.i]); cnt(S.kind, v.kind); S.kindByGrp[g] = S.kindByGrp[g] || {}; cnt(S.kindByGrp[g], v.kind); cnt(S.nByGrp, g); if (v.kind === 'ошибка') cnt(S.errBBByGrp, g, v.d || 0);
      const hl = a.hand;
      if (PREM.has(hl) && a.rec.act === 'fold' && d.tbl !== 'AI' && S.premFold.length < 30) S.premFold.push(hl + ' ' + d.tbl + ' ' + d.pos + ' vs ' + d.oppPos + ' ' + d.C + ' ' + d.eff.toFixed(0) + 'bb → ' + a.rec.ru + ' (' + a.rec.why + ')' + (process.env.DBG ? ' ' + JSON.stringify({ rows: a.rows.map(r => [r.act, r.freqT && +r.freqT.toFixed(3), r.freqF && +r.freqF.toFixed(3), r.ev && +r.ev.toFixed(2), r.src, r.reliable]), n: a.freqN, lvl: a.freqLvl, ra: a.range }) : ''));
      if (TRASH.has(hl) && a.rec.act !== 'fold' && a.rec.act !== 'check' && S.trashPlay.length < 40) S.trashPlay.push(hl + ' ' + d.tbl + ' ' + d.pos + ' ' + d.eff.toFixed(0) + 'bb → ' + a.rec.ru + ' (' + a.rec.why + ')');
      if (S.dec >= N) break outer;
    }
  }
  const pct = (o) => { const t = Object.values(o).reduce((a, b) => a + b, 0); return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + (100 * v / t).toFixed(1) + '%').join(', '); };
  console.log('раздач со вскрытием', hands, '| решений с известными картами', S.dec);
  console.log('\nОткуда совет:', pct(S.src));
  console.log('\nПо типам спотов и стекам:'); for (const k of Object.keys(S.srcBy).sort()) { const t = Object.values(S.srcBy[k]).reduce((a, b) => a + b, 0); if (t >= 200) console.log('  ', k.padEnd(16), String(t).padStart(6), '|', pct(S.srcBy[k])); }
  console.log('\nГде чаще «нет данных»:', Object.entries(S.noData).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => k + ' ×' + v).join('; ') || 'нигде');
  console.log('\nВердикты всего:', pct(S.kind));
  console.log('\nВердикты по типам игроков (реальные действия): доля ошибок и потеря на 100 решений');
  for (const g of Object.keys(S.kindByGrp).sort((a, b) => S.nByGrp[b] - S.nByGrp[a])) { const k = S.kindByGrp[g], n = S.nByGrp[g]; console.log('  ', g.padEnd(10), String(n).padStart(6), '| лучшее', (100 * (k['лучшее'] || 0) / n).toFixed(1) + '%', '| ошибка', (100 * (k['ошибка'] || 0) / n).toFixed(1) + '%', '| потеря', (100 * (S.errBBByGrp[g] || 0) / n).toFixed(1), 'bb/100 реш.'); }
  console.log('\nПремиум (AA/KK/QQ/AK) → совет «фолд» не против олл-ина:', S.premFold.length); S.premFold.slice(0, 10).forEach(s => console.log('   ', s));
  console.log('\nМусор (72o, 83o…) → совет играть:', S.trashPlay.length); S.trashPlay.slice(0, 15).forEach(s => console.log('   ', s));
})();
