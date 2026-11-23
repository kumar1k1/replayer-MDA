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
function aliasStats() {
  const cfgF = path.join(ROOT, 'data', 'practice_alias.json');
  if (!fs.existsSync(cfgF)) { log('алиаса нет (data/practice_alias.json) — пропускаю'); return []; }
  const cfg = JSON.parse(fs.readFileSync(cfgF, 'utf8'));
  const mine = new Set(Object.keys(cfg['ники'] || {})); // «рум:ник»
  const P_ = C.loadParser(), { frames } = P_, parse = C.makeParse(P_);
  const acc = {}; // рум → { pf, cl, f, n, ns, nf }
  const A = (room) => acc[room] = acc[room] || { pf: new Float64Array(NPF), cl: new Float64Array(2 * 2 * NCL * 2), f: new Float64Array(24), raw: new Float64Array(24), pos: {}, h3: {}, rfi: {}, vso: {}, v3m: {}, iso: {}, oc: {}, b3i: {}, tot: { fl: 0, sd: 0, won: 0, sdw: 0, fl2: 0, sd2: 0, won2: 0, sdw2: 0 }, ser: [], n: 0, ns: 0, nf: 0, nicks: new Set() };
  // 3-бет как в Hand2Note (сверено 23.11.2026 с его поп-апом владельца, все позиции): против ровно одного рейза,
  // без коллеров (сквиз — отдельно), опен не олл-ином, на BB — не против опена с SB (блайнд против блайнда — отдельно)
  const HF = require(path.join(ROOT, 'lib', 'handfix.js'));
  const distPos = (lab, n) => { if (lab === 'SB' || lab === 'BTN/SB') return 'SB'; if (lab === 'BB' || lab === 'BTN') return lab; const L = HF.POS_NAMES[Math.min(Math.max(n, 2), 9)], d = L.length - L.indexOf(lab); return d === 1 ? 'CO' : d === 2 ? 'HJ' : 'MP'; };
  const tsOf = (d) => { const m = /(\d{4})[\/-](\d\d)[\/-](\d\d)[ T](\d{1,2}):(\d\d):(\d\d)/.exec(String(d || '')); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0; };
  // позиция как в Hand2Note: UTG — только при полном столе (6 из 6, 8 из 8…), иначе первые места — MP; блайнды, BTN, CO — как есть
  // позиция открывшего: EP (5+ мест до баттона) / MP (3–4) / HJ (2) / CO / BTN / SB — как RFI
  const p5of = (lab, n) => { if (!lab) return null; if (/SB/.test(lab)) return 'SB'; if (lab === 'BB') return 'BB'; if (lab === 'BTN') return 'BTN'; const L = HF.POS_NAMES[Math.min(Math.max(n, 2), 9)], i = L.indexOf(lab); if (i < 0) return null; const k = L.length - i; return k === 1 ? 'CO' : k === 2 ? 'HJ' : k <= 4 ? 'MP' : 'EP'; };
  const rfiBand = (x) => x < 12 ? '<12' : x < 20 ? '12-19' : x < 36 ? '20-35' : x < 60 ? '36-59' : x < 100 ? '60-99' : x < 150 ? '100-149' : '150+';
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
      const r = ST.handStats(rp, fr), ps = h2nPos(rp.pl[hero][0], rp.n, C.tableFormat(h).max);
      // 3-бет (Hand2Note), общие исходы флопа, точка графика
      // vo — ответ на опен тем же правилом, что 3-бет: [позиция, стек, действие call|3b|shove|fold]
      let h3 = null, vo = null, oc = null; { let limped = false; const DD = C.preflopDecisions(rp, () => ''); for (const d of DD) { if (d.i !== hero) continue; if (DD.some(x => x.k < d.k && x.act === 'limp')) limped = true; /* лимп до опена у любого — не считаем (сверено: колд-колл BB) */
          // оверколл (24.11.2026): один опен (не олл-ин), до меня 1 или 2+ коллера, лимпов нет — [поз, коллеров 1|2, стек, действие колл 1 / рейз 2 / олл-ин 3 / фолд 0]
          if (!oc && d.nR === 1 && !limped && d.tbl !== 'AI' && (d.C === 'C1' || d.C === 'C2')) oc = [distPos(rp.pl[hero][0], rp.n), d.C === 'C1' ? 1 : 2, rfiBand(d.stackTot), d.act === 'call' ? 1 : /^3bet/.test(d.act) || (d.act === 'raise' && !d.aiAct) ? 2 : d.act === 'shove' || d.act === 'raise' ? 3 : 0]; if (d.nR === 1 && !limped && d.tbl !== 'AI' && (!d.C || d.C === 'C0')) { const p3 = distPos(rp.pl[hero][0], rp.n); const bbSb = p3 === 'BB' && /^(SB|BTN\/SB)$/.test(d.oppPos || ''); if (!bbSb) h3 = [p3, /^3bet/.test(d.act) || (d.act === 'raise' && !d.aiAct), /^3bet/.test(d.act) || d.act === 'shove' || d.act === 'raise']; vo = [p3, rfiBand(d.stackTot), d.act === 'call' ? 1 : /^3bet/.test(d.act) || (d.act === 'raise' && !d.aiAct) ? 2 : d.act === 'shove' || d.act === 'raise' ? 3 : 0, bbSb, p5of(d.oppPos || '', rp.n)]; } if (d.act === 'limp') limped = true; } }
      // RFI как Hand2Note: позиции EP (5+ мест до баттона) / MP (3–4) / HJ (2) / CO / BTN / SB; TOT — любой рейз первым, NAI — без олл-ина; стек — свой, в bb
      let rf = null; { const d0 = C.preflopDecisions(rp, () => '').find(d => d.i === hero); if (d0 && d0.tbl === 'RFI') { const lab = rp.pl[hero][0]; if (lab !== 'BB') { const L = HF.POS_NAMES[Math.min(Math.max(rp.n, 2), 9)], k = lab === 'BTN' ? 0 : L.length - L.indexOf(lab); const p5 = /SB/.test(lab) ? 'SB' : k === 0 ? 'BTN' : k === 1 ? 'CO' : k === 2 ? 'HJ' : k <= 4 ? 'MP' : 'EP'; rf = [p5, rfiBand(d0.stackTot), /^open/.test(d0.act) || d0.act === 'shove', /^open/.test(d0.act)]; } } }
      // изолейт (24.11.2026): первое решение против лимперов без рейза; BB против лимпа одного SB — отдельно («BBsb»: только в TOT).
      // iz = [поз, L 1|2, стек, изо, изо олл-ином, лимпер ответил рейзом, я сбросил на рейз лимпера, любой рейз после изо, я сбросил]
      let iz = null; { const dd = C.preflopDecisions(rp, () => ''), d0 = dd.find(d => d.i === hero);
        if (d0 && d0.tbl === 'ISO') { const pz = distPos(rp.pl[hero][0], rp.n), lim = new Set(dd.filter(d => d.k < d0.k && d.act === 'limp').map(d => d.i)), ai = d0.act === 'shove', iso = /^iso/.test(d0.act) || ai;
          const sbOnly = pz === 'BB' && [...lim].every(j => /SB/.test(rp.pl[j][0]));
          let rl = 0, fl = 0, ra = 0, fa = 0, rb = 0, fb = 0;
          if (iso && !ai) { const nx = dd.find(d => d.i === hero && d.k > d0.k); if (nx) { const rr = rp.ev.filter((e, k) => k > d0.k && k < nx.k && e.st === 0 && e.t === 'r'), f = nx.act === 'fold' ? 1 : 0; if (rr.length) { ra = 1; fa = f; if (rr.every(e => lim.has(e.i))) { rl = 1; fl = f; } else if (rr.every(e => !lim.has(e.i))) { rb = 1; fb = f; } } } }
          iz = [sbOnly ? 'BBsb' : pz, d0.L === 'L1' ? 1 : 2, rfiBand(d0.stackTot), iso ? 1 : 0, ai ? 1 : 0, rl, fl, ra, fa, rb, fb]; } }
      // 3-бет против изолейта (24.11.2026, определение владельца): ровно один лимпер, его изолировали (рейз не олл-ин), после изолейта никто не вошёл, мы 3-бетим
      let bi = null; { const dd = C.preflopDecisions(rp, () => ''), d = dd.find(x => x.i === hero);
        if (d && d.nR === 1 && d.tbl !== 'AI' && (!d.C || d.C === 'C0') && dd.filter(x => x.k < d.k && x.act === 'limp').length === 1) bi = /* ровно один лимпер (владелец) */ [distPos(rp.pl[hero][0], rp.n), rfiBand(d.stackTot), /^3bet/.test(d.act) || (d.act === 'raise' && !d.aiAct) ? 1 : 0, d.act === 'shove' || (d.act === 'raise' && d.aiAct) ? 1 : 0]; }
      const flF = fr.find(x => x.street === 1), sawFl = !!(flF && (rp.bd || []).length >= 3 && !flF.folded[hero]);
      const wentSD = !fin.folded[hero] && fin.folded.filter(x => !x).length >= 2, wonH = fin.won[hero] > 0, preAI = rp.ev.some(e => e.st === 0 && e.ai);
      const pt = [tsOf(rp.date), rb, b, wentSD ? 1 : 0];
      for (const a of [A('все'), A(room)]) {
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
  log('алиас: файлов ' + files.length + ', раздач ' + hands + ', дублей (та же раздача под другим номером) ' + dupN + ', пропущено ' + skipped);
  const r2 = (a) => Array.from(a, v => Math.round(v * 100) / 100);
  // график: раздачи по времени, накопительно (bb): выиграл всего, по EV (олл-ины по эквити), на вскрытии, без вскрытия; ≤ 1500 точек
  const graph = (ser) => {
    ser.sort((x, y) => x[0] - y[0]); const N = ser.length, step = Math.max(1, Math.ceil(N / 1500)), out = [];
    let w = 0, e = 0, s = 0, ns = 0;
    ser.forEach((p, k) => { w += p[1]; e += p[2]; if (p[3]) s += p[1]; else ns += p[1]; if ((k + 1) % step === 0 || k === N - 1) out.push([k + 1, Math.round(w), Math.round(e), Math.round(s), Math.round(ns)]); });
    return out;
  };
  return Object.entries(acc).map(([room, a]) => ({ key: 'alias:' + room, room: 'alias', nick: room === 'все' ? 'Я (все румы)' : 'Я · ' + room, n: a.n, ns: a.ns, nf: a.nf, cl: null, cls: Array.from(a.cl), pf: sparse(a.pf), r: r2(a.f), nicks: [...a.nicks].join(', '), ext: JSON.stringify({ raw: r2(a.raw), pos: a.pos, dup: dupN, h3: a.h3, rfi: a.rfi, vso: a.vso, v3m: a.v3m, iso: a.iso, oc: a.oc, b3i: a.b3i, tot: a.tot, graph: graph(a.ser) }) }));
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
