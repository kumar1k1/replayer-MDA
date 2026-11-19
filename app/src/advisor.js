'use strict';
// Панель «Сейчас ход» справа от стола реплеера MDA Lab (место боковой панели реплеера турнира, opts.side).
// На каждом шаге префлопа: кто ходит, его кластер и стек, споты и варианты с EV, совет с размером,
// лайнап за спиной (P(фолд) каждого и P(все сфолдят)), оценка только что сделанного действия; внизу — игроки
// стола с кластерами тренера.
(function () {
  const fmt = (v, d) => { if (v == null || !Number.isFinite(v)) return '—'; const r = Math.round(v * Math.pow(10, d == null ? 2 : d)) / Math.pow(10, d == null ? 2 : d); return String(r).replace('.', ','); };
  const sgn = (v) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v)));
  const pct = (p) => (p == null ? '—' : Math.round(p * 100) + '%');
  const TBL = { RFI: 'все сфолдили до вас', ISO: 'против лимперов', VSO: 'против опена', VS3: 'против 3-бета', AI: 'против олл-ина' };
  const KIND = { 'лучшее': 'ok', 'близко': 'near', 'вероятно хуже': 'warn', 'отклонение': 'warn', 'ошибка': 'bad', 'нет данных': 'none', 'частое у топов': 'near', 'редкое у топов': 'warn' };
  const posCls = (p) => 'rv-pc ' + (/^(UTG|EP)/.test(p) ? 'p-ep' : /^(MP|LJ)/.test(p) ? 'p-mp' : /^HJ/.test(p) ? 'p-hj' : p === 'CO' ? 'p-co' : p === 'BTN' ? 'p-bt' : p === 'SB' ? 'p-sb' : p === 'BB' ? 'p-bb' : '');
  function clChip(pl) {
    const A = window.RMAPP;
    if (!pl) { const c = el('span', 'rm-cl unk', 'нет в базе'); c.title = 'Игрока нет в базе статов — прогноз по пулу'; return c; }
    const c = el('span', 'rm-cl ' + pl.grp, 'К' + pl.cl + ' · ' + A.GRU[pl.grp]);
    c.title = 'Кластер тренера ' + pl.cl + ' (' + A.GRU[pl.grp] + '), рядом — кластер ' + pl.cl2 + '; рук в базе ' + pl.hands + (pl.reliable ? '' : ' — меньше 1000, тип предварительный');
    if (!pl.reliable) c.classList.add('pre');
    return c;
  }
  // ---------- матрица рук по вскрытиям (data/ranges.js): «обобщённый спот | действие» → руки ----------
  const RANKS = 'AKQJT98765432';
  function rangeOf(rk, act) {
    const R = window.RM_RANGES; if (!R) return null;
    const pick = (coh) => { const s = R[coh] && R[coh][rk + '|' + act]; if (!s) return null; const m = {}; let n = 0; for (const x of s.split(',')) { const [h, c] = x.split(':'); m[+h] = +c; n += +c; } return { m, n, coh }; };
    const T = pick('T'); // только топы: руки игроков не из топов (там фиши) не показываем
    return T && T.n >= 20 ? T : null;
  }
  // нет вскрытий на этом стеке — ближайший стек (банд), с пометкой
  const BANDS = ['<12', '12-19', '20-35', '36-59', '60-99', '100-149', '150+'];
  function rangeNear(rk, act) {
    const r0 = rangeOf(rk, act); if (r0) return r0;
    const parts = rk.split('|'), bi = BANDS.indexOf(parts[5]); if (bi < 0) return null;
    for (let d = 1; d < BANDS.length; d++) for (const j of [bi - d, bi + d]) {
      if (j < 0 || j >= BANDS.length) continue;
      const p2 = parts.slice(); p2[5] = BANDS[j]; const r = rangeOf(p2.join('|'), act);
      if (r) return Object.assign(r, { band: BANDS[j] });
    }
    return null;
  }
  let MX = null;
  function showMatrix(anchor, R, title) {
    hideMatrix(); const K = window.RMCards; const lab = {}; for (let h = 0; h < 169; h++) lab[K.H169[h].label] = h;
    const box = el('div', 'rm-mx'); box.append(el('div', 'rm-mx-t', title + ' — ' + R.n + ' рук топов со вскрытием' + (R.band ? ' · на этом стеке вскрытий мало — показан стек ' + R.band + ' BB' : '')));
    const g = el('div', 'rm-mx-g'); let mx = 0; const dens = {};
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) { const l = i === j ? RANKS[i] + RANKS[j] : i < j ? RANKS[i] + RANKS[j] + 's' : RANKS[j] + RANKS[i] + 'o'; const h = lab[l]; const c = h != null ? R.m[h] || 0 : 0; const d = c / (i === j ? 6 : i < j ? 4 : 12); dens[l] = [c, d]; if (d > mx) mx = d; }
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) { const l = i === j ? RANKS[i] + RANKS[j] : i < j ? RANKS[i] + RANKS[j] + 's' : RANKS[j] + RANKS[i] + 'o'; const [c, d] = dens[l]; const q = mx ? d / mx : 0; const cell = el('div', 'rm-mx-c', l); cell.style.background = c ? 'rgba(242,176,62,' + (0.15 + 0.85 * q).toFixed(2) + ')' : 'rgba(255,255,255,0.04)'; cell.style.color = q > 0.55 ? '#1b1b1b' : ''; cell.title = l + ': ' + c; g.append(cell); }
    box.append(g, el('div', 'rm-mx-n', 'Чем ярче — тем чаще рука встречалась (с поправкой на число комбинаций). Только раздачи, дошедшие до вскрытия.'));
    document.body.append(box); const r = anchor.getBoundingClientRect(); const w = 420;
    box.style.left = Math.max(8, r.left - w - 12) + 'px'; box.style.top = Math.max(8, Math.min(window.innerHeight - 460, r.top - 160)) + 'px'; MX = box;
  }
  function hideMatrix() { if (MX) { MX.remove(); MX = null; } }
  if (!document.getElementById('rm-mx-css')) { const st = document.createElement('style'); st.id = 'rm-mx-css'; st.textContent = '.rm-rec span.rm-mix{font-size:11.5px;color:var(--soft);font-weight:600;margin-left:4px;text-transform:none;letter-spacing:0}.rm-mx{position:fixed;z-index:9999;width:420px;background:#151a22;border:1px solid #2c3442;border-radius:10px;padding:10px;box-shadow:0 10px 30px rgba(0,0,0,.5);font:12px Inter,system-ui,sans-serif;color:#cfd6e2}.rm-mx-t{font-weight:600;margin-bottom:8px}.rm-mx-g{display:grid;grid-template-columns:repeat(13,1fr);gap:2px}.rm-mx-c{font:10px JetBrains Mono,monospace;text-align:center;padding:5px 0;border-radius:3px}.rm-mx-n{margin-top:8px;color:#8a94a6;font-size:11px}.rm-rng{white-space:nowrap}'; document.head.append(st); }
  const ACTIVE = (act) => !/^(fold|check)$/.test(String(act));
  let CTX = null; // { i, H, box, body }
  window.RM_SIDE = {
    mount(main, i) {
      const H = window.HANDS[i], A = window.RMAPP; A.analyse(H);
      const side = el('aside', 'tv-side rm-side'); side.setAttribute('aria-label', 'Сейчас ход');
      const body = el('div', 'tv-body rm-body'); side.append(body); main.append(side);
      CTX = { i, H, side, body };
    },
    close() { CTX = null; }
  };
  // шаг реплеера: k — кадр (1 — блайнды, дальше по кадру на действие)
  window.RV_HOOK = function (k, fr, rec) {
    if (!CTX || CTX.H.rec !== rec) return;
    const { H, body } = CTX, A = window.RMAPP, f = fr[k], adv = H.adv || [];
    body.replaceChildren();
    const sec = (title) => { const s = el('section', 'tv-help rm-sec'); s.append(el('b', null, title)); body.append(s); return s; };
    // кадр k показывает уже сделанное действие №(k−2); ходит следующий — решение №(k−1)
    const pre = f.street === 0;
    const next = pre ? adv[k - 1] : null, last = pre || (k >= 2 && adv[k - 2] && fr[k].street === 0) ? adv[k - 2] : null;
    // герой уже сбросил — дальше раздачу не разбираем (подсказки только, пока вы в раздаче)
    const heroOut = (n) => adv.slice(0, Math.max(0, n)).some(x => x.d.i === H.hero && x.d.act === 'fold');
    if (next && next.a && heroOut(k - 1)) {
      const s = sec('Вы сбросили');
      s.append(el('div', 'rm-note', 'Дальше раздачу не оцениваем: подсказки — только пока вы в раздаче.'));
    } else if (next && next.a && next.d.i !== H.hero) {
      // совет — только герою; соперникам перед их ходом ничего не советуем
      const d = next.d, nick = H.rp.nm[d.i], pl = A.player(H.room, nick);
      const s = sec('Ходит соперник');
      const who = el('div', 'rm-who'); const p = el('span', posCls(d.pos), d.pos); p.classList.add('rm-pos');
      who.append(p, el('span', 'rm-nick', nick), clChip(pl)); s.append(who);
      s.append(el('div', 'rm-note', 'Подсказки — только для ваших решений.'));
    } else if (next && next.a) {
      const d = next.d, a = next.a, nick = H.rp.nm[d.i], pl = A.player(H.room, nick);
      const s = sec('Сейчас ход');
      const who = el('div', 'rm-who'); const p = el('span', posCls(d.pos), d.pos); p.classList.add('rm-pos');
      who.append(p, el('span', 'rm-nick', nick + (d.i === H.hero ? ' (герой)' : '')), clChip(pl)); s.append(who);
      // шапка — только кто ходит, рука и совет (стек, банк, формат, стадия — не показываем)
      if (next.cards) { const c = el('div', 'rm-hand'); c.append(el('span', null, 'рука'), el('b', null, a.hand)); s.append(c); }
      if (a.stNote) s.append(el('div', 'rm-note', a.stNote));
      // совет и оценка — только тем, кто делает активное действие (лимп, колл, опен, рейз, пуш); фолд и чек не оцениваем
      const known = d.i === H.hero || ACTIVE(d.act); // герой (его турнир, карты известны) — всегда; остальные — только активные действия
      if (!known) s.append(el('div', 'rm-note', 'Фолд или чек — не оцениваем (оцениваются ваши решения и активные действия соперников).'));
      else {
        if (!next.cards) s.append(el('div', 'rm-note', 'Карты неизвестны — варианты оценены по диапазону и частотам топов.'));
        const r = el('div', 'rm-rec'); r.append(el('span', null, 'Совет'), el('b', null, a.rec.ru));
        // веса для этой руки: GTO (смешанная стратегия HRC) — в скобках рядом с советом
        if (a.gtoF) { const RUA = { fold: 'фолд', call: 'колл', limp: 'лимп', raise: a.tbl === 'RFI' ? 'опен' : a.tbl === 'VS3' ? '4-бет' : a.tbl === 'ISO' ? 'изо' : '3-бет', shove: 'олл-ин' };
          const mix = Object.entries(a.gtoF.f).sort((x, y) => y[1] - x[1]).map(([k, v]) => RUA[k] + ' ' + Math.round(v * 100) + '%').join(', ');
          if (mix) r.append(el('span', 'rm-mix', '(GTO для ' + a.hand + ': ' + mix + ')')); }
        s.append(r);
        if (a.handW) { const RUB = { call: 'колл', limp: 'лимп', open: 'опен', iso: 'изо', '3bet': '3-бет', '4bet': '4-бет', shove: 'олл-ин' };
          const ws = Object.entries(a.handW.w).filter(x => x[1] > 0.005).sort((x, y) => y[1] - x[1]).map(([k, v]) => (RUB[k] || k) + ' ' + Math.round(v * 100) + '%').join(', ');
          const W0 = a.handW.who === 'реги' ? 'Реги' : 'Топы', st = a.handW.same ? '' : ', стек ' + a.handW.band + ' BB';
          if (a.handW.full) {
            const fs = Object.entries(a.handW.full).filter(x => x[1] > 0.005 || x[0] === 'fold').sort((x, y) => (x[0] === 'fold' ? -1 : y[0] === 'fold' ? 1 : y[1] - x[1])).map(([k, v]) => (k === 'fold' ? 'фолд' : RUB[k] || k) + ' ' + Math.round(v * 100) + '%').join(', ');
            const d = el('div', 'rm-why'); d.append(el('b', null, W0 + ' с ' + a.hand + ' здесь: ' + fs)); d.append(document.createTextNode(' (из сыгранных: ' + ws + '; по ' + a.handW.shown + ' показанным рукам' + st + '; фолд — оценка: ' + W0.toLowerCase() + ' продолжают здесь ' + Math.round(a.handW.cont * 100) + '% рук, ' + a.hand + ' — по порядку рук GTO в лучших ' + Math.max(1, Math.round(a.handW.pct * 100)) + '%)')); s.append(d);
          } else if (ws) s.append(el('div', 'rm-why', W0 + ' с ' + a.hand + ' здесь, когда играют: ' + ws + ' — по ' + a.handW.shown + ' показанным рукам' + st + '; фолды по базе не видны')); }
        s.append(el('div', 'rm-why', a.rec.why + (a.rec.size && a.rec.size.why ? ' · ' + a.rec.size.why : a.rec.size ? ' · размер — самый частый у топов (' + a.rec.size.bucket + ')' : '')));
      if (a.gtoF) { const RUA = { fold: 'фолд', call: 'колл', limp: 'лимп', raise: a.tbl === 'RFI' ? 'опен' : a.tbl === 'VS3' ? '4-бет' : a.tbl === 'ISO' ? 'изо' : '3-бет', shove: 'олл-ин' };
        const parts = Object.entries(a.gtoF.f).sort((x, y) => y[1] - x[1]).map(([k, v]) => RUA[k] + ' ' + Math.round(v * 100) + '%');
        s.append(el('div', 'rm-note', 'GTO — решения HRC, 8-max, ' + a.gtoF.depth + ' BB' + (Math.abs(d.eff - a.gtoF.depth) > 3 ? ' (ближайший к вашим ' + fmt(d.eff, 0) + ')' : '') + (parts.length ? '' : ': по этой руке нет данных'))); }
      else s.append(el('div', 'rm-note', 'GTO: в решениях HRC такого спота нет' + (a.tbl === 'ISO' ? ' (кроме SB, в GTO никто не лимпит)' : a.tbl === 'VS3' ? ' (есть только ответ открывшего на 3-бет без коллеров)' : a.tbl === 'VSO' ? ' (есть только ответ на открытие без коллеров)' : '') + '.'));
      // варианты: «сброс соперника» — как часто сбрасывает тот, против кого действие (опен — все за спиной, 3-бет — открывший)
      // EV по вскрытиям смещён (рука попадает в оценку, только если дошла до вскрытия) — не показываем как цифру
      const RU_SHORT = { open: 'опен', iso: 'изо', limp: 'лимп', '3bet': '3-бет', '4bet': '4-бет', shove: 'олл-ин', check: 'чек', raise: 'рейз' };
      const evCell = (r) => { const biased = r.src === 'рука' || r.src === 'класс руки'; const td = el('td', 'num', r.ev == null || biased ? '—' : sgn(r.ev)); if (biased && r.ev != null) td.title = 'по вскрытиям ' + sgn(r.ev) + ' BB — оценка смещена (выигрыши без вскрытия не видны), в расчёт не берём'; else if (r.src === 'GTO-поправка') td.title = 'реальный EV спота по всем раздачам + разница руки из GTO'; else if (/эквити/.test(r.src || '')) td.title = 'точный расчёт по эквити против диапазонов соперников'; return td; };
      const t = el('table', 'rm-tab'); const hd = el('tr');
      [['действие', ''], ['EV руки', 'EV вашей руки (BB к фолду): точный расчёт по эквити или реальный EV спота + разница руки из GTO'], ['EV базы', 'сколько в среднем приносит это действие в таком споте всеми руками (BB к фолду), по базе топов/регов'], ['топы', 'как часто топы делают это действие здесь (любыми руками)'], ['реги', 'как часто реги делают это действие здесь'], ['фиши', 'как часто фиши и суперфиши делают это действие здесь — для сравнения, в советах не участвуют']].forEach(([x, tt]) => { const th = el('th', null, x); if (tt) th.title = tt; hd.append(th); }); t.append(hd);
      for (const row of a.rows) {
        const on = row.act === a.rec.act;
        const tr = el('tr', on ? 'on' : row.reliable ? '' : 'dim');
        const lab = row.ru + (row.asShove ? ' → пуш' : '') + (row.bounty ? ' 🎯' : '');
        const tdl = el('td', null, lab); if (row.pFold != null && row.act !== 'fold') tdl.title = 'сброс соперника: ' + pct(row.pFold);
        const eb = el('td', 'num', row.evBase == null ? '—' : sgn(row.evBase)); eb.title = row.evBase != null ? 'EV базы: ' + row.evBaseWho + ', ' + row.nBase + ' раздач с этим действием' : (row.act === 'fold' ? '' : 'топы и реги здесь так почти не играют (< 1%) или мало раздач — не оцениваем');
        tr.append(tdl, evCell(row), eb, el('td', 'num', pct(row.freqT)), el('td', 'num', row.freqReg == null ? '—' : pct(row.freqReg)), el('td', 'num', row.freqFish == null ? '—' : pct(row.freqFish)));
        if (row.bounty) tr.title = 'баунти: ' + row.bounty;
        t.append(tr);
      }
      s.append(t);
      // частоты словами: как в этом споте играют реги и топы всеми руками, и какие размеры рейза ставят топы
      const frq = (k, who) => { const L = a.rows.filter(r => r[k] != null && r[k] > 0.005).map(r => (r.act === 'fold' ? 'фолд' : r.act === 'call' ? 'колл' : (RU_SHORT[r.act] || r.act)) + ' ' + pct(r[k])); return L.length ? who + ' здесь всеми руками: ' + L.join(', ') : null; };
      const fr = [frq('freqReg', 'Реги'), frq('freqT', 'Топы')].filter(Boolean); if (fr.length) s.append(el('div', 'rm-why', fr.join('. ') + '.'));
      for (const row of a.rows) if (row.size && row.size.dist && row.size.dist.length > 1) s.append(el('div', 'rm-why', 'Размеры «' + (RU_SHORT[row.act] || row.act) + '» у топов здесь: ' + row.size.dist.map(d => d.to + ' bb — ' + d.share + '%').join(' · ') + '. Совет берёт самый частый: до ' + row.size.to + ' bb.'));
      s.append(el('div', 'rm-note', 'EV руки — для вашей руки, EV базы — в среднем всеми руками у топов (если мало — у регов) в таком споте, BB к фолду; наведите — видно, чьё и по скольким раздачам. Топы / реги / фиши — как часто они делают это действие здесь. Фиши — только для сравнения, советы по ним не строятся. «—» — мало данных.'));
      const bRows = a.rows.filter(r => r.bounty); if (bRows.length) s.append(el('div', 'rm-why', 'Баунти в расчёте: ' + bRows.map(r => r.ru + ' — ' + r.bounty).join('; ')));
      if (a.compare) s.append(el('div', 'rm-why', 'Колл ' + sgn(a.compare.call) + ' (n=' + a.compare.callN + ') против «' + a.compare.raiseRu + '» ' + sgn(a.compare.raise) + ' (n=' + a.compare.raiseN + '): ' + (a.compare.diff >= 0 ? 'рейз лучше на ' : 'колл лучше на ') + fmt(Math.abs(a.compare.diff)) + ' BB' + (a.compare.reliable ? '' : ' — предварительно, мало вскрытий')));
      if (a.classTops) s.append(el('div', 'rm-note', 'Топы с руками «' + a.classTops.cls + '» здесь (по вскрытиям, n=' + a.classTops.n + '): ' + Object.entries(a.classTops.share).filter(([, v]) => v > 0).map(([k, v]) => ({ call: 'колл', '3bet': '3-бет', '4bet': '4-бет', shove: 'олл-ин', open: 'опен', limp: 'лимп', iso: 'изо', check: 'чек' })[k] + ' ' + pct(v)).join(', ')));
      // лайнап за спиной — из варианта рейза (опен)
      const lr = a.rows.find(x => x.lineup && x.lineup.length);
      if (lr) {
        const L = sec('За спиной · если ' + lr.ru);
        const others = (d.others || []);
        lr.lineup.forEach((x, q) => {
          const o = others.filter(z => z.stack - z.inv > 0.01)[q]; const nk = o ? H.rp.nm[o.j] : '';
          const li = el('div', 'rm-li'); const pp = el('span', posCls(x.pos), x.pos); pp.classList.add('rm-pos');
          li.append(pp, el('span', 'rm-nick', nk), clChip(A.player(H.room, nk)), el('span', 'rm-pf', 'фолд ' + pct(x.fold)));
          li.title = 'источник: ' + (x.src || 'пул'); L.append(li);
        });
        L.append(el('div', 'rm-tot', 'P(все сфолдят) = ' + pct(lr.pFold) + ' · ' + lr.pFoldSrc));
      }
      }
    } else if (pre && k === fr.length - 1) {
      sec('Префлоп закончен');
    } else if (!pre) {
      const s = sec(['Префлоп', 'Флоп', 'Тёрн', 'Ривер', 'Итог'][f.street]);
      s.append(el('div', 'rm-note', 'Подсказки — для префлопа (этап 1). Постфлоп — следующий этап проекта.'));
    }
    // оценка только что сделанного действия
    // оценка — только активных действий (фолд и чек не оцениваем)
    if (last && last.v && (last.d.i === H.hero || ACTIVE(last.d.act)) && !heroOut(k - 2)) {
      const s = sec('Последнее действие'), k2 = KIND[last.v.kind] || 'none';
      const w = el('div', 'rm-last'); const pp = el('span', posCls(last.d.pos), last.d.pos); pp.classList.add('rm-pos');
      w.append(pp, el('span', 'rm-nick', H.rp.nm[last.d.i]), el('span', 'rm-vchip ' + k2, last.v.kind + (last.v.kind === 'ошибка' ? ' −' + fmt(last.v.d) + ' BB' : '')));
      s.append(w, el('div', 'rm-why', last.v.text));
    }
    // игроки стола
    const P = sec('Игроки за столом');
    H.rp.nm.forEach((nk, j) => {
      const li = el('div', 'rm-li' + (f.folded[j] ? ' folded' : '')); const pp = el('span', posCls(H.rec.pl[j][0]), H.rec.pl[j][0]); pp.classList.add('rm-pos');
      const pl = A.player(H.room, nk);
      const bo = adv[0] && adv[0].d.bounty ? adv[0].d.bounty[j] : 0;
      li.append(pp, el('span', 'rm-nick', nk + (j === H.hero ? ' (герой)' : '')), clChip(pl), el('span', 'rm-pf', (bo ? '$' + fmt(bo) + ' · ' : '') + (pl ? pl.hands + ' рук' : '')));
      P.append(li);
    });
  };
})();
