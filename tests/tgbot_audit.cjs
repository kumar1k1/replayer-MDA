'use strict';
// Полная сверка префлопа алиаса (24.11.2026): НЕЗАВИСИМЫЙ разбор текста раздачи (без парсера Backing и preflopDecisions)
// против того, как раздачу понял build_db (tgbot/data/audit.ndjson, TGBOT_AUDIT=1 node tgbot/build_db.cjs --alias).
// node tests/tgbot_audit.cjs  → сводка расхождений по статам + примеры номеров раздач
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
const C = require(path.join(R, 'pipeline', 'common.cjs')), V = require(path.join(R, 'pipeline', 'convert.cjs'));
const cfg = JSON.parse(fs.readFileSync(path.join(R, 'data', 'practice_alias.json'), 'utf8'));
const AUD = new Map(); for (const ln of fs.readFileSync(path.join(R, 'tgbot', 'data', 'audit.ndjson'), 'utf8').split('\n')) if (ln) { const o = JSON.parse(ln); AUD.set(o.id, o); }
const num = (s) => +String(s).replace(/,/g, '');
const p5k = (k) => (k === 0 ? 'BTN' : k === 1 ? 'CO' : k === 2 ? 'HJ' : k <= 4 ? 'MP' : 'EP');
const p3k = (k) => (k === 0 ? 'BTN' : k === 1 ? 'CO' : k === 2 ? 'HJ' : 'MP');

