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
  if (!bb) { const lv = /\(([\d,.]+)\/([\d,.]+)/.exec(L[0]); if (lv) bb = num(lv[2]); } /* BB олл-ином на анте: «posts big blind 0» — размер блайнда из шапки */
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

// размер моей первой ставки на улице по тексту раздачи (% банка перед ставкой): анте, блайнды, «calls N» добавляет, «raises A to B» / «bets N» — ставка улицы
function textSizes(h) {
  const hero = (/^Dealt to (.+?) \[/m.exec(h) || [])[1]; if (!hero) return null;
  const out = {}; let pot = 0, cur = {}, st = 0;
  for (const l of h.split(/\r?\n/)) {
    if (/^\*\*\* (FLOP|TURN|RIVER) \*\*\*/.test(l)) { pot += Object.values(cur).reduce((a, b) => a + b, 0); cur = {}; st++; continue; }
    if (/^\*\*\* (SHOW ?DOWN|SUMMARY)/.test(l)) break;
    let m;
    if ((m = /^(.+?): posts the ante ([\d,.]+)/.exec(l))) { pot += num(m[2]); continue; }
    if ((m = /^(.+?): posts (?:small|big) blind ([\d,.]+)/.exec(l))) { cur[m[1]] = (cur[m[1]] || 0) + num(m[2]); continue; }
    if ((m = /^(.+?): calls ([\d,.]+)/.exec(l))) { cur[m[1]] = (cur[m[1]] || 0) + num(m[2]); continue; }
    if ((m = /^(.+?): raises [\d,.]+ to ([\d,.]+)/.exec(l))) { cur[m[1]] = num(m[2]); continue; }
    if ((m = /^(.+?): bets ([\d,.]+)/.exec(l))) { const p = pot + Object.values(cur).reduce((a, b) => a + b, 0); if (m[1] === hero && st >= 1 && out[st] == null) out[st] = p ? Math.max(1, Math.round(num(m[2]) / p * 100)) : 0; cur[m[1]] = num(m[2]); continue; }
    if ((m = /^(.+?): (checks|folds)/.exec(l)) && m[1] === hero && st >= 1 && out[st] == null) out[st] = 0;
  }
  return out;
}
// линии мультивея по тексту раздачи: на каждой улице — мои ходы (X B C R F), размер моей ставки (% банка), рейз во сколько раз ×10, что было после моей ставки / рейза (1 все сбросили, 2 колл, 3 рейз)
function textLines(h) {
  const hero = (/^Dealt to (.+?) \[/m.exec(h) || [])[1]; if (!hero) return null;
  const S = [null, { a: [] }, { a: [] }, { a: [] }]; let st = 0, pot = 0, cur = {};
  for (const l of h.split(/\r?\n/)) {
    if (/^\*\*\* (FLOP|TURN|RIVER) \*\*\*/.test(l)) { pot += Object.values(cur).reduce((x, y) => x + y, 0); cur = {}; st++; continue; }
    if (/^\*\*\* (SHOW ?DOWN|SUMMARY)/.test(l)) break; let m;
    if ((m = /^(.+?): posts the ante ([\d,.]+)/.exec(l))) { pot += num(m[2]); continue; }
    if ((m = /^(.+?): posts (?:small|big) blind ([\d,.]+)/.exec(l))) { cur[m[1]] = (cur[m[1]] || 0) + num(m[2]); continue; }
    if (!(m = /^(.+?): (checks|bets|calls|raises|folds)(?: ([\d,.]+))?(?: to ([\d,.]+))?/.exec(l))) continue;
    const who = m[1], t = { checks: 'X', bets: 'B', calls: 'C', raises: 'R', folds: 'F' }[m[2]], amt = m[4] ? num(m[4]) : m[3] ? num(m[3]) : 0, potNow = pot + Object.values(cur).reduce((x, y) => x + y, 0);
    if (st >= 1) S[st].a.push({ who, t, amt, potNow });
    if (t === 'C') cur[who] = (cur[who] || 0) + amt; else if (t === 'B' || t === 'R') cur[who] = amt;
  }
  return [1, 2, 3].map(s => { const A = S[s].a, my = A.filter(x => x.who === hero); if (!my.length) return ['', 0, 0, 0];
    const line = my.map(x => x.t).join(''), ag = my.find(x => x.t === 'B' || x.t === 'R'); let sz = 0, rx = 0, out = 0;
    if (ag) { const k = A.indexOf(ag); if (ag.t === 'B') sz = ag.potNow ? Math.max(1, Math.round(ag.amt / ag.potNow * 100)) : 0; else { const prev = A.slice(0, k).filter(x => x.who !== hero && (x.t === 'B' || x.t === 'R')).pop(); rx = prev && prev.amt ? Math.round(ag.amt / prev.amt * 10) : 0; }
      const after = A.slice(k + 1); out = after.some(x => x.who !== hero && x.t === 'R') ? 3 : after.some(x => x.who !== hero && x.t === 'C') ? 2 : 1; }
    return [line, sz, out, rx]; });
}
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(f => f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]);
const stat = {}, ex = {}, IND = {}, SKIP = [], SKC = new Set(), SZ = { n: 0, ok: 0, bad: [] }, MLC = { n: 0, ok: 0, bad: [] }, SUC = { n: 0, ok: 0, bad: [] }; let seen = 0;
const bump = (k, ok, id, info) => { const s = stat[k] = stat[k] || { ok: 0, bad: 0 }; if (ok) s.ok++; else { s.bad++; (ex[k] = ex[k] || []).length < 8 && ex[k].push(id + '  ' + info); } };
for (const f of walk(cfg['папка']).filter(f => /\.txt$/i.test(f))) {
  const t = fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); if (/^\s*Winamax Poker - Tournament summary/.test(t)) continue;
  let parts;
  if (/^\s*Winamax Poker - Tournament "/m.test(t)) parts = t.split(/\r?\n(?=Winamax Poker - Tournament ")/).filter(h => /^\s*Winamax/.test(h)).map(h => V.wnmxToPS(h.trim()));
  else if (/^\s*Game Hand #/m.test(t)) parts = t.split(/\r?\n(?=Game Hand #)/).filter(h => /^\s*Game Hand/.test(h)).map(h => V.wpnToPS(h.trim(), f));
  else parts = t.split(/\r?\n(?=(?:PokerStars Hand #|CoinPoker Hand #|Poker Hand #))/).map(s => s.trim()).filter(s => /Hand #/.test(s.slice(0, 40))).map(s => (V.isGGasPS(s) ? V.ggToPS(s) : s));
  for (const h of parts) {
    if (!h) continue; const m = /Hand #(\S+?):/.exec(h); if (!m) continue; const id = C.roomOf(h) + '#' + m[1], A = AUD.get(id); if (!A) continue;
    seen++; const I = indep(h); if (!I || I.none) { { const cm2 = /^Dealt to .+? \[(\S\S) (\S\S)\]/m.exec(h); if (cm2) { const R2 = 'AKQJT98765432', a1 = R2.indexOf(cm2[1][0].toUpperCase()), a2 = R2.indexOf(cm2[2][0].toUpperCase()), x = Math.min(a1, a2), y = Math.max(a1, a2); SKC.add(x === y ? R2[x] + R2[y] : R2[x] + R2[y] + (cm2[1][1] === cm2[2][1] ? 's' : 'o')); } const sit = ['rf', 'vo', 'oc', 'iz', 'bi', 'f3i', 'c3i'].filter(k => A[k]); SKIP.push(id + (I && I.none ? ' (герой не действовал префлоп)' : ' (второй разбор не прочитал: нет блайнда / героя)') + (sit.length ? ' — а подсчёт взял: ' + sit.join(',') + ' ' + JSON.stringify(sit.map(k => A[k])) : '')); } continue; }
    // независимые матрицы рук: класс руки из «Dealt to» и ситуация из независимого разбора — те же пути, что в alias_hm.json
    { const cm = /^Dealt to .+? \[(\S\S) (\S\S)\]/m.exec(h); if (cm) { const R = 'AKQJT98765432', r1 = R.indexOf(cm[1][0].toUpperCase()), r2 = R.indexOf(cm[2][0].toUpperCase()), hi = Math.min(r1, r2), lo = Math.max(r1, r2), CLS = hi === lo ? R[hi] + R[lo] : R[hi] + R[lo] + (cm[1][1] === cm[2][1] ? 's' : 'o');
      const H = (p, m, num) => { const o = ((IND[p] = IND[p] || {})[m] = IND[p][m] || {}); const c = o[CLS] = o[CLS] || [0, 0]; c[0]++; if (num) c[1]++; };
      if (I.rf) for (const p of I.rf[0] === 'SB' ? ['SB'] : [I.rf[0], 'TOT']) { H('rfi|' + p, 'tot', I.rf[1]); H('rfi|' + p, 'nai', I.rf[2]); }
      if (I.vo) { const [p3, act, op, bbSb] = I.vo, keys = bbSb ? ['TOT'] : p3 === 'BB' ? ['BB', 'TOT'] : [p3, 'TOT', 'TOTnb'], M = { call: act === 1, b3: act === 2, ai: act === 3, b3all: act >= 2, fold: act === 0 };
        for (const p of keys) for (const [m, v] of Object.entries(M)) H('vso|' + p, m, v); for (const [m, v] of Object.entries(M)) H('v3m|' + p3 + '|' + op, m, v); }
      if (I.oc) { for (const p of I.oc[0] === 'BB' ? ['BB'] : [I.oc[0], 'TOT']) H('oc|' + p + '|' + I.oc[1], 'call', I.oc[2] === 1); for (const p of [I.oc[0], 'TOT']) { H('sq|' + p, 'sqz', I.oc[2] >= 2); H('sq|' + p, 'nai', I.oc[2] === 2); } }
      if (I.bi) for (const p of [I.bi[0], 'TOT']) { H('b3i|' + p, 'b3all', I.bi[1] || I.bi[2]); H('b3i|' + p, 'nai', I.bi[1]); }
      if (I.iz) for (const p of [I.iz[0], 'TOT']) { H('iso|' + p + '|' + I.iz[1], 'iso', I.iz[2]); H('iso|' + p + '|' + I.iz[1], 'isoai', I.iz[3]); }
      if (I.c3) for (const p of [I.c3[0], 'TOT']) H('c3|' + p, 'call', I.c3[1]);
      if (I.f3) for (const p of I.f3[0] === 'SB' ? ['SB'] : [I.f3[0], 'TOT']) for (const w of [I.f3[1] ? 'ip' : 'oop', 'all']) { H('f3|' + p + '|' + w, 'fold', I.f3[3]); H('f3|' + p + '|' + w, 'call', I.f3[4]); }
    } }
    /* успешность ставки (pc.fo / bk.fo — что было после моей ставки на улице) против текста */ for (const X of [A.pc, A.bk]) { if (!X || !X.fo) continue; const T = textLines(h); if (!T) continue; for (let s = 0; s < 3; s++) { SUC.n++; const want = (T[s][0] || '')[0] === 'B' ? T[s][2] : 0; if (X.fo[s] === want) SUC.ok++; else if (SUC.bad.length < 10) SUC.bad.push(id + ' улица ' + (s + 1) + ': подсчёт ' + X.fo[s] + ', текст ' + want + ' (' + T[s][0] + ')'); } }
    /* линии мультивея: подсчёт (ml) против текста — линия, размер ставки, рейз во сколько раз, что было после */ if (A.ml) { const T = textLines(h); if (T) for (let s = 0; s < 3; s++) { MLC.n++; const x = A.ml.st[s], t = T[s], ok = x[0] === t[0] && Math.abs(x[1] - t[1]) <= 1 && x[2] === t[2] && Math.abs((x[3] || 0) - t[3]) <= 1; if (ok) MLC.ok++; else if (MLC.bad.length < 10) MLC.bad.push(id + ' улица ' + (s + 1) + ': подсчёт ' + JSON.stringify(x) + ', текст ' + JSON.stringify(t)); } }
    /* размеры ставок: подсчёт (pc / bk) против текста */ { const T = textSizes(h), X = A.pc || A.bk; if (T && X) for (const [st, k] of [[1, 'szF'], [2, 'szT'], [3, 'szR']]) { if (!X[k]) continue; SZ.n++; const tv = T[st]; if (tv != null && Math.abs(tv - X[k]) <= 1) SZ.ok++; else if (SZ.bad.length < 10) SZ.bad.push(id + ' улица ' + st + ': подсчёт ' + X[k] + '%, текст ' + tv + '%'); } }
    /* конбеты против BB (26.11.2026): соперник на флопе один на один — тот, кто поставил большой блайнд (по тексту) */ if (A.pc && A.pc.n === 1) { const hero = (/^Dealt to (.+?) \[/m.exec(h) || [])[1], bbN = (/^(.+?): posts big blind/m.exec(h) || [])[1], fi = h.search(/^\*\*\* FLOP \*\*\*/m), fe = h.slice(fi + 5).search(/^\*\*\* /m), fl = fi < 0 ? '' : h.slice(fi, fe < 0 ? undefined : fi + 5 + fe), act = new Set([...fl.matchAll(/^(.+?): (checks|bets|calls|raises|folds)/gm)].map(x => x[1])); act.delete(hero); const opp = [...act][0]; bump('против BB один на один (соперник на флопе — BB)', (A.pc.oppBB === 1) === (act.size === 1 && !!bbN && bbN !== hero && opp === bbN), id, 'наш ' + A.pc.oppBB + ' | текст: BB ' + bbN + ', соперник ' + opp); { const sbN = (/^(.+?): posts small blind/m.exec(h) || [])[1]; bump('против SB один на один (соперник на флопе — SB)', (A.pc.oppSB === 1) === (act.size === 1 && !!sbN && sbN !== hero && hero !== bbN && opp === sbN), id, 'наш ' + A.pc.oppSB + ' | текст: SB ' + sbN + ', соперник ' + opp); } }
    /* Total CBET против BB: мой ответ на рейз после ставки на флопе / тёрне / ривере (линия конбетов) против текста — второй мой ход на улице после бета */ if (A.pc && (A.pc.oppBB || A.pc.oppSB)) { const T = textLines(h); if (T) { const code = (s, ok) => { const l = T[s][0] || ''; return ok && l[0] === 'B' && l.length >= 2 ? ({ F: 1, C: 2, R: 3 })[l[1]] || 0 : 0; }, fr = A.pc.fr ? ({ f: 1, c: 2, r: 3 })[A.pc.fr[1]] || 4 : 0;
      if (A.pc.gRs) bump('против BB / SB: ответ на рейз после любой моей ставки (отложки)', [0, 1, 2].every(s => (A.pc.gRs[s] === 4 ? 0 : A.pc.gRs[s]) === (((T[s][0] || '')[0] === 'B' && (T[s][0] || '').length >= 2) ? ({ F: 1, C: 2, R: 3 })[(T[s][0] || '')[1]] || 0 : 0)), id, 'наш ' + A.pc.gRs + ' | текст ' + T.map(x => x[0]).join('/'));
      bump('Total CBET: ответ на рейз после ставки (флоп / тёрн / ривер)', fr === code(0, A.pc.f[1]) && A.pc.tRs === code(1, A.pc.t[1]) && A.pc.rRs === code(2, A.pc.r[1]), id, 'наш ' + [fr, A.pc.tRs, A.pc.rRs] + ' | текст ' + [code(0, A.pc.f[1]), code(1, A.pc.t[1]), code(2, A.pc.r[1])] + ' ' + T.map(x => x[0]).join('/')); } }
    /* Total CBET: рейз на мою ставку на тёрне / ривере — олл-ин? (по тексту: «raises … and is all-in» соперника на улице) */ if (A.pc && (A.pc.oppBB || A.pc.oppSB) && (A.pc.tRs || A.pc.rRs)) { const hero = (/^Dealt to (.+?) \[/m.exec(h) || [])[1], sec = (nm) => { const i = h.search(new RegExp('^\\*\\*\\* ' + nm + ' \\*\\*\\*', 'm')); if (i < 0) return ''; const j = h.slice(i + 5).search(/^\*\*\* /m); return h.slice(i, j < 0 ? undefined : i + 5 + j); }, aiOf = (t) => { const x = [...t.matchAll(/^(.+?): raises (.*)$/gm)].find(m => m[1] !== hero); return x && /and is all-in/.test(x[2]) ? 1 : 0; }; /* первый рейз соперника на улице (чек-рейз) */
      bump('Total CBET: чек-рейз олл-ином (тёрн / ривер)', (A.pc.tRs ? aiOf(sec('TURN')) : 0) === A.pc.tAI && (A.pc.rRs ? aiOf(sec('RIVER')) : 0) === A.pc.rAI, id, 'наш ' + [A.pc.tAI, A.pc.rAI] + ' | текст ' + [A.pc.tRs ? aiOf(sec('TURN')) : 0, A.pc.rRs ? aiOf(sec('RIVER')) : 0] + ' | ' + (sec('TURN') + sec('RIVER')).split(/\r?\n/).filter(l => / (raises|bets|calls|checks|folds)/.test(l)).map(l => (l.startsWith(hero + ':') ? 'я' : 'он') + l.slice(l.indexOf(':'))).join(' ; ')); }
    /* Total CBET: линия CB · XX · B против текста — конбет заколлирован, на тёрне я только чекнул (в позиции — после чека соперника), на ривере мой первый ход — бет или чек */ if (A.pc && (A.pc.oppBB || A.pc.oppSB) && A.pc.ip) { const T = textLines(h); if (T) { const op = T[0][0] === 'B' && T[0][2] === 2 && T[1][0] === 'X' && /^[BX]/.test(T[2][0]) ? 1 : 0, bt = op && T[2][0][0] === 'B' ? 1 : 0;
      bump('Total CBET: линия CB · XX · B', A.pc.drB[0] === op && A.pc.drB[1] === bt, id, 'наш ' + A.pc.drB + ' | текст ' + [op, bt] + ' ' + T.map(x => x[0]).join('/')); } }
    /* игра против пробов (27.11.2026): ставка соперника до моего первого хода на улице (проб) и его ответ на мой рейз — против текста */ if (A.pc && (A.pc.oppBB || A.pc.oppSB) && A.pc.oB) { const hero = (/^Dealt to (.+?) \[/m.exec(h) || [])[1], secs = h.split(/^\*\*\* /m), sec = (nm) => (secs.find(x => x.startsWith(nm + ' ***')) || ''), ok = [1, 2, 3].every((st) => { const lines = sec(['FLOP', 'TURN', 'RIVER'][st - 1]).split(/\r?\n/).map(l => /^(.+?): (checks|bets|calls|raises|folds)/.exec(l)).filter(Boolean), k = lines.findIndex(m => m[1] === hero), bet = k > 0 && lines.slice(0, k).some(m => m[1] !== hero && m[2] === 'bets') ? 1 : 0, kr = lines.findIndex(m => m[1] === hero && m[2] === 'raises'), af = kr < 0 ? [] : lines.slice(kr + 1).filter(m => m[1] !== hero), rx = kr < 0 ? 0 : af.some(m => m[2] === 'raises') ? 3 : af.some(m => m[2] === 'calls') ? 2 : 1; return (A.pc.oB[st - 1] > 0 ? 1 : 0) === bet && A.pc.mRx[st - 1] === rx; });
      bump('против BB / SB: проб соперника и ответ на мой рейз (флоп / тёрн / ривер)', ok, id, 'наш ' + A.pc.oB + ' / ' + A.pc.mRx); }
    /* линии рейзера против BB (27.11.2026): мои ходы по улицам и олл-ин моей ставки — против текста */ if (A.pc && (A.pc.oppBB || A.pc.oppSB) && A.pc.lns) { const T = textLines(h); if (T) { const hero = (/^Dealt to (.+?) \[/m.exec(h) || [])[1], sec = (nm) => { const i = h.search(new RegExp('^\\*\\*\\* ' + nm + ' \\*\\*\\*', 'm')); if (i < 0) return ''; const j = h.slice(i + 5).search(/^\*\*\* /m); return h.slice(i, j < 0 ? undefined : i + 5 + j); };
      const tAI = ['FLOP', 'TURN', 'RIVER'].map(nm => { const l = sec(nm).split(/\r?\n/).find(x => x.startsWith(hero + ': ') && / (checks|bets|calls|raises|folds)/.test(x)); return l && / bets /.test(l) && /and is all-in/.test(l) ? 1 : 0; });
      bump('линии против BB: мои ходы и олл-ин по улицам', A.pc.lns.join('/') === T.map(x => x[0]).join('/') && A.pc.bAI.join('') === tAI.join(''), id, 'наш ' + A.pc.lns.join('/') + ' ' + A.pc.bAI.join('') + ' | текст ' + T.map(x => x[0]).join('/') + ' ' + tAI.join('')); } }
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
// сравнение независимых матриц с alias_hm.json (все стеки): по каждому пути, действию и руке
{ const HMJ = JSON.parse(fs.readFileSync(path.join(R, 'tgbot', 'data', 'alias_hm.json'), 'utf8')); let cells = 0, same = 0; const diff = [];
  for (const [p, ms] of Object.entries(IND)) for (const [m, cls] of Object.entries(ms)) { const ours = (HMJ[p] && HMJ[p][m] && HMJ[p][m].all) || {};
    for (const c of new Set([...Object.keys(cls), ...Object.keys(ours)])) { cells++; const a = cls[c] || [0, 0], b = ours[c] || [0, 0]; if (a[0] === b[0] && a[1] === b[1]) same++; else diff.push(p + ' · ' + m + ' · ' + c + ': текст ' + a.join('/') + ', подсчёт ' + b.join('/')); } }
  console.log('\nматрицы рук: сравнено клеток (путь × действие × рука): ' + cells + ', совпало: ' + same + ', расходится: ' + diff.length); diff.slice(0, 25).forEach(x => console.log('   ' + x)); }
console.log('\nраздач, которые второй разбор пропустил: ' + SKIP.length + ', из них подсчёт взял в статы: ' + SKIP.filter(x => /подсчёт взял/.test(x)).length); SKIP.filter(x => /подсчёт взял/.test(x)).slice(0, 30).forEach(x => console.log('   ' + x));
console.log('\nразмеры ставок (флоп / тёрн / ривер) против текста: ' + SZ.n + ', совпало: ' + SZ.ok + ', расходится: ' + (SZ.n - SZ.ok)); SZ.bad.forEach(x => console.log('   ' + x));
console.log('\nлинии мультивея (улица × раздача: ходы, размер ставки, рейз во сколько раз, что было после) против текста: ' + MLC.n + ', совпало: ' + MLC.ok + ', расходится: ' + (MLC.n - MLC.ok)); MLC.bad.forEach(x => console.log('   ' + x));
console.log('\nуспешность ставок (что было после моей ставки на улице: все сбросили / колл / рейз) против текста: ' + SUC.n + ', совпало: ' + SUC.ok + ', расходится: ' + (SUC.n - SUC.ok)); SUC.bad.forEach(x => console.log('   ' + x));
