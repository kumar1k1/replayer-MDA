'use strict';
// Реплеер replayer-MDA: загрузка историй, список раздач, разбор героя. Стол — реплеер MDA Lab (js/replayer.js),
// подсказки — панель «Сейчас ход» (js/advisor.js).
(function () {
  const SP = window.RMSpots, E8 = window.RMEngine8, K = window.RMCards, CLU = window.RMClusters;
  const ENG = E8.create(window.RM_MODEL, window.RM_EQ, { sizes: window.RM_SIZES, lineup: window.RM_LINEUP });
  const PLAYERS = window.RM_PLAYERS || {};
  const roomOf = (t) => (/^\s*CoinPoker/.test(t) ? 'coin' : /^\s*PokerStars/.test(t) ? 'ps' : 'other');
  const ROOM_RU = { ps: 'PokerStars', coin: 'CoinPoker' };

  // ---------- игроки базы: кластер, группа, счётчики для лайнапа ----------
  const pfCache = new Map();
  function player(room, nick) {
    const k = room + ':' + nick, p = PLAYERS[k]; if (!p) return null;
    let pf = pfCache.get(k);
    if (!pf) { pf = new Int32Array(315); if (p[5]) for (const s of p[5].split(',')) { const [o, v] = s.split(':'); pf[+o] = +v; } pfCache.set(k, pf); }
    return { cl: p[0], d: p[1], cl2: p[2], hands: p[3], reliable: !!p[4], pf, grp: CLU.GROUP[p[0]] || 'unk' };
  }
  const GRU = { reg: 'рег', nit: 'нит', fish: 'фиш', superfish: 'суперфиш', unk: 'нет в базе' };

  // ---------- запись Backing → запись реплеера MDA Lab (суммы в BB, улицы, вскрытия) ----------
  const r4 = (v) => Math.round(v * 10000) / 10000;
  function toRec(rp, hero) {
    const bb = rp.bb, ev = [];
    for (const e of rp.ev) {
      if (e.t === 'S') { ev.push([e.st, -1, 'S', 0]); continue; }
      if (!(e.i >= 0)) continue;
      const s = e.t === 'A' || e.t === 'SB' || e.t === 'BB' ? 0 : e.t === 'W' ? 4 : (e.st || 0);
      ev.push([s, e.i, e.t, r4((e.a || 0) / bb), e.ai ? 1 : 0]);
    }
    const sh = {}; for (const k in rp.sh || {}) if (rp.sh[k]) sh[k] = String(rp.sh[k]).trim();
    const hc = (rp.hero === hero && rp.hc) ? String(rp.hc).trim() : sh[hero] || null;
    const tm = String(rp.date || '').match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{1,2}:\d{2})/);
    return { pl: rp.pl.map((p, j) => [p[0], r4(rp.stacks[j] / bb), j === hero ? 1 : 0]), h: hero, hc, ev, bd: rp.bd || [], sh, t: rp.title || '', d: tm ? tm[1] + '-' + tm[2] + '-' + tm[3] + ' ' + tm[4] : '', c: bb, bb: 1, nm: rp.nm.slice() };
  }

  // ---------- подсказки по всем решениям префлопа раздачи ----------
  function analyse(H) {
    if (H.adv) return H.adv;
    const rp = H.rp, room = H.room;
    const grpOf = (nick) => { const p = player(room, nick); return p ? p.grp : 'unk'; };
    const ds = E8.decisionsBacking(rp, grpOf, '', room);
    const info = (j) => player(room, rp.nm[j]);
    H.adv = ds.map(d => {
      const cs = d.i === H.hero ? (H.rec.hc || null) : (H.rec.sh[d.i] || null);
      const cards = cs && K.parseCards(cs) && K.parseCards(cs).length === 2 ? K.parseCards(cs) : null;
      let a = null, v = null, err = null;
      try { a = ENG.advise(d, cards, info); v = ENG.verdict(a, d.act, d.sz); } catch (e) { err = e.message; }
      return { d, cards, a, v, err };
    });
    return H.adv;
  }

  // ---------- загрузка ----------
  const SPLIT = /\r?\n(?=(?:PokerStars Hand #|CoinPoker Hand #))/;
  function load(text) {
    const parts = text.replace(/^﻿/, '').split(SPLIT).map(s => s.trim()).filter(s => /^(PokerStars|CoinPoker) Hand #/.test(s));
    let bad = 0;
    for (const t of parts) {
      let rp = null; try { rp = window.BKP.parse(t); } catch (e) { rp = null; }
      if (!rp || !rp.n || !rp.bb || !rp.pl || rp.pl.length < 2) { bad++; continue; }
      window.HANDS.push({ text: t, rp, room: roomOf(t), hero: -1, rec: null, adv: null });
    }
    return { added: parts.length - bad, bad };
  }
  // герой: ник «Dealt to» (ваши раздачи) или выбранный в списке; без героя — игрок, чьи карты известны
  function setHero(nick) {
    window.HANDS.forEach((H, i) => {
      const rp = H.rp; let h = nick ? rp.nm.indexOf(nick) : -1;
      if (h < 0 && rp.hero != null && rp.hero >= 0) h = rp.hero;
      if (h < 0) { const k = Object.keys(rp.sh || {}).find(k => rp.sh[k]); h = k != null ? +k : 0; }
      H.hero = h; H.rec = toRec(rp, h); H.adv = null;
      window.DB.cols.room[i] = H.room === 'coin' ? 1 : 0;
      const net = netOf(H); window.DB.cols.net[i] = Math.round(net * 10); window.DB.cols.nev[i] = Math.round(net * 10);
    });
  }
  function netOf(H) {
    const fr = window.Replay.frames(H.rec), f = fr[fr.length - 1];
    return f.stacks[H.hero] - H.rec.pl[H.hero][1];
  }

  // ---------- список и разбор героя ----------
  const $ = (s) => document.querySelector(s);
  const fmt = (v) => (Math.round(v * 100) / 100).toString().replace('.', ',');
  const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));
  const KIND = { 'лучшее': 'ok', 'близко': 'near', 'вероятно хуже': 'warn', 'отклонение': 'warn', 'ошибка': 'bad', 'нет данных': 'none', 'частое у топов': 'near', 'редкое у топов': 'warn' };
  function cardsEl(cs) { const w = el('span', 'tv-cards'); if (!cs) { w.append(el('i', 'tv-c', '··')); return w; } for (const c of cs.split(/\s+/)) { const x = el('i', 'tv-c s-' + c[1], (c[0] === 'T' ? '10' : c[0]) + ({ s: '♠', h: '♥', d: '♦', c: '♣' })[c[1]]); w.append(x); } return w; }
  function render() {
    const list = $('#list'); list.replaceChildren();
    const N = window.HANDS.length; $('#count').textContent = N ? N + ' раздач' : '';
    let tot = { n: 0, ok: 0, bad: 0, loss: 0, warn: 0 };
    window.HANDS.forEach((H, i) => {
      const adv = analyse(H), mine = adv.filter(x => x.d.i === H.hero);
      const row = el('button', 'tv-h rm-row'); row.type = 'button';
      const top = el('div', 'tv-ht');
      top.append(el('span', 'tv-no', '#' + (i + 1)), cardsEl(H.rec.hc), el('span', 'tv-pos ' + ('p-' + ({ BTN: 'bt', SB: 'sb', BB: 'bb', CO: 'co', HJ: 'hj' })[H.rec.pl[H.hero][0]] || ''), H.rec.pl[H.hero][0]), el('span', 'tv-stk', fmt(H.rec.pl[H.hero][1]) + ' BB'), el('span', 'tv-lvl', ROOM_RU[H.room] + ' · ' + (H.rec.t || '')));
      const net = H.rec ? netOf(H) : 0; const nt = el('span', 'tv-net', sgn(net) + ' BB'); top.append(nt);
      row.classList.add(net > 0.05 ? 'w1' : net < -0.05 ? 'l1' : 'x');
      const st = el('div', 'tv-st');
      for (const x of mine) {
        if (!x.v) continue; const k = KIND[x.v.kind] || 'none';
        const chip = el('span', 'rm-vchip ' + k, (x.a ? x.a.tbl : '') + ': ' + (E8.actClass(x.d.act) === 'shove' ? 'олл-ин' : ({ fold: 'фолд', call: 'колл', limp: 'лимп', check: 'чек', open: 'опен', iso: 'изо', '3bet': '3-бет', '4bet': '4-бет' })[E8.actClass(x.d.act)] || x.d.act) + (k === 'bad' ? ' −' + fmt(x.v.d) : k === 'ok' ? ' ✓' : ''));
        chip.title = x.v.text; st.append(chip);
        tot.n++; if (k === 'ok' || k === 'near') tot.ok++; if (k === 'bad') { tot.bad++; tot.loss += x.v.d; } if (k === 'warn') tot.warn++;
      }
      if (!mine.length) st.append(el('span', 'tv-st dim', 'без решений на префлопе'));
      row.append(top, st);
      row.onclick = () => window.openReplayer(i, window.HANDS.map((_, q) => q), { side: window.RM_SIDE });
      list.append(row);
    });
    const sum = $('#review'); sum.replaceChildren();
    if (tot.n) {
      const b = (t, v, c) => { const d = el('div', 'rm-kpi ' + (c || '')); d.append(el('b', null, v), el('span', null, t)); return d; };
      sum.append(b('решений героя на префлопе', String(tot.n)), b('лучшие или в пределах шума', Math.round(tot.ok / tot.n * 100) + '%', 'ok'), b('отклонения от игры топов', String(tot.warn), 'warn'), b('ошибки по EV', tot.bad + (tot.bad ? ' · −' + fmt(tot.loss) + ' BB' : ''), tot.bad ? 'bad' : ''));
    }
  }
  function nickList() {
    const cnt = {}; for (const H of window.HANDS) { const h = H.rp.hero; if (h != null && h >= 0) cnt[H.rp.nm[h]] = (cnt[H.rp.nm[h]] || 0) + 1; }
    if (!Object.keys(cnt).length) for (const H of window.HANDS) for (const nm of H.rp.nm) cnt[nm] = (cnt[nm] || 0) + 1;
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 40);
  }
  function refreshHero() {
    const sel = $('#hero'), cur = sel.value; sel.replaceChildren();
    const L = nickList(); for (const [nm, c] of L) { const o = el('option', null, nm + ' · ' + c); o.value = nm; sel.append(o); }
    sel.value = cur && L.some(x => x[0] === cur) ? cur : (L[0] ? L[0][0] : '');
    setHero(sel.value); render();
  }
  async function readFiles(files) {
    let add = 0, bad = 0;
    for (const f of files) { const r = load(await f.text()); add += r.added; bad += r.bad; }
    $('#msg').textContent = 'Загружено раздач: ' + add + (bad ? ' · не разобрано: ' + bad : '');
    refreshHero();
  }
  window.addEventListener('DOMContentLoaded', () => {
    $('#file').onchange = (e) => readFiles(Array.from(e.target.files || []));
    $('#open').onclick = () => $('#file').click();
    $('#hero').onchange = () => { setHero($('#hero').value); render(); };
    document.body.addEventListener('dragover', (e) => e.preventDefault());
    document.body.addEventListener('drop', (e) => { e.preventDefault(); readFiles(Array.from(e.dataTransfer.files || [])); });
    if (window.RM_DEMO) { load(window.RM_DEMO); refreshHero(); $('#msg').textContent = 'Пример: ' + window.HANDS.length + ' раздач'; }
  });
  window.RMAPP = { player, analyse, toRec, load, setHero, GRU, ROOM_RU, ENG, netOf };
})();
