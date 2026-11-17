'use strict';
// ПРОВЕРКА ТУРНИРОВ без браузера: те же модель и движок, что в реплеере (app/dist/data/*.js).
// Берёт файлы/папки с историями (ваши турниры, «Dealt to»), разбирает все решения героя на префлопе
// и пишет итог по каждому турниру + список ошибок в pipeline/out/ПРОВЕРКА_ТУРНИРОВ.txt
//   node tests/tour_check.cjs <файл или папка> [...]
const fs = require('fs'), path = require('path'), vm = require('vm');
const C = require('../pipeline/common.cjs'), K = require('../lib/cards.js'), E8 = require('../engine/engine_v8.js'), CLU = require('../lib/clusters.js'), STG = require('../lib/stage.js');
const DIST = process.env.DIST || path.join(__dirname, '..', 'app', 'dist');
const W = {}; const ctx = vm.createContext({ window: W });
process.stdout.write('Загружаю модель реплеера (~10–30 с)... ');
for (const f of ['model', 'eq169', 'sizes', 'lineup', 'players', 'gto_profile', 'ranges', 'stage_calib']) { const p = path.join(DIST, 'data', f + '.js'); if (fs.existsSync(p) && fs.statSync(p).size) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx); }
console.log('готово');
const ENG = E8.create(W.RM_MODEL, W.RM_EQ, { sizes: W.RM_SIZES, lineup: W.RM_LINEUP, gto: W.RM_GTO || null, ranges: W.RM_RANGES || null });
const PL = W.RM_PLAYERS || {}, pfC = new Map();
function player(room, nick) { const k = room + ':' + nick, p = PL[k]; if (!p) return null; let pf = pfC.get(k); if (!pf) { pf = new Int32Array(315); if (p[5]) for (const s of p[5].split(',')) { const [o, v] = s.split(':'); pf[+o] = +v; } pfC.set(k, pf); } return { cl: p[0], grp: CLU.GROUP[p[0]] || 'unk', pf }; }
const parse = C.makeParse(C.loadParser());
const files = []; const walk = (p) => { if (!fs.existsSync(p)) { console.log('Нет такого файла/папки: ' + p); return; } if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f)); else if (/\.txt$/i.test(p)) files.push(p); };
for (const a of process.argv.slice(2)) walk(a);
if (!files.length) { console.log('Не найдено ни одного .txt с раздачами. Перетащите файл турнира (или папку) на ПРОВЕРКА.cmd.'); process.exit(1); }
const HANDS = [];
for (const f of files) for (const t of fs.readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n(?=(?:PokerStars Hand #|CoinPoker Hand #))/)) {
  const s = t.trim(); if (!/^(PokerStars|CoinPoker) Hand #/.test(s)) continue;
  let rp = null; try { rp = parse(s); } catch (e) {} if (!rp || !rp.n || !rp.bb) continue;
  rp.text = s; const tm = s.match(/Tournament #(\d+)/);
  HANDS.push({ text: s, rp, room: C.roomOf(s), tid: tm ? tm[1] : '—' });
}
const byT = new Map(); for (const H of HANDS) { if (!byT.has(H.tid)) byT.set(H.tid, []); byT.get(H.tid).push(H); }
const L = []; const out = (s) => { console.log(s); L.push(s); };
const actRu = (a) => { const [c, sz] = String(a).split(':'); return ({ fold: 'фолд', call: 'колл', limp: 'лимп', check: 'чек', open: 'опен', iso: 'изо', '3bet': '3-бет', '4bet': '4-бет', shove: 'олл-ин', raise: 'рейз' })[c] + (sz ? ' ' + sz.replace(/^x/, '') + 'x' : ''); };
const fmt = (v) => (Math.round(v * 100) / 100).toString().replace('.', ',');
let G = { n: 0, kinds: {}, loss: 0 };
for (const [tid, HS] of byT) {
  const T = STG.collect(HS); const parts = String(HS[0].rp.title).replace(/(\d),(\d{3})/g, '$1$2').match(/[$€£₮]([\d.]+)\s*\+\s*[$€£₮]([\d.]+)\s*\+\s*[$€£₮]([\d.]+)/);
  T.P = parts ? +parts[1] : 0; T.B = parts ? +parts[2] : 0;
  const kinds = {}, errs = []; let n = 0, loss = 0, heroNick = null;
  HS.forEach((H, q) => {
    const rp = H.rp, h = rp.hero != null && rp.hero >= 0 ? rp.hero : -1; if (h < 0) return; heroNick = rp.nm[h];
    const hcRaw = rp.hc && typeof rp.hc === 'object' ? rp.hc[h] : rp.hc; const cards = hcRaw ? K.parseCards(String(hcRaw)) : null; if (!cards || cards.length !== 2) return;
    const sa = STG.stageAt(T, STG.tsOf(rp.date), rp.n, W.RM_STAGE_CALIB || null);
    const r = sa ? (sa.exact ? (T.Pb ? Math.min(1, sa.R / (T.Pb / 0.15)) : sa.r) : sa.r) : 1;
    const c = { stage: sa ? sa.stage : null, tour: { S: T.S, P: T.P, B: T.B, r, R: sa && sa.exact ? sa.R : null } };
    const grpOf = (nk) => { const p = player(H.room, nk); return p ? p.grp : 'unk'; };
    let ds; try { ds = E8.decisionsBacking(rp, grpOf, '', H.room, c); } catch (e) { return; }
    for (const d of ds) { if (d.i !== h) continue;
      let a, v; try { a = ENG.advise(d, cards, (j) => player(H.room, rp.nm[j])); v = ENG.verdict(a, d.act, d.sz); } catch (e) { kinds['сбой'] = (kinds['сбой'] || 0) + 1; continue; }
      n++; kinds[v.kind] = (kinds[v.kind] || 0) + 1;
      if (v.kind === 'ошибка') { loss += v.d || 0; errs.push('  раздача #' + (q + 1) + ' (Hand #' + ((/Hand #(\d+)/.exec(H.text) || [])[1] || '?') + '): ' + d.pos + ', ' + fmt(d.eff) + ' BB, ' + a.hand + ' — у вас «' + actRu(d.act) + '», лучше «' + a.rec.ru + '» (−' + fmt(v.d) + ' BB; ' + a.rec.why + ')'); }
    }
  });
  if (!n) continue;
  out('\nТурнир #' + tid + (heroNick ? ', герой ' + heroNick : '') + ' — раздач ' + HS.length + ', решений ' + n);
  out('  ' + Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ') + (loss ? ' | ошибок на ' + fmt(loss) + ' BB' : ''));
  errs.forEach(out);
  G.n += n; G.loss += loss; for (const k in kinds) G.kinds[k] = (G.kinds[k] || 0) + kinds[k];
}
out('\nВСЕГО: турниров ' + byT.size + ', решений героя ' + G.n + ' | ' + Object.entries(G.kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v + ' (' + Math.round(100 * v / Math.max(1, G.n)) + '%)').join(', ') + ' | ошибок на ' + fmt(G.loss) + ' BB (' + fmt(100 * G.loss / Math.max(1, G.n)) + ' BB на 100 решений)');
const of = path.join(C.OUT, 'ПРОВЕРКА_ТУРНИРОВ.txt'); fs.mkdirSync(C.OUT, { recursive: true }); fs.writeFileSync(of, L.join('\r\n'), 'utf8'); console.log('\nСохранено: ' + of);
