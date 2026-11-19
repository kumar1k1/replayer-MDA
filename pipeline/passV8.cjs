'use strict';
// ============================================================================
// ПРОХОД v8 — модель префлопа (п.8). Основа — passV7 (docs/АЛГОРИТМ_v7.md), изменения:
//  1. Группа игрока — из кластеров тренера (out/players_cl_v8.json → reg / nit / fish / superfish; нет — unk).
//  2. Топы перекрёстно: раздача половины A считается «топовой», если игрок в tops_B (отобран по половине B),
//     и наоборот. Удача, по которой игрока отобрали, в его же раздачи не попадает, а база используется вся.
//  3. Стек в ключах EV — банды владельца (<12 … 150+) по эффективному стеку. Диапазоны пуша и колла (RS/RC)
//     остаются на мелкой сетке (s1…s15): пуш 4 bb и 11 bb — разные диапазоны, банд <12 их бы смешал.
//  4. Действие — класс без сайза (open / iso / 3bet / 4bet / call / limp / shove): EV выбирает класс,
//     размер — lib/sizing.js по топам (п.6). «Эффективный олл-ин» (ставка покрывает эфф. стек) — это shove.
// Запуск: TOPS=out/tops_v8.json PLAYERS_CL=out/players_cl_v8.json node --max-old-space-size=12288 pipeline/passV8.cjs
//   RESUME=1 — продолжить с чекпоинта; LIMIT=N — первые N рук.
// Выход: out/model_v8.ndjson (построчно, см. C.saveModel / C.loadModel)
// ============================================================================
const fs = require('fs'), path = require('path');
const C = require('./common.cjs');
const K = require('../lib/cards.js');
const CLU = require('../lib/clusters.js');
const SZ = require('../lib/sizing.js');
const P_ = C.loadParser(), { frames } = P_, parseHand = C.makeParse(P_);
const LIMIT = +(process.env.LIMIT || 0);
const readJ = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const topsFile = process.env.TOPS || path.join(C.OUT, 'tops_v8.json');
const TJ = fs.existsSync(topsFile) ? readJ(topsFile) : { A: {}, B: {} };
const TOPS = { A: new Set(Object.keys(TJ.A || {})), B: new Set(Object.keys(TJ.B || {})), A5: new Set(Object.keys(TJ.A5 || {})), B5: new Set(Object.keys(TJ.B5 || {})) };
// топы-2 (≥ 5 bb/100, включая топов-1) — ячейки «U|…»: движок берёт их, если у топов-1 (≥ 8) в споте мало рук
// топы по формату: свои, если их не меньше MIN_TOPS_FMT в обеих половинах; иначе — общие
const MIN_TOPS_FMT = +(process.env.MIN_TOPS_FMT || 50);
const TOPSF = {};
for (const f of ['n', 'k', 'm']) { const t = (TJ.byFmt || {})[f]; if (t && Object.keys(t.A).length >= MIN_TOPS_FMT && Object.keys(t.B).length >= MIN_TOPS_FMT) TOPSF[f] = { A: new Set(Object.keys(t.A)), B: new Set(Object.keys(t.B)), A5: new Set(Object.keys(t.A5 || {})), B5: new Set(Object.keys(t.B5 || {})) }; }
// ход турниров — для стадии (lib/stage.js); STAGE_EST=1 — оценивать стадию и там, где мест вылета нет (по решению владельца)
const STG = require('../lib/stage.js');
const tournFile = process.env.TOURN || path.join(C.OUT, 'tourn_v8.json');
const TOURN = fs.existsSync(tournFile) ? readJ(tournFile) : {};
const STAGE_EST = process.env.STAGE_EST === '1';
const clFile = process.env.PLAYERS_CL || path.join(C.OUT, 'players_cl_v8.json');
const CL = fs.existsSync(clFile) ? readJ(clFile) : {};
const grpOfK = (room, nick) => { const c = CL[C.playerKey(room, nick)]; return c ? CLU.GROUP[c[0]] || 'unk' : 'unk'; };
// топ для раздачи половины h — отобран по другой половине
const isTop = (room, nick, h, kd) => { const T = TOPSF[kd] || TOPS; return (h === 'A' ? T.B : T.A).has(C.playerKey(room, nick)); };
const isTop5 = (room, nick, h, kd) => { const T = TOPSF[kd] || TOPS; if (!T.A5) return false; return (h === 'A' ? T.B5 : T.A5).has(C.playerKey(room, nick)); };
const ROOM_LAYER = new Set((process.env.ROOM_LAYER || 'wpn,ipoker').split(',').filter(Boolean));
const actClass = (d) => (d.act === 'shove' || d.aiEff ? 'shove' : d.act.split(':')[0]);
C.log('v8: топов A', TOPS.A.size, 'B', TOPS.B.size, '| по формату:', Object.keys(TOPSF).join(',') || 'нет (общие)', '| турниров', Object.keys(TOURN).length, '| игроков с кластером', Object.keys(CL).length);

