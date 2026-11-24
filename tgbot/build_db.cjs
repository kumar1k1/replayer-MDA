'use strict';
// TG-бот (вспомогательный проект, 23.11.2026): база для быстрых ответов по игрокам.
//  • игроки нашей базы — pipeline/out2/players_v8.ndjson + кластеры players_cl_all.json (как в конвейере);
//  • алиас владельца — по ЕГО раздачам (папка и ники — data/practice_alias.json, только на ПК), посчитан тем же кодом
//    (lib/stats.js handStats, C.netAdjusted), что и статы базы: цифры сравнимы. Строки «alias:все» и «alias:<рум>».
// Выход: tgbot/data/players.db (SQLite, поиск по нику — индекс). Запуск: node tgbot/build_db.cjs
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'pipeline', 'common.cjs')), ST = require(path.join(ROOT, 'lib', 'stats.js')), K = require(path.join(ROOT, 'lib', 'cards.js'));
const V = require(path.join(ROOT, 'pipeline', 'convert.cjs'));
const OUTD = process.env.OUT_DIR || path.join(ROOT, 'pipeline', 'out2');
const DBF = path.join(__dirname, 'data', 'players.db');
fs.mkdirSync(path.dirname(DBF), { recursive: true });
const log = (s) => console.log(new Date().toTimeString().slice(0, 8) + ' ' + s);

