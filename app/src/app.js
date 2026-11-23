'use strict';
// Реплеер replayer-MDA: загрузка историй, список раздач, разбор героя. Стол — реплеер MDA Lab (js/replayer.js),
// подсказки — панель «Сейчас ход» (js/advisor.js).
(function () {
  const SP = window.RMSpots, E8 = window.RMEngine8, K = window.RMCards, CLU = window.RMClusters, STG = window.STAGE;
  const ENG = E8.create(window.RM_MODEL, window.RM_EQ, { sizes: window.RM_SIZES, lineup: window.RM_LINEUP, gto: window.RM_GTO || null, ranges: window.RM_RANGES || null });
  const PLAYERS = window.RM_PLAYERS || {};
  // рум — как в конвейере (pipeline/common.cjs roomOf): по префиксу заголовка после перевода
  const roomOf = (t) => (/^\s*CoinPoker/.test(t) ? 'coin' : /^\s*PokerStarsES Hand #/.test(t) ? 'pses' : /^\s*PokerStars/.test(t) ? 'ps' : /^\s*WPN Hand #/.test(t) ? 'wpn' : /^\s*iPoker Hand #/.test(t) ? 'ipoker' : /^\s*Chico Hand #/.test(t) ? 'chico' : /^\s*888 Hand #/.test(t) ? '888' : /^\s*Winamax Hand #/.test(t) ? 'wnmx' : /^\s*Poker Hand #/.test(t) ? 'gg' : 'other');
  const ROOM_RU = { ps: 'PokerStars', pses: 'PokerStars.es', coin: 'CoinPoker', wpn: 'WPN', ipoker: 'iPoker', chico: 'Chico', '888': '888poker', wnmx: 'Winamax', gg: 'GGPoker', other: 'другой рум' };

  // ---------- игроки базы: кластер, группа, счётчики для лайнапа ----------
  const pfCache = new Map();
  // PokerStars и PS.es — разные пулы; рум PS.es узнаётся по евро в заголовке — если ник не найден, пробуем соседний
  const ALT = { ps: 'pses', pses: 'ps' };
  function player(room, nick) {
    let k = room + ':' + nick, p = PLAYERS[k];
    if (!p && ALT[room]) { k = ALT[room] + ':' + nick; p = PLAYERS[k]; }
    if (!p) return null;
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
    // карты героя: парсер Backing отдаёт «Dealt to» объектом {место: «6d 7c»} (раньше читалось как строка → «[undefined»)
    const hcRaw = rp.hc && typeof rp.hc === 'object' ? rp.hc[hero] : (rp.hero === hero ? rp.hc : null);
    const hc = hcRaw ? String(hcRaw).trim() : sh[hero] || null;
    const tm = String(rp.date || '').match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{1,2}:\d{2})/);
    return { pl: rp.pl.map((p, j) => [p[0], r4(rp.stacks[j] / bb), j === hero ? 1 : 0]), h: hero, hc, ev, bd: rp.bd || [], sh, t: rp.title || '', d: tm ? tm[1] + '-' + tm[2] + '-' + tm[3] + ' ' + tm[4] : '', c: bb, bb: 1, nm: rp.nm.slice() };
  }

  // ---------- подсказки по всем решениям префлопа раздачи ----------
  function analyse(H) {
    if (H.adv) return H.adv;
    const rp = H.rp, room = H.room;
    const grpOf = (nick) => { const p = player(room, nick); return p ? p.grp : 'unk'; };
    const ctx = tourCtx(H);
    // бай-ин и формат: из раздачи и имени файла (как в базе — из папки архива); указанные вручную — главнее
    const ov = TOV.get(H.tid) || {};
    // имя файла уже учтено переводчиком (WPN / 888 / Chico: бай-ин и формат вписаны в заголовок, как в базе из папки)
    const ds = E8.decisionsBacking(rp, grpOf, '', room, ctx);
    if (ov.buyin || ov.kind) for (const d of ds) { if (ov.buyin) d.st = SP.stratumOf('$' + ov.buyin, ''); if (ov.kind) d.kd = ov.kind; }
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

  // ---------- турнир: стадия и данные для баунти (lib/stage.js) ----------
  const TOURS = new Map();
  function tourOf(tid) {
    if (TOURS.has(tid)) return TOURS.get(tid);
    const T = STG.collect(window.HANDS.filter(H => H.tid === tid));
    const H0 = window.HANDS.find(H => H.tid === tid), parts = H0 ? (String(H0.rp.title).replace(/(\d),(\d{3})/g, '$1$2').match(/[$€£₮]([\d.]+)\s*\+\s*[$€£₮]([\d.]+)\s*\+\s*[$€£₮]([\d.]+)/) || null) : null;
    T.P = parts ? +parts[1] : 0; T.B = parts ? +parts[2] : 0; // PokerStars PKO: призовая часть + баунти + рейк
    TOURS.set(tid, T); return T;
  }
  function tourCtx(H) {
    const T = tourOf(H.tid), t = STG.tsOf(H.rp.date), sa = STG.stageAt(T, t, H.rp.n, window.RM_STAGE_CALIB);
    const R = sa && sa.exact ? sa.R : null;
    // доля оставшихся: точно (в призовых — от числа призовых ≈ 15% поля) или оценка по среднему стеку
    const r = sa ? (sa.exact ? (T.Pb ? Math.min(1, sa.R / (T.Pb / 0.15)) : sa.r) : sa.r) : 1;
    H.stage = sa;
    return { stage: sa ? sa.stage : null, tour: { S: T.S, P: T.P, B: T.B, r, R } };
  }

  // ---------- загрузка ----------
  // Формат файла — по содержимому, перевод — тем же кодом, что и база (pipeline/convert.cjs → js/convert.js):
  // iPoker / RedStar — XML; 888 — «#Game No :»; WPN — «Game Hand #»; Chico — формат PokerStars со столами «CHC_»;
  // PokerStars.es — формат PokerStars, бай-ин в евро; PokerStars, CoinPoker, GG — как есть.
  const SPLIT = /\r?\n(?=(?:PokerStars Hand #|CoinPoker Hand #|Poker Hand #))/;
  const CV = window.ROOMCONV;
  function splitFile(text, fname) {
    const t = text.replace(/^﻿/, ''), out = [];
    if (/<game\b[^>]*gamecode=/.test(t)) { CV.ipokerXmlToPS(t, (h) => out.push(h), {}); return { hands: out, bad: 0 }; }
    if (/#Game No :/.test(t.slice(0, 20000))) { let bad = 0; for (const h of t.split(/\r?\n(?=#Game No)/)) { if (!/^\s*#Game No/.test(h)) continue; const x = CV.e888ToPS(h, fname); if (x) out.push(x); else bad++; } return { hands: out, bad }; }
    if (/^\s*Game Hand #/m.test(t.slice(0, 20000))) { let bad = 0; for (const h of t.split(/\r?\n(?=Game Hand #)/)) { if (!/^\s*Game Hand #/.test(h)) continue; const x = CV.wpnToPS(h, fname); if (x) out.push(x); else bad++; } return { hands: out, bad }; }
    if (/^\s*Winamax Poker - Tournament "/m.test(t.slice(0, 20000))) { let bad = 0; for (const h of t.split(/\r?\n(?=Winamax Poker - Tournament ")/)) { if (!/^\s*Winamax Poker - Tournament "/.test(h)) continue; const x = CV.wnmxToPS(h.trim()); if (x) out.push(x); else bad++; } return { hands: out, bad }; }
    if (/^\s*Winamax Poker - Tournament summary/.test(t)) return { hands: [], bad: 0 }; // итог турнира, не раздачи
    let bad = 0;
    for (const s of t.split(SPLIT).map(x => x.trim())) {
      if (!/^(PokerStars |CoinPoker )?Hand #|^Poker Hand #/.test(s)) continue;
      if (CV.isGGasPS(s)) { out.push(CV.ggToPS(s)); continue; } // GG, выгруженный в формате PokerStars
      if (/^PokerStars Hand #/.test(s) && /^Table 'CHC_/m.test(s)) { const x = CV.chicoToPS(s, fname); if (x) out.push(x); else bad++; continue; }
      if (/^PokerStars Hand #[^\n]*(€|EUR)/.test(s)) { out.push(s.replace(/^PokerStars Hand #/, 'PokerStarsES Hand #')); continue; }
      out.push(s);
    }
    return { hands: out, bad };
  }
  function load(text, fname) {
    const sp = splitFile(text, fname || '');
    let bad = sp.bad;
    for (const t of sp.hands) {
      let rp = null; try { rp = window.BKP.parse(t); } catch (e) { rp = null; }
      if (rp) rp.text = t; // нужен движку: баунти у мест, формат турнира
      if (!rp || !rp.n || !rp.bb || !rp.pl || rp.pl.length < 2) { bad++; continue; }
      const tm = t.match(/Tournament #(\d+)/), dt = String(rp.date || '');
      window.HANDS.push({ text: t, rp, room: roomOf(t), tid: tm ? tm[1] : '—', date: dt, hero: -1, rec: null, adv: null, fp: fname || '' });
    }
    return { added: sp.hands.length + sp.bad - bad, bad };
  }
  // бай-ин и формат турнира, указанные вручную: tid → { buyin, kind }
  const TOV = new Map();
  function refreshTourInfo() {
    const tid = $('#tour').value, H0 = tid ? window.HANDS.find(H => H.tid === tid) : null;
    $('#tinfo').hidden = $('#tkindl').hidden = !H0; if (!H0) return;
    const ov = TOV.get(tid) || {}, bi = SP.buyinOf('', H0.rp.title), kd = SP.kindOf(H0.rp, H0.text, '');
    $('#tbuyin').value = ov.buyin || (bi ? +bi.toFixed(2) : '');
    $('#tbuyin').placeholder = bi ? '' : 'нет';
    $('#tkind').value = ov.kind || '';
    $('#tkind').options[0].textContent = 'авто: ' + ({ n: 'фризаут', k: 'PKO', m: 'Mystery' })[kd];
  }
  function setTourOverride() {
    const tid = $('#tour').value; if (!tid) return;
    const buyin = +$('#tbuyin').value || 0, kind = $('#tkind').value || '';
    const H0 = window.HANDS.find(H => H.tid === tid), bi = H0 ? SP.buyinOf('', H0.rp.title) : 0;
    TOV.set(tid, { buyin: buyin && Math.abs(buyin - bi) > 0.005 ? buyin : 0, kind });
    for (const H of window.HANDS) if (H.tid === tid) H.adv = null;
    render();
  }
  // герой: ник «Dealt to» (ваши раздачи) или выбранный в списке; без героя — игрок, чьи карты известны
  function setHero(nick) {
    window.HANDS.forEach((H, i) => {
      const rp = H.rp; let h = nick ? rp.nm.indexOf(nick) : -1;
      if (h < 0 && rp.hero != null && rp.hero >= 0) h = rp.hero;
      if (h < 0) { const k = Object.keys(rp.sh || {}).find(k => rp.sh[k]); h = k != null ? +k : 0; }
      H.hero = h; H.rec = toRec(rp, h); H.adv = null;
      window.DB.cols.room[i] = Math.max(0, window.DB.rooms.indexOf(ROOM_RU[H.room] || ''));
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
    const T = $('#tour').value, vis = window.HANDS.map((H, i) => i).filter(i => !T || window.HANDS[i].tid === T);
    $('#count').textContent = vis.length ? vis.length + ' раздач' : '';
    let tot = { n: 0, ok: 0, bad: 0, loss: 0, warn: 0 };
    vis.forEach((i, q) => { const H = window.HANDS[i];
      const adv = analyse(H), mine = adv.filter(x => x.d.i === H.hero); // герой — все решения
      const row = el('button', 'tv-h rm-row'); row.type = 'button';
      const top = el('div', 'tv-ht');
      top.append(el('span', 'tv-no', '#' + (q + 1)), cardsEl(H.rec.hc), el('span', 'tv-pos ' + ('p-' + ({ BTN: 'bt', SB: 'sb', BB: 'bb', CO: 'co', HJ: 'hj' })[H.rec.pl[H.hero][0]] || ''), H.rec.pl[H.hero][0]), el('span', 'tv-stk', fmt(H.rec.pl[H.hero][1]) + ' BB'), el('span', 'tv-lvl', ROOM_RU[H.room] + ' · ' + (H.rec.t || '')));
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
      row.onclick = () => window.openReplayer(i, vis, { side: window.RM_SIDE });
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
  // турниры в загруженном: выбор в списке (раздачи по порядку)
  function refreshTours() {
    const sel = $('#tour'), cur = sel.value, cnt = new Map();
    for (const H of window.HANDS) { const c = cnt.get(H.tid) || { n: 0, t: H.rp.title || '' }; c.n++; cnt.set(H.tid, c); }
    sel.replaceChildren(); const all = el('option', null, 'все турниры · ' + window.HANDS.length); all.value = ''; sel.append(all);
    for (const [tid, c] of cnt) { const o = el('option', null, '#' + tid + ' · ' + c.t.slice(0, 40) + ' · ' + c.n); o.value = tid; sel.append(o); }
    sel.value = cnt.has(cur) ? cur : (cnt.size === 1 ? [...cnt.keys()][0] : '');
  }
  // «Загрузить турнир» — заменяет загруженное; «Добавить файлы» — дописывает. Раздачи — по турниру и времени.
  async function readFiles(files, replace) {
    if (replace) { window.HANDS.length = 0; window.DB.cols = { net: [], nev: [], room: [] }; }
    TOURS.clear();
    let add = 0, bad = 0;
    for (const f of files) { const r = load(await f.text(), f.name); add += r.added; bad += r.bad; }
    window.HANDS.sort((a, b) => (a.tid < b.tid ? -1 : a.tid > b.tid ? 1 : a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.rp.handId).localeCompare(String(b.rp.handId))));
    $('#msg').textContent = (replace ? 'Турнир загружен: ' : 'Добавлено: ') + add + ' раздач' + (bad ? ' · не разобрано: ' + bad : '');
    refreshTours(); refreshHero(); refreshTourInfo();
  }
  window.addEventListener('DOMContentLoaded', () => {
    $('#tbuyin').onchange = setTourOverride; $('#tkind').onchange = setTourOverride;
    let replace = true;
    $('#file').onchange = (e) => { readFiles(Array.from(e.target.files || []), replace); e.target.value = ''; };
    $('#open').onclick = () => { replace = true; $('#file').click(); };
    $('#add').onclick = () => { replace = false; $('#file').click(); };
    if ($('#open2')) $('#open2').onclick = () => { replace = true; $('#file').click(); };
    $('#tour').onchange = () => { refreshTourInfo(); render(); };
    $('#hero').onchange = () => { setHero($('#hero').value); render(); };
    document.body.addEventListener('dragover', (e) => e.preventDefault());
    document.body.addEventListener('drop', (e) => { e.preventDefault(); readFiles(Array.from(e.dataTransfer.files || []), true); });
    if (window.RM_DEMO) { load(window.RM_DEMO); refreshTours(); refreshHero(); $('#msg').textContent = 'Пример: ' + window.HANDS.length + ' раздач из базы — загрузите свой турнир'; }
  });
  window.RMAPP = { player, analyse, toRec, load, setHero, GRU, ROOM_RU, ENG, netOf, tourOf, STAGE_RU: STG.NAMES };
})();