function indep(h) {
  const L = h.split(/\r?\n/), hi = L.findIndex(l => /^\*\*\* HOLE CARDS/.test(l)); if (hi < 0) return null;
  const end = L.findIndex((l, i) => i > hi && /^\*\*\* /.test(l)), pre = L.slice(hi + 1, end < 0 ? L.length : end);
  const btnSeat = +((/Seat #(\d+) is the button/.exec(h) || [])[1] || 0);
  const seats = {}; for (const l of L.slice(0, hi)) { const m = /^Seat (\d+): (.+?) \(([\d,.]+) in chips/.exec(l); if (m) seats[m[2]] = { seat: +m[1], stack: num(m[3]) }; }
  const posts = {}, ante = {}; let bb = 0;
  for (const l of L.slice(0, hi + 1)) { let m;
    if ((m = /^(.+?): posts small blind ([\d,.]+)/.exec(l))) posts[m[1]] = 'SB';
    if ((m = /^(.+?): posts big blind ([\d,.]+)/.exec(l))) { posts[m[1]] = 'BB'; bb = num(m[2]); }
    if ((m = /^(.+?): posts the ante ([\d,.]+)/.exec(l))) ante[m[1]] = num(m[2]); }
  const hero = (/^Dealt to (.+?) \[/m.exec(h) || [])[1]; if (!hero || !bb) return null;
  const acts = []; for (const l of pre) { const m = /^(.+?): (folds|checks|calls|raises|bets)(?: ([\d,.]+))?(?: to ([\d,.]+))?(.*)$/.exec(l); if (m && seats[m[1]]) acts.push({ who: m[1], t: m[2], to: m[4] ? num(m[4]) : m[3] ? num(m[3]) : 0, ai: /all-in/.test(m[5] || '') }); }
  // кто в раздаче: блайнды + все, кто действовал; порядок мест от SB (или BB) по кругу, BTN — последний
  const inHand = new Set([...Object.keys(posts), ...Object.keys(ante), ...acts.map(a => a.who), hero]); // анте — тоже в раздаче (олл-ин на анте)
  const order = Object.keys(seats).filter(n => inHand.has(n)).sort((a, b) => seats[a].seat - seats[b].seat);
  const sbN = Object.keys(posts).find(n => posts[n] === 'SB'), bbN = Object.keys(posts).find(n => posts[n] === 'BB');
  const anchor = sbN && order.includes(sbN) ? sbN : bbN; if (!anchor) return null;
  const a0 = order.indexOf(anchor), ring = order.slice(a0).concat(order.slice(0, a0)), n = ring.length;
  const label = (name) => { if (name === sbN && n === 2) return 'SB'; if (name === sbN) return 'SB'; if (name === bbN) return 'BB'; const i = ring.indexOf(name); return { k: n - 1 - i }; };
  const P5 = (name) => { const x = label(name); return typeof x === 'string' ? x : p5k(x.k); }, P3 = (name) => { const x = label(name); return typeof x === 'string' ? x : p3k(x.k); };
  const behind = (name) => seats[name].stack - (ante[name] || 0) - (name === sbN ? bb / 2 : 0) - (name === bbN ? bb : 0);
  const isAI = (a) => a.ai || a.to >= (seats[a.who].stack - (ante[a.who] || 0)) * 0.93;
  const hiA = acts.findIndex(a => a.who === hero); if (hiA < 0) return { none: true };
  const before = acts.slice(0, hiA), me = acts[hiA];
  const raises = before.filter(a => a.t === 'raises' || a.t === 'bets'), firstR = before.findIndex(a => a.t === 'raises' || a.t === 'bets');
  const limps = (firstR < 0 ? before : before.slice(0, firstR)).filter(a => a.t === 'calls'), calls = before.filter(a => a.t === 'calls'), callersAfter = firstR < 0 ? [] : before.slice(firstR + 1).filter(a => a.t === 'calls');
  const meRaise = me.t === 'raises' || me.t === 'bets', meAI = meRaise && isAI(me);
  const out = {};
  if (!raises.length && !limps.length && hero !== bbN) out.rf = [P5(hero), meRaise, meRaise && !meAI];
  if (raises.length === 1) {
    const r = raises[0], rAI = isAI(r) || r.to >= Math.min(behind(r.who), behind(hero)) * 0.93;
    if (!limps.length && !callersAfter.length && !rAI) out.vo = [P3(hero), me.t === 'calls' ? 1 : meRaise ? (meAI ? 3 : 2) : 0, P5(r.who), hero === bbN && r.who === sbN];
    if (!limps.length && callersAfter.length && !rAI) out.oc = [P3(hero), callersAfter.length === 1 ? 1 : 2, me.t === 'calls' ? 1 : meRaise ? (meAI ? 3 : 2) : 0];
    if (limps.length === 1 && !callersAfter.length && !rAI) out.bi = [P3(hero), meRaise && !meAI ? 1 : 0, meAI ? 1 : 0];
    if (!limps.length && !callersAfter.length && !rAI && meRaise && !meAI) out.sz = Math.round(me.to / bb * 2) / 2;
  }
  if (!raises.length && limps.length) out.iz = [hero === bbN && limps.every(l => l.who === sbN) ? 'BBsb' : P3(hero), limps.length === 1 ? 1 : 2, meRaise ? 1 : 0, meAI ? 1 : 0];
  if (raises.length === 2 && !calls.length && !limps.length) { const r2 = raises[1]; if (!isAI(r2) && !(r2.to >= behind(hero) * 0.93)) out.c3 = [P3(hero), me.t === 'calls' ? 1 : 0, meRaise ? 1 : 0]; }
  // фолд на 3-бет / 4-бет: мой опен (не олл-ин) → ровно один рейз → никто не коллировал → мой ответ
  if (!raises.length && !limps.length && meRaise && !meAI && hero !== bbN) {
    const rest = acts.slice(hiA + 1), j = rest.findIndex(a => a.who === hero);
    if (j >= 0) { const mid = rest.slice(0, j), rr = mid.filter(a => a.t === 'raises'), cc = mid.filter(a => a.t === 'calls');
      if (rr.length === 1 && !cc.length) { const tb = rr[0].who, nx = rest[j], ip = hero !== sbN && (tb === sbN || tb === bbN) ? 1 : 0;
        out.f3 = [P5(hero), ip, isAI(rr[0]) || rr[0].to >= behind(hero) * 0.93 ? 1 : 0, nx.t === 'folds' ? 1 : 0, nx.t === 'calls' ? 1 : 0, nx.t === 'raises' ? 1 : 0]; } }
  }
  return out;
}

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(f => f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]);
const stat = {}, ex = {}; let seen = 0;
const bump = (k, ok, id, info) => { const s = stat[k] = stat[k] || { ok: 0, bad: 0 }; if (ok) s.ok++; else { s.bad++; (ex[k] = ex[k] || []).length < 8 && ex[k].push(id + '  ' + info); } };
for (const f of walk(cfg['папка']).filter(f => /\.txt$/i.test(f))) {
  const t = fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); if (/^\s*Winamax Poker - Tournament summary/.test(t)) continue;
  let parts;
  if (/^\s*Winamax Poker - Tournament "/m.test(t)) parts = t.split(/\r?\n(?=Winamax Poker - Tournament ")/).filter(h => /^\s*Winamax/.test(h)).map(h => V.wnmxToPS(h.trim()));
  else if (/^\s*Game Hand #/m.test(t)) parts = t.split(/\r?\n(?=Game Hand #)/).filter(h => /^\s*Game Hand/.test(h)).map(h => V.wpnToPS(h.trim(), f));
  else parts = t.split(/\r?\n(?=(?:PokerStars Hand #|CoinPoker Hand #|Poker Hand #))/).map(s => s.trim()).filter(s => /Hand #/.test(s.slice(0, 40))).map(s => (V.isGGasPS(s) ? V.ggToPS(s) : s));
  for (const h of parts) {
    if (!h) continue; const m = /Hand #(\S+?):/.exec(h); if (!m) continue; const id = C.roomOf(h) + '#' + m[1], A = AUD.get(id); if (!A) continue;
    seen++; const I = indep(h); if (!I || I.none) continue;
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    // RFI
    { const a = A.rf ? [A.rf[0], !!A.rf[2], !!A.rf[3]] : null, b = I.rf || null; bump('RFI', eq(a, b), id, 'наш ' + JSON.stringify(a) + ' | текст ' + JSON.stringify(b)); }
    // ответ на опен (3-бет / колд-колл)
    { const a = A.vo ? [A.vo[0], A.vo[2], A.vo[4], !!A.vo[3]] : null, b = I.vo || null; bump('ответ на опен (3-бет, колд-колл)', eq(a, b), id, 'наш ' + JSON.stringify(a) + ' | текст ' + JSON.stringify(b)); }
    { const a = A.oc ? [A.oc[0], A.oc[1], A.oc[3]] : null, b = I.oc || null; bump('колл третьим / четвёртым', eq(a, b), id, 'наш ' + JSON.stringify(a) + ' | текст ' + JSON.stringify(b)); }
    { const a = A.iz ? [A.iz[0], A.iz[1], A.iz[3], A.iz[4]] : null, b = I.iz || null; bump('изолейт', eq(a, b), id, 'наш ' + JSON.stringify(a) + ' | текст ' + JSON.stringify(b)); }
    { const a = A.bi ? [A.bi[0], A.bi[2], A.bi[3]] : null, b = I.bi || null; bump('3-бет против изолейта', eq(a, b), id, 'наш ' + JSON.stringify(a) + ' | текст ' + JSON.stringify(b)); }
    { const a = A.sz ? A.sz[2] : null, b = I.sz != null ? I.sz : null; bump('размер 3-бета (бб)', a === b || (a != null && b != null && Math.abs(Math.round(a * 2) / 2 - b) < 0.01), id, 'наш ' + a + ' | текст ' + b); }
    { const a = A.f3i ? [A.f3i[0], A.f3i[1], A.f3i[3], A.f3i[4], A.f3i[5], A.f3i[6]] : null, b = I.f3 || null; bump('фолд на 3-бет / 4-бет', eq(a, b), id, 'наш ' + JSON.stringify(a) + ' | текст ' + JSON.stringify(b)); }
    { const a = A.c3i ? [A.c3i[0], A.c3i[2], A.c3i[3]] : null, b = I.c3 || null; bump('колл 3-бета в холодную', eq(a, b), id, 'наш ' + JSON.stringify(a) + ' | текст ' + JSON.stringify(b)); }
  }
}
console.log('раздач сверено: ' + seen);
for (const [k, s] of Object.entries(stat)) console.log((k + ':').padEnd(36) + ' совпало ' + s.ok + ', расходится ' + s.bad + (s.bad ? ' (' + (s.bad / (s.ok + s.bad) * 100).toFixed(2) + '%)' : ''));
for (const [k, list] of Object.entries(ex)) { console.log('\n— ' + k); list.forEach(x => console.log('   ' + x)); }
