'use strict';
// ============================================================================
// ПРОХОД v7 — модель префлопа для «умного» реплеера.
//
// Что меняется против passBC_v6 (подробно — docs/АУДИТ_v6.md):
//  1. EV каждого действия считается ОТНОСИТЕЛЬНО ФОЛДА: rel = итог + вложено_до_решения. Фолд = 0 ровно,
//     поэтому правило «играем только +EV» становится верным и в блайндах (колл ББ с −0.4 bb лучше фолда с −1 bb).
//  2. EV с поправкой на олл-ин (как в Hand2Note): если торговля кончилась олл-ином до ривера и карты вскрыты,
//     итог заменяется на эквити × банк. Шум результата падает в разы, смещения нет.
//  3. Раздачи без вскрытия больше не выпадают из оценки руки: EV(действие, рука) =
//        P(все сфолдили | действие) × банк + (1 − P) × EV(рука | действие, банк разыгран).
//     P и банк берутся по ВСЕМ раздачам (от карт не зависят — соперники карт не видят), слой руки — только
//     продолжение розыгрыша (там, где карты и видны).
//  4. Диапазоны олл-инов по 169 рукам: пушащий вскрывается, только если его заколлили — а колл от его карт не
//     зависит, значит вскрытые пуши = честная выборка диапазона пуша. Коллирующий олл-ин вскрывается всегда.
//     По этим диапазонам движок считает EV пуша и колла пуша для конкретной руки точно, через эквити.
//  5. Топы — из половины A базы (passA_v7 → tops_v7), модель меряется по половине B (OOS=1).
//  6. Новые измерения: размер стола (6 / 9), баунти (k / n).
//
// Запуск (у пользователя):  node --max-old-space-size=12288 pipeline/passV7.cjs
//   OOS=1 — мерить только половину B (нужен out/tops_A.json); без OOS — вся база и tops.json из Backing.
//   RESUME=1 — продолжить с чекпоинта (out/v7_state.ndjson пишется после каждого архива).
//   LIMIT=N — остановиться после N рук (проверка).
// Выход: out/model_v7.json
// ============================================================================
const fs = require('fs'), path = require('path');
const C = require('./common.cjs');
const K = require('../lib/cards.js');
const { parseHand, frames } = C.loadParser();

const OOS = process.env.OOS === '1';
const LIMIT = +(process.env.LIMIT || 0);
const readJ = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const topsFile = OOS ? path.join(C.OUT, 'tops_A.json') : (process.env.TOPS || path.join(C.backingOut(), 'tops.json'));
const TOPS = new Set(Object.keys((fs.existsSync(topsFile) ? readJ(topsFile) : { tops: {} }).tops || {}));
// группа игрока: players_cl.json (top/areg/preg/fish) или players_cl2.json (t3, f1…) — берётся первая буква
const grpFile = process.env.GROUPS || ['players_cl2.json', 'players_cl.json'].map(f => path.join(C.backingOut(), f)).find(fs.existsSync);
const GRP = grpFile ? readJ(grpFile) : {};
const G4 = { t: 'top', a: 'areg', p: 'preg', f: 'fish' };
const grpOf = (nick) => { const g = GRP[nick]; return g ? (G4[g[0]] || g) : 'unk'; };
C.log('v7: топов', TOPS.size, '(' + path.basename(topsFile) + ')', 'групп', Object.keys(GRP).length, OOS ? 'OOS: мерим половину B' : 'вся база');

// ---------- накопители ----------
// EV:  ключ → [n, Σrel, Σrel², nFA, ΣrelFA]   (FA — все сфолдили после действия)
// HC:  ключ → [n, Σrel, Σrel²]                 (рука известна, банк разыгран дальше)
// RS/RC: ключ → Int32Array(169)               (диапазоны пуша / колла пуша по вскрытиям)
let EV = new Map(), HC = new Map(), RS = new Map(), RC = new Map();
let stats = { hands: 0, dec: 0, adj: 0, sd: 0, done: [] };
const STATE = path.join(C.OUT, 'v7_state.ndjson');
// чекпоинт — построчный файл (NDJSON): одна строка на ячейку, чтобы не упираться в предел длины строки V8
if (process.env.RESUME === '1' && fs.existsSync(STATE)) {
  const lines = fs.readFileSync(STATE, 'utf8').split('\n');
  for (const ln of lines) {
    if (!ln) continue;
    const [t, k, v] = JSON.parse(ln);
    if (t === 's') stats = v; else if (t === 'e') EV.set(k, v); else if (t === 'h') HC.set(k, v);
    else if (t === 'rs') RS.set(k, Int32Array.from(v)); else if (t === 'rc') RC.set(k, Int32Array.from(v));
  }
  C.log('v7: продолжаю с чекпоинта, рук', stats.hands, 'источников', stats.done.length);
}
function addEV(key, rel, fa) {
  let c = EV.get(key); if (!c) { c = [0, 0, 0, 0, 0]; EV.set(key, c); }
  c[0]++; c[1] += rel; c[2] += rel * rel; if (fa) { c[3]++; c[4] += rel; }
}
function addHC(key, rel) { let c = HC.get(key); if (!c) { c = [0, 0, 0]; HC.set(key, c); } c[0]++; c[1] += rel; c[2] += rel * rel; }
function addR(map, key, h) { let a = map.get(key); if (!a) { a = new Int32Array(169); map.set(key, a); } a[h]++; }

