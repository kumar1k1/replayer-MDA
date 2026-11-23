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
  const A = (room) => acc[room] = acc[room] || { pf: new Float64Array(NPF), cl: new Float64Array(2 * 2 * NCL * 2), f: new Float64Array(24), raw: new Float64Array(24), pos: {}, n: 0, ns: 0, nf: 0, nicks: new Set() };
  // позиция как в Hand2Note: UTG — только при полном столе (6 из 6, 8 из 8…), иначе первые места — MP; блайнды, BTN, CO — как есть
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
      for (const a of [A('все'), A(room)]) {
        a.n++; if (fi === 0) a.ns++; else a.nf++; a.nicks.add(rp.nm[hero]);
        a.f[half]++; a.f[half + 1] += b; a.f[half + 2] += b * b; a.f[fo + half]++; a.f[fo + half + 1] += b; a.f[fo + half + 2] += b * b;
        a.raw[half]++; a.raw[half + 1] += rb; a.raw[half + 2] += rb * rb; a.raw[fo + half]++; a.raw[fo + half + 1] += rb; a.raw[fo + half + 2] += rb * rb;
        const P = a.pos[ps] = a.pos[ps] || [0, 0, 0, 0]; P[0]++; P[1] += rb; P[2] += b; P[3] += rb * rb;
        for (const [i, s, hit] of r.cl) if (i === hero) { const o = ((hA * 2 + fi) * NCL + ST.CL.indexOf(s)) * 2; a.cl[o]++; if (hit) a.cl[o + 1]++; }
        for (const [i, o, x] of r.slots) if (i === hero) { a.pf[o]++; if (x >= 0) a.pf[x]++; }
      }
      hands++;
    }
  }
  log('алиас: файлов ' + files.length + ', раздач ' + hands + ', дублей (та же раздача под другим номером) ' + dupN + ', пропущено ' + skipped);
  const r2 = (a) => Array.from(a, v => Math.round(v * 100) / 100);
  return Object.entries(acc).map(([room, a]) => ({ key: 'alias:' + room, room: 'alias', nick: room === 'все' ? 'Я (все румы)' : 'Я · ' + room, n: a.n, ns: a.ns, nf: a.nf, cl: null, cls: Array.from(a.cl), pf: sparse(a.pf), r: r2(a.f), nicks: [...a.nicks].join(', '), ext: JSON.stringify({ raw: r2(a.raw), pos: a.pos, dup: dupN }) }));
}

// ---------- сборка ----------
(async () => {
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