// ---------- накопители ----------
// EV:  ключ → [n, Σrel, Σrel², nFA, ΣrelFA]   (FA — все сфолдили после действия)
// HC:  ключ → [n, Σrel, Σrel²]                 (рука известна, банк разыгран дальше)
// RS/RC: ключ → Int32Array(169)               (диапазоны пуша / колла пуша по вскрытиям)
let EV = new Map(), HC = new Map(), RS = new Map(), RC = new Map();
let IDS = new C.IdSet(); let stats_broken = 0;
let stats = { hands: 0, dec: 0, adj: 0, sd: 0, done: [] };
const STATE = path.join(C.OUT, 'v8_state.ndjson'), IDSF = path.join(C.OUT, 'v8_ids.bin');
function addEV(key, rel, fa) {
  let c = EV.get(key); if (!c) { c = [0, 0, 0, 0, 0]; EV.set(key, c); }
  c[0]++; c[1] += rel; c[2] += rel * rel; if (fa) { c[3]++; c[4] += rel; }
}
function addHC(key, rel) { let c = HC.get(key); if (!c) { c = [0, 0, 0]; HC.set(key, c); } c[0]++; c[1] += rel; c[2] += rel * rel; }
function addR(map, key, h) { let a = map.get(key); if (!a) { a = new Int32Array(169); map.set(key, a); } a[h]++; }