// ---------- проход ----------
(async () => {
  const t0 = Date.now();
  const done = new Set(stats.done);
  const saveState = () => {
    const tmp = STATE + '.tmp', fd = fs.openSync(tmp, 'w');
    let buf = [];
    const put = (row) => { buf.push(JSON.stringify(row)); if (buf.length >= 20000) { fs.writeSync(fd, buf.join('\n') + '\n'); buf = []; } };
    put(['s', '', stats]);
    for (const [k, c] of EV) put(['e', k, c]);
    for (const [k, c] of HC) put(['h', k, c]);
    for (const [k, a] of RS) put(['rs', k, Array.from(a)]);
    for (const [k, a] of RC) put(['rc', k, Array.from(a)]);
    if (buf.length) fs.writeSync(fd, buf.join('\n') + '\n');
    fs.closeSync(fd); fs.renameSync(tmp, STATE);
  };
  let errs = 0, lastSave = Date.now();
  for await (const x of C.iterHands(C.sourceFiles(), done)) {
    if (x.end) { stats.done.push(x.end); if (/\.rar$/i.test(x.end) || Date.now() - lastSave > 600000) { saveState(); lastSave = Date.now(); } if (/\.rar$/i.test(x.end)) C.log('v7: источник пройден', x.end, '— рук', stats.hands, 'ячеек EV', EV.size, 'HC', HC.size); continue; }
    if (LIMIT && stats.hands >= LIMIT) break;
    try {
      const rp = parseHand(x.hand + '\n');
      if (!rp || !rp.n || !rp.bb) continue;
      if (OOS && C.halfOf(rp.handId) !== 'B') continue;
      const fr = frames(rp); if (!fr.length) continue;
      const fin = fr[fr.length - 1], bb = rp.bb;
      const st = C.stratumOf(x.fp, rp.title), tb = C.tableOf(rp.n), kd = C.kindOf(rp);
      const SD = {};
      for (const [k, v] of Object.entries(rp.sh || {})) { const c = K.parseCards(v); if (c && c.length === 2) SD[+k] = { c, h: K.h169(c[0], c[1]) }; }
      if (Object.keys(SD).length) stats.sd++;
      const A = C.netAdjusted(rp, fin, SD); if (A.adj) stats.adj++;
      const decs = C.preflopDecisions(rp, grpOf);
      for (const d of decs) {
        const i = d.i, nick = rp.nm[i];
        const coh = TOPS.has(nick) ? 'T' : 'F', g = 'g' + grpOf(nick);
        const rel = A.net[i] / bb + d.inv; // относительно фолда в этой точке
        const fa = d.act !== 'fold' && d.act !== 'check' && C.foldedAround(rp, d.k, i);
        // ключ спота: TBL|страта|стол|баунти|поз|поз.опп|стек|лимперы|коллеры  (+ |действие|группа.опп)
        const S = [d.tbl, st, tb + kd, d.pos, d.oppPos, d.sB, d.L, d.C].join('|');
        const Sb = '~' + [d.tbl, st, tb + kd, C.posBand(d.pos), d.oppPos ? C.posBand(d.oppPos) : '', d.sB, d.L, d.C].join('|'); // «~» — обобщённый уровень (не путать с точным, если позиции совпали)
        for (const c of [coh, g]) {
          addEV(c + '|' + S + '|' + d.act + '|' + d.oppGrp, rel, fa);
          addEV(c + '|' + S + '|' + d.act + '|*', rel, fa);
        }
        addEV(coh + '|' + Sb + '|' + d.act + '|*', rel, fa); // обобщённый уровень (семейство позиций)
        stats.dec++;
        // слой руки: рука видна → банк разыгран (FA всегда без вскрытия). Для топов и поля раздельно.
        const s = SD[i];
        if (s && !fa && d.act !== 'fold') {
          const cl = K.C12OF[s.h];
          addHC(coh + '|' + Sb + '|' + d.act + '|h' + s.h, rel);
          addHC(coh + '|' + S + '|' + d.act + '|' + cl, rel);
          addHC(coh + '|' + Sb + '|' + d.act + '|' + cl, rel);
          addHC(coh + '|' + Sb + '|' + d.act + '|*', rel); // среднее продолжения по вскрытым — для сдвига вскрытий
        }
        // диапазоны олл-инов (по 169 рукам), по группе игрока
        if (s && d.act === 'shove') {
          const ctxS = d.tbl === 'RFI' || d.tbl === 'ISO' ? 'O' : d.tbl; // O — пуш первым/против лимперов
          addR(RS, [g, ctxS, st, tb + kd, d.pos, d.sB].join('|'), s.h);
          addR(RS, ['*', ctxS, st, tb + kd, C.posBand(d.pos), d.sB].join('|'), s.h);
        }
        if (s && d.tbl === 'AI' && d.act === 'call') {
          addR(RC, [g, st, tb + kd, d.pos, d.oppPos, d.sB, d.L].join('|'), s.h);
          addR(RC, ['*', st, tb + kd, C.posBand(d.pos), C.posBand(d.oppPos), d.sB, d.L].join('|'), s.h);
        }
      }
      stats.hands++;
      if (stats.hands % 1000000 === 0) C.log('v7:', stats.hands, 'рук, решений', stats.dec, 'поправок на олл-ин', stats.adj, ((Date.now() - t0) / 60000).toFixed(1) + ' мин');
    } catch (e) { if (++errs <= 8) C.log('v7 ERR', e.message); }
  }
  saveState();
  // ---------- сериализация ----------
  // Порог — на СПОТ (сумма по действиям), а не на ячейку: иначе редкие действия выпадают и частоты
  // смещаются к частым (в v6 колл пуша мог исчезнуть, и выходило «все фолдят»). Малые ячейки — только счётчик.
  const thrEV = (k) => (k[0] === 'T' ? 8 : k[0] === 'g' ? 25 : 30);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const spotOf = (k) => { const a = k.lastIndexOf('|'), b = k.lastIndexOf('|', a - 1); return k.slice(0, b) + k.slice(a); };
  const tot = new Map();
  for (const [k, c] of EV) { const sk = spotOf(k); tot.set(sk, (tot.get(sk) || 0) + c[0]); }
  const EVo = {};
  for (const [k, c] of EV) {
    const T = tot.get(spotOf(k)) || 0;
    if (T < thrEV(k)) continue;
    if (c[0] < 3) { EVo[k] = [c[0]]; continue; }
    const m = c[1] / c[0], sd = Math.sqrt(Math.max(c[2] / c[0] - m * m, 0));
    EVo[k] = c[3] ? [c[0], r3(m), r3(sd), c[3], r3(c[4] / c[3])] : [c[0], r3(m), r3(sd)];
  }
  const HCo = {};
  for (const [k, c] of HC) {
    if (c[0] < 3) continue;
    const m = c[1] / c[0], sd = Math.sqrt(Math.max(c[2] / c[0] - m * m, 0));
    HCo[k] = [c[0], r3(m), r3(sd)];
  }
  const sparse = (a) => { const o = []; for (let h = 0; h < 169; h++) if (a[h]) o.push(h + ':' + a[h]); return o.join(','); };
  const Ro = (M) => { const o = {}; for (const [k, a] of M) { let s = 0; for (const v of a) s += v; if (s >= 5) o[k] = sparse(a); } return o; };
  const model = { v: 7, meta: { hands: stats.hands, decisions: stats.dec, allinAdjusted: stats.adj, showdownHands: stats.sd, oos: OOS, tops: TOPS.size, built: new Date().toISOString() }, EV: EVo, HC: HCo, RS: Ro(RS), RC: Ro(RC) };
  const outF = process.env.MODEL_OUT || path.join(C.OUT, 'model_v7.json');
  fs.writeFileSync(outF, JSON.stringify(model));
  C.log('v7 ГОТОВО: рук', stats.hands, 'решений', stats.dec, 'олл-ин-поправок', stats.adj, '| ячеек EV', Object.keys(EVo).length, 'HC', Object.keys(HCo).length, 'RS', Object.keys(model.RS).length, 'RC', Object.keys(model.RC).length, '|', (fs.statSync(outF).size / 1048576).toFixed(1), 'МБ', ((Date.now() - t0) / 60000).toFixed(1), 'мин');
})();