const NCL = ST.CL.length, NPF = ST.PF_SLOTS;
const sparse = (a) => { const o = []; for (let i = 0; i < a.length; i++) if (a[i]) o.push(i + ':' + a[i]); return o.join(','); };
// ---------- алиас владельца: статы по его раздачам ----------
// образцы для ручной проверки: по 6 случайных раздач на стат (резервуар)
const SAMPLE = !!process.env.TGBOT_SAMPLE, SMP = {}, SMPN = {}, AUDIT = !!process.env.TGBOT_AUDIT, AUD = [];
function smp(k, s) { SMPN[k] = (SMPN[k] || 0) + 1; const A = SMP[k] = SMP[k] || []; if (A.length < 6) A.push(s); else { const j = Math.floor(Math.random() * SMPN[k]); if (j < 6) A[j] = s; } }
// класс руки: AA / AKs / AKo (ряд и колонка 13×13: одномастные выше диагонали, разномастные ниже)
const RK = 'AKQJT98765432', HM = {};
function handClass(a, b) { const r1 = RK.indexOf(a[0].toUpperCase()), r2 = RK.indexOf(b[0].toUpperCase()); if (r1 < 0 || r2 < 0) return null; const hi = Math.min(r1, r2), lo = Math.max(r1, r2); return hi === lo ? RK[hi] + RK[lo] : RK[hi] + RK[lo] + (a[1].toLowerCase() === b[1].toLowerCase() ? 's' : 'o'); }
function aliasStats() {
  const cfgF = path.join(ROOT, 'data', 'practice_alias.json');
  if (!fs.existsSync(cfgF)) { log('алиаса нет (data/practice_alias.json) — пропускаю'); return []; }
  const cfg = JSON.parse(fs.readFileSync(cfgF, 'utf8'));
  const mine = new Set(Object.keys(cfg['ники'] || {})); // «рум:ник»
  const P_ = C.loadParser(), { frames } = P_, parse = C.makeParse(P_);
  const acc = {}; // рум → { pf, cl, f, n, ns, nf }
  const A = (room) => acc[room] = acc[room] || { pf: new Float64Array(NPF), cl: new Float64Array(2 * 2 * NCL * 2), f: new Float64Array(24), raw: new Float64Array(24), pos: {}, h3: {}, rfi: {}, vso: {}, v3m: {}, iso: {}, oc: {}, b3i: {}, s3: {}, f3: {}, c3: {}, f4: {}, sq: {}, sqm: {}, tot: { fl: 0, sd: 0, won: 0, sdw: 0, fl2: 0, sd2: 0, won2: 0, sdw2: 0 }, ser: [], n: 0, ns: 0, nf: 0, nicks: new Set() };
  // 3-бет как в Hand2Note (сверено 23.11.2026 с его поп-апом владельца, все позиции): против ровно одного рейза,
  // без коллеров (сквиз — отдельно), опен не олл-ином, на BB — не против опена с SB (блайнд против блайнда — отдельно)
  const HF = require(path.join(ROOT, 'lib', 'handfix.js'));
  // мест до баттона по названию позиции; если названия нет в списке для n игроков (кто-то сидит вне раздачи) — ищем в списках для n+1…9 (24.11.2026)
  const toBtn = (lab, n) => { if (lab === 'BTN') return 0; for (let m = Math.min(Math.max(n, 2), 9); m <= 9; m++) { const L = HF.POS_NAMES[m], i = L.indexOf(lab); if (i >= 0) return L.length - i; } return null; };
  const p5k = (k) => (k === 0 ? 'BTN' : k === 1 ? 'CO' : k === 2 ? 'HJ' : k <= 4 ? 'MP' : 'EP');
  const distPos = (lab, n) => { if (lab === 'SB' || lab === 'BTN/SB') return 'SB'; if (lab === 'BB' || lab === 'BTN') return lab; const d = toBtn(lab, n); return d === 1 ? 'CO' : d === 2 ? 'HJ' : 'MP'; };
  const tsOf = (d) => { const m = /(\d{4})[\/-](\d\d)[\/-](\d\d)[ T](\d{1,2}):(\d\d):(\d\d)/.exec(String(d || '')); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0; };
  // позиция как в Hand2Note: UTG — только при полном столе (6 из 6, 8 из 8…), иначе первые места — MP; блайнды, BTN, CO — как есть
  // позиция открывшего: EP (5+ мест до баттона) / MP (3–4) / HJ (2) / CO / BTN / SB — как RFI
  const p5of = (lab, n) => { if (!lab) return null; if (/SB/.test(lab)) return 'SB'; if (lab === 'BB') return 'BB'; const k = toBtn(lab, n); return k == null ? null : p5k(k); };
  // позиции по тексту раздачи (24.11.2026, полная сверка с независимым разбором): места за столом + кто поставил блайнды;
  // в раздаче — поставившие блайнд/анте и действовавшие; круг от SB (если SB не поставлен — от BB), BTN — последний.
  // Так верно и когда SB пустой / сидящий на SB вне раздачи (разборщик в этих случаях сдвигал позиции на одну)
  function textPos(h, rp) {
    const L = h.split(/\r?\n/), hi = L.findIndex(l => /^\*\*\* HOLE CARDS/.test(l)); const head = hi < 0 ? L : L.slice(0, hi + 1);
    const seats = {}; for (const l of head) { const m = /^Seat (\d+): (.+?) \(/.exec(l); if (m) seats[m[2]] = +m[1]; }
    let sbN = null, bbN = null; const inH = new Set();
    for (const l of head) { let m; if ((m = /^(.+?): posts small blind/.exec(l))) { sbN = m[1]; inH.add(m[1]); } if ((m = /^(.+?): posts big blind/.exec(l))) { bbN = m[1]; inH.add(m[1]); } if ((m = /^(.+?): posts the ante/.exec(l))) inH.add(m[1]); }
    const end = L.findIndex((l, i) => i > hi && /^\*\*\* /.test(l)); for (const l of L.slice(hi + 1, end < 0 ? L.length : end)) { const m = /^(.+?): (folds|checks|calls|raises|bets)/.exec(l); if (m) inH.add(m[1]); }
    const order = Object.keys(seats).filter(nm => inH.has(nm)).sort((a, b) => seats[a] - seats[b]), anc = sbN && order.includes(sbN) ? sbN : bbN;
    const a0 = anc ? order.indexOf(anc) : -1, ring = a0 < 0 ? null : order.slice(a0).concat(order.slice(0, a0)), n = ring ? ring.length : 0;
    const kOf = (i) => { const nm = rp.nm[i]; if (!ring || !ring.includes(nm)) return null; return n - 1 - ring.indexOf(nm); };
    const isSB = (i) => (sbN ? rp.nm[i] === sbN : /SB/.test(rp.pl[i][0])), isBB = (i) => (bbN ? rp.nm[i] === bbN : rp.pl[i][0] === 'BB');
    const p5 = (i) => { if (i == null) return null; if (isSB(i)) return 'SB'; if (isBB(i)) return 'BB'; const k = kOf(i); return k == null ? p5of(rp.pl[i][0], rp.n) : p5k(k); };
    const p3 = (i) => { if (isSB(i)) return 'SB'; if (isBB(i)) return 'BB'; const k = kOf(i); return k == null ? distPos(rp.pl[i][0], rp.n) : k === 0 ? 'BTN' : k === 1 ? 'CO' : k === 2 ? 'HJ' : 'MP'; };
    return { p5, p3, isSB, isBB };
  }
  const raiseBefore = (rp, k, from) => { const e = rp.ev.find((x, j) => j < k && j > (from == null ? -1 : from) && x.st === 0 && x.t === 'r'); return e ? e.i : null; };  const rfiBand = (x) => x < 12 ? '<12' : x < 20 ? '12-19' : x < 36 ? '20-35' : x < 60 ? '36-59' : x < 100 ? '60-99' : x < 150 ? '100-149' : '150+';
  const h2nPos = (lab, n, max) => (lab === 'BB' || lab === 'SB' || lab === 'BTN' || lab === 'CO' ? lab : lab === 'BTN/SB' ? 'SB' : lab === 'UTG' && max && n >= max ? 'UTG' : 'MP');
  const sigs = new Set(); let dupN = 0; // одна раздача под разными номерами (выгрузка GG дважды) — считаем один раз
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(f => f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]);
  const files = walk(cfg['папка']).filter(f => /\.txt$/i.test(f));
  const ids = new Set(); let hands = 0, skipped = 0;
  const FI = { n: 1, k: 2, m: 3 };
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
    if (/^\s*Winamax Poker - Tournament summary/.test(t)) continue;
    let parts = [];
    if (/^\s*Winamax Poker - Tournament "/m.test(t)) parts = t.split(/\r?\n(?=Winamax Poker - Tournament ")/).filter(h => /^\s*Winamax Poker - Tournament "/.test(h)).map(h => V.wnmxToPS(h.trim()));
    else if (/^\s*Game Hand #/m.test(t)) parts = t.split(/\r?\n(?=Game Hand #)/).filter(h => /^\s*Game Hand #/.test(h)).map(h => V.wpnToPS(h.trim(), f));
    else parts = t.split(/\r?\n(?=(?:PokerStars Hand #|CoinPoker Hand #|Poker Hand #))/).map(s => s.trim()).filter(s => /^(PokerStars |CoinPoker )?Hand #|^Poker Hand #/.test(s)).map(s => (V.isGGasPS(s) ? V.ggToPS(s) : s));
    for (const h of parts) {
      if (!h) { skipped++; continue; }
      let rp; try { rp = parse(h); } catch (e) { rp = null; } if (!rp || !rp.n || !rp.bb) { skipped++; continue; }
      const room = C.roomOf(h), idk = room + ':' + rp.handId; if (ids.has(idk)) continue; ids.add(idk);
      const fr = frames(rp), fin = fr[fr.length - 1]; if (!C.handIntact(rp, fin, h)) { skipped++; continue; }
      const hero = rp.hero; if (hero == null || hero < 0 || !mine.has(room + ':' + rp.nm[hero])) { skipped++; continue; }
      { const tm = /Tournament #(\d+)/.exec(h), sg = [room, tm && tm[1], rp.date, rp.nm.join(','), rp.stacks.join(','), JSON.stringify(rp.hc || ''), (rp.bd || []).join('')].join('|'); if (sigs.has(sg)) { dupN++; continue; } sigs.add(sg); }
      const fi = C.tableFormat(h).fmt === 'short' ? 0 : 1, hA = C.halfOf(rp.handId) === 'A' ? 0 : 1, half = hA * 3;
      const kd = C.kindOf(rp, h, f), fo = FI[kd] * 6;
      const SD = {}; for (const [k, v] of Object.entries(rp.sh || {})) { const c = K.parseCards(v); if (c && c.length === 2) SD[+k] = { c }; }
      const net = C.netAdjusted(rp, fin, SD).net, b = net[hero] / rp.bb, rb = (fin.stacks[hero] - rp.stacks[hero]) / rp.bb; // b — с поправкой на олл-ин, rb — реально (как Hand2Note)
      const TP = textPos(h, rp); // позиции по тексту раздачи
      const r = ST.handStats(rp, fr), ps = h2nPos(rp.pl[hero][0], rp.n, C.tableFormat(h).max);
      // 3-бет (Hand2Note), общие исходы флопа, точка графика
      // vo — ответ на опен тем же правилом, что 3-бет: [позиция, стек, действие call|3b|shove|fold]
      let h3 = null, vo = null, oc = null; { let limped = false; const DD = C.preflopDecisions(rp, () => ''); for (const d of DD) { if (d.i !== hero) continue; if (DD.some(x => x.k < d.k && x.act === 'limp')) limped = true; /* лимп до опена у любого — не считаем (сверено: колд-колл BB) */
          // оверколл (24.11.2026): один опен (не олл-ин), до меня 1 или 2+ коллера, лимпов нет — [поз, коллеров 1|2, стек, действие колл 1 / рейз 2 / олл-ин 3 / фолд 0]
          if (!oc && d.nR === 1 && !limped && d.tbl !== 'AI' && (d.C === 'C1' || d.C === 'C2')) { const act = d.act === 'call' ? 1 : /^3bet/.test(d.act) || (d.act === 'raise' && !d.aiAct) ? 2 : d.act === 'shove' || d.act === 'raise' ? 3 : 0;
            // сквиз (25.11.2026): кто открыл, первый коллер, ответ на рейз после моего сквиза не олл-ином
            const opI = raiseBefore(rp, d.k), clE = rp.ev.find((e, j) => j < d.k && e.st === 0 && e.t === 'c' && e.i >= 0 && opI != null && j > rp.ev.findIndex(x => x.st === 0 && x.t === 'r')), nx2 = act === 2 ? DD.find(x => x.i === hero && x.k > d.k) : null;
            oc = [TP.p3(hero), d.C === 'C1' ? 1 : 2, rfiBand(d.stackTot), act, TP.p5(opI), clE ? TP.p5(clE.i) : null, nx2 ? 1 : 0, nx2 && nx2.act === 'fold' ? 1 : 0]; } if (d.nR === 1 && !limped && d.tbl !== 'AI' && (!d.C || d.C === 'C0')) { const p3 = TP.p3(hero); const opI = raiseBefore(rp, d.k), bbSb = p3 === 'BB' && opI != null && TP.isSB(opI); if (!bbSb) h3 = [p3, /^3bet/.test(d.act) || (d.act === 'raise' && !d.aiAct), /^3bet/.test(d.act) || d.act === 'shove' || d.act === 'raise']; vo = [p3, rfiBand(d.stackTot), d.act === 'call' ? 1 : /^3bet/.test(d.act) || (d.act === 'raise' && !d.aiAct) ? 2 : d.act === 'shove' || d.act === 'raise' ? 3 : 0, bbSb, TP.p5(opI)]; } if (d.act === 'limp') limped = true; } }
      // RFI как Hand2Note: позиции EP (5+ мест до баттона) / MP (3–4) / HJ (2) / CO / BTN / SB; TOT — любой рейз первым, NAI — без олл-ина; стек — свой, в bb
      let rf = null; { const d0 = C.preflopDecisions(rp, () => '').find(d => d.i === hero); if (d0 && d0.tbl === 'RFI') { if (!TP.isBB(hero)) { const p5 = TP.p5(hero); rf = [p5, rfiBand(d0.stackTot), /^open/.test(d0.act) || d0.act === 'shove', /^open/.test(d0.act)]; } } }
      // изолейт (24.11.2026): первое решение против лимперов без рейза; BB против лимпа одного SB — отдельно («BBsb»: только в TOT).
      // iz = [поз, L 1|2, стек, изо, изо олл-ином, лимпер ответил рейзом, я сбросил на рейз лимпера, любой рейз после изо, я сбросил]
      let iz = null; { const dd = C.preflopDecisions(rp, () => ''), d0 = dd.find(d => d.i === hero);
        if (d0 && d0.tbl === 'ISO') { const pz = TP.p3(hero), lim = new Set(dd.filter(d => d.k < d0.k && d.act === 'limp').map(d => d.i)), ai = d0.act === 'shove', iso = /^iso/.test(d0.act) || ai;
          const sbOnly = pz === 'BB' && [...lim].every(j => TP.isSB(j));
          let rl = 0, fl = 0, ra = 0, fa = 0, rb = 0, fb = 0;
          if (iso && !ai) { const nx = dd.find(d => d.i === hero && d.k > d0.k); if (nx) { const rr = rp.ev.filter((e, k) => k > d0.k && k < nx.k && e.st === 0 && e.t === 'r'), f = nx.act === 'fold' ? 1 : 0; if (rr.length) { ra = 1; fa = f; if (rr.every(e => lim.has(e.i))) { rl = 1; fl = f; } else if (rr.every(e => !lim.has(e.i))) { rb = 1; fb = f; } } } }
          iz = [sbOnly ? 'BBsb' : pz, d0.L === 'L1' ? 1 : 2, rfiBand(d0.stackTot), iso ? 1 : 0, ai ? 1 : 0, rl, fl, ra, fa, rb, fb]; } }
      // 3-бет против изолейта (24.11.2026, определение владельца): ровно один лимпер, его изолировали (рейз не олл-ин), после изолейта никто не вошёл, мы 3-бетим
      let bi = null; { const dd = C.preflopDecisions(rp, () => ''), d = dd.find(x => x.i === hero);
        if (d && d.nR === 1 && d.tbl !== 'AI' && (!d.C || d.C === 'C0') && dd.filter(x => x.k < d.k && x.act === 'limp').length === 1) bi = /* ровно один лимпер (владелец) */ [TP.p3(hero), rfiBand(d.stackTot), /^3bet/.test(d.act) || (d.act === 'raise' && !d.aiAct) ? 1 : 0, d.act === 'shove' || (d.act === 'raise' && d.aiAct) ? 1 : 0]; }
      // размер 3-бета (24.11.2026): 3-бет не олл-ином против одного опена (без коллеров и лимпов); размер — сколько всего ставим, в бб (шаг 0,5); ответ на 4-бет
      let sz = null, f4i = null; { const dd = C.preflopDecisions(rp, () => ''), d = dd.find(x => x.i === hero);
        if (d && d.nR === 1 && d.tbl !== 'AI' && (!d.C || d.C === 'C0') && !dd.some(x => x.k < d.k && x.act === 'limp') && (/^3bet/.test(d.act) || (d.act === 'raise' && !d.aiAct))) {
          const op = rp.ev.slice(0, d.k).filter(e => e.st === 0 && e.t === 'r').pop(), me = rp.ev[d.k];
          if (op && me && op.a) { const v = Math.round(me.a / rp.bb * 2) / 2, g = v <= 5 ? '05.0' : v >= 11 ? '11.0' : v >= 9.5 ? '09.5' : (v < 10 ? '0' : '') + v.toFixed(1) /* размер в бб, шаг 0,5 (владелец) */, nx = dd.find(y => y.i === hero && y.k > d.k);
            sz = [g, TP.p3(hero), rfiBand(d.stackTot), me.a / rp.bb, nx ? 1 : 0, nx && nx.act === 'fold' ? 1 : 0];
            // ответ на 4-бет (24.11.2026): мой 3-бет не олл-ином → мне поставили 4-бет (в т.ч. олл-ин) → [поз, стек, 4-бет олл-ином, фолд, колл, 5-бет]
            if (nx) f4i = [TP.p3(hero), rfiBand(d.stackTot), nx.tbl === 'AI' ? 1 : 0, nx.act === 'fold' ? 1 : 0, nx.act === 'call' ? 1 : 0, nx.act !== 'fold' && nx.act !== 'call' ? 1 : 0]; } } }
      // фолд на 3-бет (24.11.2026): мой опен первым (не олл-ин) → ровно один 3-бет, коллеров между ними нет → мой ответ;
      // IP — 3-бет с блайндов (а я не на SB), OOP — 3-бет сзади не с блайндов или я на SB. f3i = [поз опена, IP 1/0, стек, 3-бет олл-ином, фолд, колл, 4-бет]
      let f3i = null; { const dd = C.preflopDecisions(rp, () => ''), d0 = dd.find(x => x.i === hero);
        if (d0 && d0.tbl === 'RFI' && /^open/.test(d0.act)) { const nx = dd.find(x => x.i === hero && x.k > d0.k);
          if (nx && (nx.tbl === 'VS3' || nx.tbl === 'AI') && rp.ev.filter((e, k) => k > d0.k && k < nx.k && e.st === 0 && e.t === 'r').length === 1 && !rp.ev.some((e, k) => k > d0.k && k < nx.k && e.st === 0 && e.t === 'c')) { // никто не коллировал ни до, ни после 3-бета (сквиз — не сюда)
            const p5 = TP.p5(hero), tbi = raiseBefore(rp, nx.k, d0.k);
            const ip = !TP.isSB(hero) && tbi != null && (TP.isSB(tbi) || TP.isBB(tbi)) ? 1 : 0;
            f3i = [p5, ip, rfiBand(d0.stackTot), nx.tbl === 'AI' ? 1 : 0, nx.act === 'fold' ? 1 : 0, nx.act === 'call' ? 1 : 0, nx.act !== 'fold' && nx.act !== 'call' ? 1 : 0, nx.act === 'shove' ? 1 : 0]; } } }
      // колл 3-бета в холодную (24.11.2026): первое решение — опен и 3-бет (не олл-ин), до меня никто не коллировал и не лимпил; [поз, стек, колл, 4-бет]
      let c3i = null; { const dd = C.preflopDecisions(rp, () => ''), d = dd.find(x => x.i === hero);
        if (d && d.tbl === 'VS3' && rp.ev.filter((e, k) => k < d.k && e.st === 0 && e.t === 'r').length === 2 /* ровно опен и 3-бет, без 4-бета */ && !rp.ev.some((e, k) => k < d.k && e.st === 0 && e.t === 'c' && e.i >= 0) && !dd.some(x => x.k < d.k && x.act === 'limp')) c3i = [TP.p3(hero), rfiBand(d.stackTot), d.act === 'call' ? 1 : 0, d.act !== 'call' && d.act !== 'fold' ? 1 : 0]; }
      // полная сверка (TGBOT_AUDIT=1): как подсчёт понял каждую раздачу → tgbot/data/audit.ndjson
      if (AUDIT) AUD.push(JSON.stringify({ id: room + '#' + rp.handId, rf, vo, oc, iz, bi, sz: sz && [sz[0], sz[1], Math.round(sz[3] * 10) / 10, sz[4], sz[5]], f3i, c3i }));
      // образцы раздач для ручной проверки (TGBOT_SAMPLE=1 → tgbot/data/samples.json, только на ПК)
      if (SAMPLE) {
        const id = room + ' #' + rp.handId + (/Tournament #(\d+)/.exec(h) ? ' · турнир ' + /Tournament #(\d+)/.exec(h)[1] : '') + ' · ' + (rp.date || '') + ' · карты ' + ((rp.hc && rp.hc[hero]) || '?');
        const actRu = (a) => ({ fold: 'фолд', call: 'колл', limp: 'лимп', check: 'чек', shove: 'олл-ин', raise: 'рейз' })[a] || (/^open/.test(a) ? 'опен' : /^iso/.test(a) ? 'изо' : /^3bet/.test(a) ? '3-бет' : a === '4bet' ? '4-бет' : a);
        if (rf) smp('RFI ' + rf[0], id + ' · я ' + rf[0] + ', стек ' + rf[1] + ' · ' + (rf[3] ? 'опен' : rf[2] ? 'опен олл-ином' : 'не открылся'));
        if (vo) smp('ответ на опен ' + vo[0], id + ' · я ' + vo[0] + ', опен с ' + vo[4] + (vo[3] ? ' (BB против SB)' : '') + ' · ' + ['фолд', 'колл', '3-бет', '3-бет олл-ином'][vo[2]]);
        if (oc) smp('колл ' + (oc[1] === 1 ? 'третьим' : 'четвёртым+') + ' ' + oc[0], id + ' · я ' + oc[0] + ', до меня коллеров ' + (oc[1] === 1 ? '1' : '2+') + ' · ' + ['фолд', 'колл', 'рейз', 'олл-ин'][oc[3]]);
        if (iz) smp('изо ' + iz[0], id + ' · я ' + iz[0] + ', лимперов ' + (iz[1] === 1 ? '1' : '2+') + ' · ' + (iz[3] ? (iz[4] ? 'изо олл-ином' : 'изо') + (iz[5] ? ' → лимпер рейз → я ' + (iz[6] ? 'фолд' : 'не фолд') : iz[9] ? ' → рейз сзади → я ' + (iz[10] ? 'фолд' : 'не фолд') : '') : 'не изолировал'));
        if (bi) smp('3-бет против изо ' + bi[0], id + ' · я ' + bi[0] + ' · ' + (bi[2] ? '3-бет' : bi[3] ? '3-бет олл-ином' : 'без 3-бета'));
        if (sz) smp('размер 3-бета', id + ' · я ' + sz[1] + ' · 3-бет до ' + (Math.round(sz[3] * 10) / 10) + ' бб · ' + (sz[4] ? '4-бет → я ' + (sz[5] ? 'фолд' : 'не фолд') : '4-бета не было'));
        if (f3i) smp('фолд на 3-бет ' + (f3i[1] ? 'IP' : 'OOP'), id + ' · я открылся с ' + f3i[0] + ', 3-бет ' + (f3i[3] ? 'олл-ином' : 'не олл-ином') + ', я ' + (f3i[1] ? 'в позиции' : 'без позиции') + ' · ' + (f3i[4] ? 'фолд' : f3i[5] ? 'колл' : f3i[7] ? '4-бет олл-ином' : '4-бет'));
        if (c3i) smp('колл 3-бета в холодную ' + c3i[0], id + ' · я ' + c3i[0] + ' · ' + (c3i[2] ? 'колл' : c3i[3] ? 'холодный 4-бет' : 'фолд'));
      }
      const flF = fr.find(x => x.street === 1), sawFl = !!(flF && (rp.bd || []).length >= 3 && !flF.folded[hero]);
      const wentSD = !fin.folded[hero] && fin.folded.filter(x => !x).length >= 2, wonH = fin.won[hero] > 0, preAI = rp.ev.some(e => e.st === 0 && e.ai);
      const pt = [tsOf(rp.date), rb, b, wentSD ? 1 : 0];
      // матрицы рук (25.11.2026): по каждому стату / позиции / стеку — какой рукой была ситуация (d) и действие (n); только «все румы»
      { const cm = /^Dealt to .+? \[(\S\S) (\S\S)\]/m.exec(h), CLS = cm ? handClass(cm[1], cm[2]) : null;
        if (CLS) {
          const H = (path, band, metric, num) => { for (const bd of [band, 'all']) { const o = ((HM[path] = HM[path] || {})[metric] = HM[path][metric] || {})[bd] = HM[path][metric][bd] || {}; const c = o[CLS] = o[CLS] || [0, 0]; c[0]++; if (num) c[1]++; } };
          if (rf) for (const p of rf[0] === 'SB' ? ['SB'] : [rf[0], 'TOT']) { /* RFI TOT — без SB, как в таблице */ H('rfi|' + p, rf[1], 'tot', rf[2]); H('rfi|' + p, rf[1], 'nai', rf[3]); }
          if (vo) { const keys = vo[3] ? ['TOT'] : vo[0] === 'BB' ? ['BB', 'TOT'] : [vo[0], 'TOT', 'TOTnb'], M = { call: vo[2] === 1, b3: vo[2] === 2, ai: vo[2] === 3, b3all: vo[2] >= 2, fold: vo[2] === 0 };
            for (const p of keys) for (const [m, v] of Object.entries(M)) H('vso|' + p, vo[1], m, v);
            if (vo[4]) for (const [m, v] of Object.entries(M)) H('v3m|' + vo[0] + '|' + vo[4], vo[1], m, v); }
          if (oc) for (const p of oc[0] === 'BB' ? ['BB'] : [oc[0], 'TOT']) H('oc|' + p + '|' + oc[1], oc[2], 'call', oc[3] === 1);
          if (oc) { for (const p of [oc[0], 'TOT']) { H('sq|' + p, oc[2], 'sqz', oc[3] >= 2); H('sq|' + p, oc[2], 'nai', oc[3] === 2); H('sq|' + p, oc[2], 'ai', oc[3] === 3); if (oc[6]) H('sq|' + p, oc[2], 'sqfold', oc[7]); }
            if (oc[4] && oc[5] && oc[1] === 1) { const G = ['EP', 'MP', 'HJ'].includes(oc[4]) ? 'MP+CC' : oc[4] + '+' + oc[5]; H('sqm|' + oc[0] + '|' + G, oc[2], 'sqz', oc[3] >= 2); H('sqm|' + oc[0] + '|' + G, oc[2], 'nai', oc[3] === 2); } }
          if (iz) for (const p of [iz[0], 'TOT']) { const P = 'iso|' + p + '|' + iz[1]; H(P, iz[2], 'iso', iz[3]); H(P, iz[2], 'isoai', iz[4]); H(P, iz[2], 'isonai', iz[3] && !iz[4]); if (iz[5]) H(P, iz[2], 'isofold', iz[6]); if (iz[9]) H(P, iz[2], 'fsz', iz[10]); }
          if (bi) for (const p of [bi[0], 'TOT']) { H('b3i|' + p, bi[1], 'b3all', bi[2] || bi[3]); H('b3i|' + p, bi[1], 'nai', bi[2]); H('b3i|' + p, bi[1], 'ai', bi[3]); }
          if (sz) for (const p of [sz[1], 'TOT']) { H('s3|' + p, sz[2], 'any', 1); H('s3|' + p, sz[2], 'sz:' + sz[0], 1); if (sz[4]) H('s3|' + p, sz[2], 'f4:' + sz[0], sz[5]); }
          if (f3i) for (const p of f3i[0] === 'SB' ? ['SB'] : [f3i[0], 'TOT']) for (const w of [f3i[1] ? 'ip' : 'oop', 'all']) { const P = 'f3|' + p + '|' + w; H(P, f3i[2], 'fold', f3i[4]); H(P, f3i[2], 'call', f3i[5]); if (!f3i[3]) { H(P, f3i[2], 'b4', f3i[6]); H(P, f3i[2], 'b4nai', f3i[6] && !f3i[7]); H(P, f3i[2], 'b4ai', f3i[7]); } }
          if (c3i) for (const p of [c3i[0], 'TOT']) H('c3|' + p, c3i[1], 'call', c3i[2]);
          if (f4i) for (const p of [f4i[0], 'TOT']) H('f4|' + p, f4i[1], 'fold', f4i[3]);
        } }      for (const a of [A('все'), A(room)]) {
        a.n++; if (fi === 0) a.ns++; else a.nf++; a.nicks.add(rp.nm[hero]);
        a.f[half]++; a.f[half + 1] += b; a.f[half + 2] += b * b; a.f[fo + half]++; a.f[fo + half + 1] += b; a.f[fo + half + 2] += b * b;
        a.raw[half]++; a.raw[half + 1] += rb; a.raw[half + 2] += rb * rb; a.raw[fo + half]++; a.raw[fo + half + 1] += rb; a.raw[fo + half + 2] += rb * rb;
        const P = a.pos[ps] = a.pos[ps] || [0, 0, 0, 0]; P[0]++; P[1] += rb; P[2] += b; P[3] += rb * rb;
        if (rf) for (const p of [rf[0], 'TOT']) for (const bd of [rf[1], 'all']) { const X = (a.rfi[p] = a.rfi[p] || {})[bd] = a.rfi[p][bd] || [0, 0, 0]; X[0]++; if (rf[2]) X[1]++; if (rf[3]) X[2]++; }
        // vso[pos][band] = [раз, колл, 3-бет NAI, олл-ин] (фолд — остаток)
        // BB против SB — только в TOT (в колонке BB их нет), как в поп-апе владельца
        // TOTnb — без BB (колд-колл: TOT без BB, как в поп-апе владельца)
        if (vo) for (const p of vo[3] ? ['TOT'] : vo[0] === 'BB' ? ['BB', 'TOT'] : [vo[0], 'TOT', 'TOTnb']) for (const bd of [vo[1], 'all']) { const X = (a.vso[p] = a.vso[p] || {})[bd] = a.vso[p][bd] || [0, 0, 0, 0]; X[0]++; if (vo[2]) X[vo[2]]++; }
        // v3m[моя позиция][позиция открывшего][стек] = [раз, колл, 3-бет NAI, олл-ин] — «позиция против позиции», BB против SB входит
        if (vo && vo[4]) for (const bd of [vo[1], 'all']) { const M = (a.v3m[vo[0]] = a.v3m[vo[0]] || {}), X = (M[vo[4]] = M[vo[4]] || {})[bd] = M[vo[4]][bd] || [0, 0, 0, 0]; X[0]++; if (vo[2]) X[vo[2]]++; }
        // iso[поз][L][стек] = [раз, изо, изо олл-ином, рейз лимпера, фолд на него, любой рейз, фолд на него, рейз позади, фолд на него]
        if (iz) for (const p of [iz[0], 'TOT']) for (const bd of [iz[2], 'all']) { const M = (a.iso[p] = a.iso[p] || {}), X = ((M[iz[1]] = M[iz[1]] || {})[bd] = M[iz[1]][bd] || [0, 0, 0, 0, 0, 0, 0, 0, 0]); X[0]++; for (let j = 3; j <= 10; j++) X[j - 2] += iz[j]; } // [.., 7] рейз игрока позади, [8] фолд на него
        // oc[поз][1|2][стек] = [раз, колл, сквиз NAI, олл-ин]; TOT — без BB
        if (oc) for (const p of oc[0] === 'BB' ? ['BB'] : [oc[0], 'TOT']) for (const bd of [oc[2], 'all']) { const M = (a.oc[p] = a.oc[p] || {}), X = ((M[oc[1]] = M[oc[1]] || {})[bd] = M[oc[1]][bd] || [0, 0, 0, 0]); X[0]++; if (oc[3]) X[oc[3]]++; }
        // b3i[поз][стек] = [раз, 3-бет NAI, 3-бет олл-ином]
        if (bi) for (const p of [bi[0], 'TOT']) for (const bd of [bi[1], 'all']) { const X = (a.b3i[p] = a.b3i[p] || {})[bd] = a.b3i[p][bd] || [0, 0, 0]; X[0]++; X[1] += bi[2]; X[2] += bi[3]; }
        // s3[размер в бб][поз][стек] = [раз, сумма размера в бб, получили 4-бет, сбросили]
        if (sz) for (const p of [sz[1], 'TOT']) for (const bd of [sz[2], 'all']) { const G = (a.s3[sz[0]] = a.s3[sz[0]] || {}), X = ((G[p] = G[p] || {})[bd] = G[p][bd] || [0, 0, 0, 0]); X[0]++; X[1] += sz[3]; X[2] += sz[4]; X[3] += sz[5]; }
        // f3[поз][ip|oop|all][стек] = [раз, фолд, колл, 4-бет, из них 3-бет олл-ином, фолд на олл-ин]
        if (f3i) for (const p of f3i[0] === 'SB' ? ['SB'] : [f3i[0], 'TOT']) /* TOT — без SB, как RFI */ for (const w of [f3i[1] ? 'ip' : 'oop', 'all']) for (const bd of [f3i[2], 'all']) { const M = (a.f3[p] = a.f3[p] || {}), X = ((M[w] = M[w] || {})[bd] = M[w][bd] || [0, 0, 0, 0, 0, 0, 0, 0, 0]); X[0]++; X[1] += f3i[4]; X[2] += f3i[5]; X[3] += f3i[6]; X[4] += f3i[3]; if (f3i[3] && f3i[4]) X[5]++; X[6] += f3i[7]; if (!f3i[3]) { X[7] += f3i[6]; X[8] += f3i[7]; } } // [6] — 4-бет олл-ином; [7], [8] — 4-бет и 4-бет олл-ином только против 3-бета не олл-ином
        // сквиз: sq[поз][стек] = [раз, сквиз NAI, сквиз AI, после сквиза NAI — рейз на меня, фолд]; sqm[поз][опен+коллер][стек] = [раз, NAI, AI]
        if (oc) { for (const p of [oc[0], 'TOT']) for (const bd of [oc[2], 'all']) { const X = (a.sq[p] = a.sq[p] || {})[bd] = a.sq[p][bd] || [0, 0, 0, 0, 0]; X[0]++; if (oc[3] === 2) X[1]++; if (oc[3] === 3) X[2]++; X[3] += oc[6]; X[4] += oc[7]; }
          if (oc[4] && oc[5] && oc[1] === 1) for (const bd of [oc[2], 'all']) { /* «опен + колл» — ровно один колл (владелец 25.11.2026) */ const M = (a.sqm[oc[0]] = a.sqm[oc[0]] || {}), X = ((M[oc[4] + '+' + oc[5]] = M[oc[4] + '+' + oc[5]] || {})[bd] = M[oc[4] + '+' + oc[5]][bd] || [0, 0, 0]); X[0]++; if (oc[3] === 2) X[1]++; if (oc[3] === 3) X[2]++; } }
        // f4[поз][стек] = [раз (мне 4-бет), 4-бет олл-ином, фолд, колл, 5-бет]
        if (f4i) for (const p of [f4i[0], 'TOT']) for (const bd of [f4i[1], 'all']) { const X = (a.f4[p] = a.f4[p] || {})[bd] = a.f4[p][bd] || [0, 0, 0, 0, 0]; X[0]++; X[1] += f4i[2]; X[2] += f4i[3]; X[3] += f4i[4]; X[4] += f4i[5]; }
        // c3[поз][стек] = [раз, колл 3-бета, холодный 4-бет]
        if (c3i) for (const p of [c3i[0], 'TOT']) for (const bd of [c3i[1], 'all']) { const X = (a.c3[p] = a.c3[p] || {})[bd] = a.c3[p][bd] || [0, 0, 0]; X[0]++; X[1] += c3i[2]; X[2] += c3i[3]; }
        if (h3) for (const k of [h3[0], 'TOT']) { const X = a.h3[k] = a.h3[k] || [0, 0, 0]; X[0]++; if (h3[1]) X[1]++; if (h3[2]) X[2]++; }
        // исходы флопа по ВСЕМ банкам (любое число игроков): с олл-инами префлоп и без
        if (sawFl) { const T = a.tot; T.fl++; if (wentSD) { T.sd++; if (wonH) T.sdw++; } if (wonH) T.won++; if (!preAI) { T.fl2++; if (wentSD) { T.sd2++; if (wonH) T.sdw2++; } if (wonH) T.won2++; } }
        a.ser.push(pt);
        for (const [i, s, hit] of r.cl) if (i === hero) { const o = ((hA * 2 + fi) * NCL + ST.CL.indexOf(s)) * 2; a.cl[o]++; if (hit) a.cl[o + 1]++; }
        for (const [i, o, x] of r.slots) if (i === hero) { a.pf[o]++; if (x >= 0) a.pf[x]++; }
      }
      hands++;
    }
  }
  if (SAMPLE) fs.writeFileSync(path.join(__dirname, 'data', 'samples.json'), JSON.stringify(SMP, null, 1));
  fs.writeFileSync(path.join(__dirname, 'data', 'alias_hm.json'), JSON.stringify(HM)); // матрицы рук алиаса (только на ПК)
  if (AUDIT) fs.writeFileSync(path.join(__dirname, 'data', 'audit.ndjson'), AUD.join('\n'));
  log('алиас: файлов ' + files.length + ', раздач ' + hands + ', дублей (та же раздача под другим номером) ' + dupN + ', пропущено ' + skipped);
  const r2 = (a) => Array.from(a, v => Math.round(v * 100) / 100);
  // график: раздачи по времени, накопительно (bb): выиграл всего, по EV (олл-ины по эквити), на вскрытии, без вскрытия; ≤ 1500 точек
  const graph = (ser) => {
    ser.sort((x, y) => x[0] - y[0]); const N = ser.length, step = Math.max(1, Math.ceil(N / 1500)), out = [];
    let w = 0, e = 0, s = 0, ns = 0;
    ser.forEach((p, k) => { w += p[1]; e += p[2]; if (p[3]) s += p[1]; else ns += p[1]; if ((k + 1) % step === 0 || k === N - 1) out.push([k + 1, Math.round(w), Math.round(e), Math.round(s), Math.round(ns)]); });
    return out;
  };
  return Object.entries(acc).map(([room, a]) => ({ key: 'alias:' + room, room: 'alias', nick: room === 'все' ? 'Я (все румы)' : 'Я · ' + room, n: a.n, ns: a.ns, nf: a.nf, cl: null, cls: Array.from(a.cl), pf: sparse(a.pf), r: r2(a.f), nicks: [...a.nicks].join(', '), ext: JSON.stringify({ raw: r2(a.raw), pos: a.pos, dup: dupN, h3: a.h3, rfi: a.rfi, vso: a.vso, v3m: a.v3m, iso: a.iso, oc: a.oc, b3i: a.b3i, s3: a.s3, f3: a.f3, c3: a.c3, f4: a.f4, sq: a.sq, sqm: a.sqm, tot: a.tot, graph: graph(a.ser) }) }));
}

// ---------- сборка ----------
(async () => {
  if (process.argv.includes('--alias')) { const db = new DatabaseSync(DBF); db.exec('BEGIN'); db.exec("DELETE FROM p WHERE key LIKE 'alias:%'"); const ins = db.prepare('INSERT OR REPLACE INTO p VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'); for (const a of aliasStats()) ins.run(a.key, a.room, a.nick, a.nick.toLowerCase(), a.n, a.ns, a.nf, null, null, null, null, JSON.stringify(a.cls), a.pf, JSON.stringify(a.r), a.nicks, a.ext); db.exec('COMMIT'); db.close(); log('алиас обновлён'); return; }
  const t0 = Date.now();
  const tmp = DBF + '.tmp'; if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  const db = new DatabaseSync(tmp);
  db.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
    CREATE TABLE p (key TEXT PRIMARY KEY, room TEXT, nick TEXT, lc TEXT, n INTEGER, ns INTEGER, nf INTEGER,
      cl INTEGER, cl2 INTEGER, d INTEGER, rel INTEGER, cls TEXT, pf TEXT, r TEXT, nicks TEXT, ext TEXT);
    CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);`);
  const ins = db.prepare('INSERT OR REPLACE INTO p VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const CL = JSON.parse(fs.readFileSync(path.join(OUTD, 'players_cl_all.json'), 'utf8'));
  let n = 0;
  db.exec('BEGIN');
  C.ndForEachSync(path.join(OUTD, 'players_v8.ndjson'), (p) => {
    const c = CL[p.k] || null, i = p.k.indexOf(':'), room = p.k.slice(0, i), nick = p.k.slice(i + 1);
    ins.run(p.k, room, nick, nick.toLowerCase(), p.n, p.ns, p.nf, c ? c[0] : null, c ? c[2] : null, c ? c[1] : null, c ? (c[5] ? 1 : 0) : null, JSON.stringify(p.cl), sparse(p.pf), JSON.stringify(p.r), null, null);
    if (++n % 100000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); log('игроков ' + n); }
  });
  for (const a of aliasStats()) ins.run(a.key, a.room, a.nick, a.nick.toLowerCase(), a.n, a.ns, a.nf, null, null, null, null, JSON.stringify(a.cls), a.pf, JSON.stringify(a.r), a.nicks, a.ext);
  db.exec('COMMIT');
  db.exec('CREATE INDEX i_lc ON p(lc)');
  db.prepare('INSERT INTO meta VALUES (?,?)').run('built', new Date().toISOString());
  db.prepare('INSERT INTO meta VALUES (?,?)').run('players', String(n));
  db.close();
  if (fs.existsSync(DBF)) fs.unlinkSync(DBF);
  fs.renameSync(tmp, DBF);
  log('готово: игроков ' + n + ', база ' + (fs.statSync(DBF).size / 1048576).toFixed(0) + ' МБ, ' + ((Date.now() - t0) / 60000).toFixed(1) + ' мин');
})();