// ---------- проход ----------
(async () => {
  const t0 = Date.now(); let mergedAny = false;
  // чекпоинт — построчный файл, читается потоково (на полной базе — сотни МБ); плюс список встреченных раздач (повторы)
  if (process.env.RESUME === '1' && fs.existsSync(STATE) && fs.existsSync(IDSF)) {
    await C.ndRead(STATE, ([t, k, v]) => {
      if (t === 's') stats = v; else if (t === 'e') EV.set(k, v); else if (t === 'h') HC.set(k, v);
      else if (t === 'rs') RS.set(k, Int32Array.from(v)); else if (t === 'rc') RC.set(k, Int32Array.from(v));
    });
    IDS = C.loadIds(IDSF); stats_broken = stats.broken || 0;
    C.log('v8: продолжаю с чекпоинта, рук', stats.hands, 'источников', stats.done.length);
  }
  if (process.env.SHARD_TAG) stats.shardTag = process.env.SHARD_TAG;
  // MERGE_SHARDS — сложить состояния параллельных потоков (ячейки EV/HC/RS/RC складываются: суммы и счётчики)
  for (const dir of (process.env.MERGE_SHARDS || '').split(';').filter(Boolean)) {
    const SF = path.join(dir, 'v8_state.ndjson'), IF = path.join(dir, 'v8_ids.bin'); if (!fs.existsSync(SF)) continue;
    let sst = null; const add = (M, k, v) => { const c = M.get(k); if (!c) { M.set(k, v); return; } for (let i = 0; i < v.length; i++) c[i] += v[i]; };
    stats.mergedTags = stats.mergedTags || [];
    { const h0 = JSON.parse(C.firstLine(SF))[2]; if (!h0.shardTag || stats.mergedTags.includes(h0.shardTag)) { C.log('v8: поток ' + dir + ' уже сложен — пропускаю'); continue; } }
    await C.ndRead(SF, ([t, k, v]) => {
      if (t === 's') { sst = v; return; }
      if (t === 'e') add(EV, k, v); else if (t === 'h') add(HC, k, v); else if (t === 'rs') add(RS, k, Int32Array.from(v)); else if (t === 'rc') add(RC, k, Int32Array.from(v));
    });
    for (const x of ['hands', 'dec', 'adj', 'sd', 'dups', 'dealt', 'broken', 'mysteryCut']) stats[x] = (stats[x] || 0) + (sst[x] || 0);
    stats_broken = stats.broken;
    stats.stages = stats.stages || {}; for (const [k2, v2] of Object.entries(sst.stages || {})) stats.stages[k2] = (stats.stages[k2] || 0) + v2;
    stats.done.push(...sst.done); stats.mergedTags.push(sst.shardTag);
    if (fs.existsSync(IF)) IDS.mergeFrom(C.loadIds(IF));
    C.log('v8: сложен поток', dir, '— рук всего', stats.hands, 'ячеек EV', EV.size);
    mergedAny = true;
  }
  const done = new Set(stats.done);
  // сохранение — только на границе архива: иначе при продолжении архив прошёлся бы заново и часть раздач посчиталась бы дважды
  const saveState = () => {
    stats.broken = stats_broken;
    const w = C.ndWriter(STATE);
    w.put(['s', '', stats]);
    for (const [k, c] of EV) w.put(['e', k, c]);
    for (const [k, c] of HC) w.put(['h', k, c]);
    for (const [k, a] of RS) w.put(['rs', k, Array.from(a)]);
    for (const [k, a] of RC) w.put(['rc', k, Array.from(a)]);
    w.close(); C.saveIds(IDS, IDSF);
  };
  let errs = 0;
  const part = C.partLimiter(); let unsaved = false;
  for await (const x of C.iterHands(C.sourceFiles(), done)) {
    if (x.end) {
      stats.done.push(x.end); const ck = stats.done.length % C.CK_EVERY === 0; C.progress('model', stats.done.length);
      const hit = part.hit(); if (ck || hit) saveState(); unsaved = !(ck || hit);
      C.log('v8: источник пройден', x.end, '— рук', stats.hands, 'ячеек EV', EV.size, 'HC', HC.size, ck || hit ? '(чекпоинт)' : '');
      if (hit) { C.log('v8: часть готова — запустите снова'); process.exit(C.PART_EXIT); }
      continue;
    }
    if (LIMIT && stats.hands >= LIMIT) break;
    try {
      const rp = parseHand(x.hand);
      if (!rp || !rp.n || !rp.bb) continue;
      const room = C.roomOf(x.hand);
      if (!IDS.add(room, rp.handId)) { stats.dups = (stats.dups || 0) + 1; continue; } // повтор раздачи (h2n3/h2n4, пересечения архивов)
      const fr = frames(rp); if (!fr.length) continue;
      const fin = fr[fr.length - 1], bb = rp.bb;
      if (!C.handIntact(rp, fin, x.hand)) { stats_broken++; continue; } // повреждённая история (банк не сходится)
      const st = C.stratumOf(x.fp, rp.title), tb = C.tableOf(rp.n), kd = C.kindOf(rp, x.hand, x.fp), half = C.halfOf(rp.handId);
      const SD = {};
      if (C.SHOWDOWN_TRUSTED(room)) for (const [k, v] of Object.entries(rp.sh || {})) { const c = K.parseCards(v); if (c && c.length === 2) SD[+k] = { c, h: K.h169(c[0], c[1]) }; }
      if (Object.keys(SD).length) stats.sd++;
      const A = C.netAdjusted(rp, fin, SD); if (A.adj) stats.adj++;
      // стадия турнира: точная (места вылета) или оценка (если разрешено STAGE_EST)
      let stage = null;
      { const tm = /Tournament #(\d+)/.exec(x.hand), T = tm && TOURN[room + ':' + tm[1]];
        const sa = T ? STG.stageAt(T, STG.tsOf(rp.date), rp.n) : null;
        if (sa && (sa.exact || STAGE_EST)) stage = sa.stage;
        stats.stages = stats.stages || {}; const sk = sa ? (sa.exact ? sa.stage : 'оценка:' + sa.stage) : 'нет'; stats.stages[sk] = (stats.stages[sk] || 0) + 1; }
      // Mystery Bounty: только раздачи, доказанно сыгранные до призовой зоны; в призовых (и если стадию не узнать) — пропуск
      if (kd === 'm' && process.env.MYSTERY_ITM !== 'keep') { const tm = /Tournament #(\d+)/.exec(x.hand), T = tm && TOURN[room + ':' + tm[1]]; if (!T || !STG.preITM(T, STG.tsOf(rp.date), rp.n)) { stats.mysteryCut = (stats.mysteryCut || 0) + 1; continue; } }
      const grpOf = (nick) => grpOfK(room, nick);
      const decs = C.preflopDecisions(rp, grpOf);
      for (const d of decs) {
        const i = d.i, nick = rp.nm[i], act = actClass(d), bnd = C.bandOf(d.eff);
        const coh = isTop(room, nick, half, kd) ? 'T' : 'F', g = 'g' + grpOf(nick);
        const CO = coh === 'T' || isTop5(room, nick, half, kd) ? [coh, 'U'] : [coh]; // U — топы ≥ 5 (с топами-1)
        const rel = A.net[i] / bb + d.inv; // относительно фолда в этой точке
        const fa = act !== 'fold' && act !== 'check' && C.foldedAround(rp, d.k, i);
        // ключ спота: TBL|страта|стол|баунти|поз|поз.опп|стек|лимперы|коллеры  (+ |действие|группа.опп)
        const S = [d.tbl, st, tb + kd, d.pos, d.oppPos, bnd, d.L, d.C].join('|');
        const Sb = '~' + [d.tbl, st, tb + kd, C.posBand(d.pos), d.oppPos ? C.posBand(d.oppPos) : '', bnd, d.L, d.C].join('|'); // «~» — обобщённый уровень (не путать с точным, если позиции совпали)
        for (const c of [...CO, g]) {
          addEV(c + '|' + S + '|' + act + '|' + d.oppGrp, rel, fa);
          addEV(c + '|' + S + '|' + act + '|*', rel, fa);
        }
        for (const c of CO) addEV(c + '|' + Sb + '|' + act + '|*', rel, fa); // обобщённый уровень (семейство позиций)
        // слой рума (владелец, 18.11.2026): у новых румов — свои ячейки топов и регов «T@wpn|…», «greg@ipoker|…»;
        // движок берёт их первыми для раздач этого рума, а при малой выборке — общие (все румы)
        if (ROOM_LAYER.has(room)) {
          for (const c of [coh === 'T' ? 'T' : null, CO.length > 1 ? 'U' : null, g === 'greg' ? 'greg' : null]) if (c) { addEV(c + '@' + room + '|' + S + '|' + act + '|*', rel, fa); addEV(c + '@' + room + '|' + Sb + '|' + act + '|*', rel, fa); }
        }
        // карты героя известны и при фолде («Dealt to»: свои истории, у iPoker — в каждой раздаче) — честные частоты
        // по рукам, включая фолд: «D<T|R|O>|Sb|действие|hN» (T — топ, R — рег, O — остальные)
        if (rp.hero === i && rp.hc && rp.hc[i]) { const hc = K.parseCards(String(rp.hc[i])); if (hc && hc.length === 2) { const dh = K.h169(hc[0], hc[1]); addHC('D' + (coh === 'T' ? 'T' : g === 'greg' ? 'R' : 'O') + '|' + Sb + '|' + act + '|h' + dh, rel); stats.dealt = (stats.dealt || 0) + 1; } }
        if (g === 'greg') addEV('greg|' + Sb + '|' + act + '|*', rel, fa); // реги по семейству позиций — для поправки весов рук
        // стадия — слой поверх (план C9): отдельные ячейки «Z|стадия|…»; в движке стягиваются к общим, если данных мало
        if (stage) for (const c of CO) { addEV('Z|' + stage + '|' + c + '|' + S + '|' + act + '|*', rel, fa); addEV('Z|' + stage + '|' + c + '|' + Sb + '|' + act + '|*', rel, fa); }
        // размеры (п.6 → п.8): EV и частоты по корзине сайза — «3bet@3x», чтобы выбирать размер по EV, а не только по частоте
        const sizedA = d.sz && (act === 'open' || act === 'iso' || act === '3bet' || act === '4bet') ? act + '@' + d.sz : null;
        if (sizedA) for (const c of CO) { addEV(c + '|' + S + '|' + sizedA + '|*', rel, fa); addEV(c + '|' + Sb + '|' + sizedA + '|*', rel, fa); }
        // ответ открывшего на 3-бет по размеру 3-бета: как часто сбрасывает именно тот, в кого 3-бетят
        if (d.tbl === 'VS3' && d.nR === 2 && d.i === d.openI && d.openTo > 0 && d.refTo > 0) {
          const b3 = SZ.bucketOf('3bet', d.refTo / d.openTo);
          addEV('R|' + [st, tb + kd, C.posBand(d.pos), C.posBand(d.oppPos), bnd, b3].join('|') + '|' + act, 0, false);
          addEV('R|' + [st, tb + kd, '*', '*', bnd, b3].join('|') + '|' + act, 0, false);
        }
        stats.dec++;
        // слой руки: рука видна → банк разыгран (FA всегда без вскрытия). Для топов и поля раздельно.
        const s = SD[i];
        if (s && !fa && act !== 'fold') {
          const cl = K.C12OF[s.h];
          for (const c of CO) {
            addHC(c + '|' + Sb + '|' + act + '|h' + s.h, rel);
            addHC(c + '|' + S + '|' + act + '|' + cl, rel);
            addHC(c + '|' + Sb + '|' + act + '|' + cl, rel);
            addHC(c + '|' + Sb + '|' + act + '|*', rel); // среднее продолжения по вскрытым — для сдвига вскрытий
          }
          // реги отдельно (руки на вскрытии): веса «как реги играют эту руку» в панели
          if (g === 'greg') { addHC('greg|' + Sb + '|' + act + '|h' + s.h, rel); addHC('greg|' + Sb + '|' + act + '|*', rel); }
          if (sizedA) for (const c of CO) { addHC(c + '|' + Sb + '|' + sizedA + '|h' + s.h, rel); addHC(c + '|' + S + '|' + sizedA + '|' + cl, rel); addHC(c + '|' + Sb + '|' + sizedA + '|' + cl, rel); addHC(c + '|' + Sb + '|' + sizedA + '|*', rel); }
        }
        // диапазоны олл-инов (по 169 рукам), по группе игрока
        if (s && act === 'shove') {
          const ctxS = d.tbl === 'RFI' || d.tbl === 'ISO' ? 'O' : d.tbl; // O — пуш первым/против лимперов
          addR(RS, [g, ctxS, st, tb + kd, d.pos, d.sB].join('|'), s.h);
          addR(RS, ['*', ctxS, st, tb + kd, C.posBand(d.pos), d.sB].join('|'), s.h);
        }
        if (s && d.tbl === 'AI' && act === 'call') {
          addR(RC, [g, st, tb + kd, d.pos, d.oppPos, d.sB, d.L].join('|'), s.h);
          addR(RC, ['*', st, tb + kd, C.posBand(d.pos), C.posBand(d.oppPos), d.sB, d.L].join('|'), s.h);
        }
      }
      stats.hands++;
      if (stats.hands % 1000000 === 0) C.log('v8:', stats.hands, 'рук, решений', stats.dec, 'поправок на олл-ин', stats.adj, ((Date.now() - t0) / 60000).toFixed(1) + ' мин');
    } catch (e) { if (++errs <= 8) C.log('v8 ERR', e.message); }
  }
  if (unsaved || mergedAny) saveState(); // состояние — полное: к нему можно добавлять новые архивы (RESUME=1)
  if (process.env.STATE_ONLY === '1') { C.log('v8: поток готов — состояние сохранено'); return; } // параллельный поток: модель соберёт слияние
  // ---------- сериализация ----------
  // Порог — на СПОТ (сумма по действиям), а не на ячейку: иначе редкие действия выпадают и частоты
  // смещаются к частым (в v6 колл пуша мог исчезнуть, и выходило «все фолдят»). Малые ячейки — только счётчик.
  const thrEV = (k) => (k[0] === 'T' || k[0] === 'U' ? 8 : k[0] === 'Z' ? 10 : k[0] === 'g' ? 25 : 30);
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
  stats.broken = stats_broken;
  const model = { v: 8, meta: { mysteryCut: stats.mysteryCut || 0, dealt: stats.dealt || 0, hands: stats.hands, broken: stats_broken, dups: stats.dups || 0, decisions: stats.dec, allinAdjusted: stats.adj, showdownHands: stats.sd, topsA: TOPS.A.size, topsB: TOPS.B.size, tops5A: TOPS.A5.size, tops5B: TOPS.B5.size, topsRule: TJ.rule || null, bands: C.BAND_NAMES, built: new Date().toISOString() }, EV: EVo, HC: HCo, RS: Ro(RS), RC: Ro(RC) };
  const outF = process.env.MODEL_OUT || path.join(C.OUT, 'model_v8.ndjson');
  C.saveModel(outF, model); // построчно: на полной базе JSON целиком не помещается в одну строку (> 512 МБ)
  C.log('v8 ГОТОВО: рук', stats.hands, 'решений', stats.dec, 'олл-ин-поправок', stats.adj, '| ячеек EV', Object.keys(EVo).length, 'HC', Object.keys(HCo).length, 'RS', Object.keys(model.RS).length, 'RC', Object.keys(model.RC).length, '|', (fs.statSync(outF).size / 1048576).toFixed(1), 'МБ', ((Date.now() - t0) / 60000).toFixed(1), 'мин');
})();
