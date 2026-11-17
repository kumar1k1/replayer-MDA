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
    const T = pick('T'), F = pick('F');
    return T && T.n >= 50 ? T : F && F.n >= 20 ? F : T;
  }
  let MX = null;
  function showMatrix(anchor, R, title) {
    hideMatrix(); const K = window.RMCards; const lab = {}; for (let h = 0; h < 169; h++) lab[K.H169[h].label] = h;
    const box = el('div', 'rm-mx'); box.append(el('div', 'rm-mx-t', title + ' — ' + R.n + ' рук со вскрытием (' + (R.coh === 'T' ? 'топы' : 'игроки не из топов') + ')'));
    const g = el('div', 'rm-mx-g'); let mx = 0; const dens = {};
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) { const l = i === j ? RANKS[i] + RANKS[j] : i < j ? RANKS[i] + RANKS[j] + 's' : RANKS[j] + RANKS[i] + 'o'; const h = lab[l]; const c = h != null ? R.m[h] || 0 : 0; const d = c / (i === j ? 6 : i < j ? 4 : 12); dens[l] = [c, d]; if (d > mx) mx = d; }
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) { const l = i === j ? RANKS[i] + RANKS[j] : i < j ? RANKS[i] + RANKS[j] + 's' : RANKS[j] + RANKS[i] + 'o'; const [c, d] = dens[l]; const q = mx ? d / mx : 0; const cell = el('div', 'rm-mx-c', l); cell.style.background = c ? 'rgba(242,176,62,' + (0.15 + 0.85 * q).toFixed(2) + ')' : 'rgba(255,255,255,0.04)'; cell.style.color = q > 0.55 ? '#1b1b1b' : ''; cell.title = l + ': ' + c; g.append(cell); }
    box.append(g, el('div', 'rm-mx-n', 'Чем ярче — тем чаще рука встречалась (с поправкой на число комбинаций). Только раздачи, дошедшие до вскрытия.'));
    document.body.append(box); const r = anchor.getBoundingClientRect(); const w = 420;
    box.style.left = Math.max(8, r.left - w - 12) + 'px'; box.style.top = Math.max(8, Math.min(window.innerHeight - 460, r.top - 160)) + 'px'; MX = box;
  }
  function hideMatrix() { if (MX) { MX.remove(); MX = null; } }
  if (!document.getElementById('rm-mx-css')) { const st = document.createElement('style'); st.id = 'rm-mx-css'; st.textContent = '.rm-mx{position:fixed;z-index:9999;width:420px;background:#151a22;border:1px solid #2c3442;border-radius:10px;padding:10px;box-shadow:0 10px 30px rgba(0,0,0,.5);font:12px Inter,system-ui,sans-serif;color:#cfd6e2}.rm-mx-t{font-weight:600;margin-bottom:8px}.rm-mx-g{display:grid;grid-template-columns:repeat(13,1fr);gap:2px}.rm-mx-c{font:10px JetBrains Mono,monospace;text-align:center;padding:5px 0;border-radius:3px}.rm-mx-n{margin-top:8px;color:#8a94a6;font-size:11px}.rm-rng{white-space:nowrap}'; document.head.append(st); }
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
      const meta = el('div', 'rm-meta');
      meta.append(el('span', null, TBL[a.tbl] || a.tbl), el('span', null, 'стек ' + fmt(d.stack, 1) + ' BB'), el('span', null, 'эфф. ' + fmt(d.eff, 1) + ' BB · банд ' + a.band));
      if (d.toCall > 0.001) meta.append(el('span', null, 'к коллу ' + fmt(d.toCall) + ' BB, банк ' + fmt(d.potBefore) + ' BB'));
      { const KD = { n: 'фризаут', k: 'PKO', m: 'Mystery Bounty' }, sg = H.stage;
        meta.append(el('span', null, KD[d.kd] || d.kd), el('span', null, 'стадия: ' + (sg ? A.STAGE_RU[sg.stage] + (sg.exact ? '' : ' (оценка)') : 'неизвестна') + (a.stageN ? ' · в базе ' + a.stageN : ''))); }
      s.append(meta);
      if (next.cards) { const c = el('div', 'rm-hand'); c.append(el('span', null, 'рука'), el('b', null, a.hand)); s.append(c); }
      if (a.stNote) s.append(el('div', 'rm-note', a.stNote));
      // совет и оценка — только тем, кто делает активное действие (лимп, колл, опен, рейз, пуш); фолд и чек не оцениваем
      const known = d.i === H.hero || ACTIVE(d.act); // герой (его турнир, карты известны) — всегда; остальные — только активные действия
      if (!known) s.append(el('div', 'rm-note', 'Фолд или чек — не оцениваем (оцениваются ваши решения и активные действия соперников).'));
      else {
        if (!next.cards) s.append(el('div', 'rm-note', 'Карты неизвестны — варианты оценены по диапазону и частотам топов.'));
        const r = el('div', 'rm-rec'); r.append(el('span', null, 'Совет'), el('b', null, a.rec.ru)); s.append(r);
        s.append(el('div', 'rm-why', a.rec.why + (a.rec.size && a.rec.size.why ? ' · ' + a.rec.size.why : a.rec.size ? ' · размер — самый частый у топов (' + a.rec.size.bucket + ')' : '')));
      // варианты: «сброс соперника» — как часто сбрасывает тот, против кого действие (опен — все за спиной, 3-бет — открывший)
      const t = el('table', 'rm-tab'); const hd = el('tr'); ['действие', 'EV, BB', 'сброс соперника', (a.freqWho === 'регов' ? 'реги' : a.freqWho === 'всех игроков' ? 'все' : 'топы') + ', %', 'диапазон'].forEach(x => hd.append(el('th', null, x))); t.append(hd);
      const bucketRu = (act, b) => act === 'iso' ? ' · ' + b.replace('+', '+').replace('+4+', '+4 и больше') + ' BB сверх лимпов' : act === 'open' ? '' : ' · ' + b + ' от рейза';
      const rngCell = (rk, act, title) => {
        const td = el('td', 'num rm-rng'); const R = act && rk ? rangeOf(rk, act) : null;
        if (!R) { td.textContent = act ? '—' : ''; return td; }
        td.textContent = R.n + ' рук ▦'; td.style.cursor = 'help';
        td.onmouseenter = () => showMatrix(td, R, title); td.onmouseleave = hideMatrix;
        return td;
      };
      const oppCell = (o, pf, act) => { const td = el('td', 'num', o ? pct(o.p) : (act === 'shove' || act === 'open') && pf != null ? pct(pf) : ''); if (o) td.title = o.who + ': ' + o.src; else if (pf != null && (act === 'shove' || act === 'open')) td.title = 'все, кто ещё в раздаче'; return td; };
      for (const row of a.rows) {
        const on = row.act === a.rec.act;
        const tr = el('tr', on ? 'on' : row.reliable ? '' : 'dim');
        tr.append(el('td', null, row.ru + (row.asShove ? ' → пуш' : '') + (row.bounty ? ' 🎯' : '')), el('td', 'num', row.ev == null ? '—' : sgn(row.ev)), oppCell(row.oppFold, row.pFold, row.act), el('td', 'num', pct(row.freqT)), rngCell(a.rk, row.act === 'open' || row.act === 'iso' || row.act === '3bet' || row.act === '4bet' || row.act === 'call' || row.act === 'limp' || row.act === 'shove' ? row.act : null, row.ru));
        if (row.bounty) tr.title = 'баунти: ' + row.bounty;
        t.append(tr);
        // размеры этого действия: EV каждого, сброс соперника, доля среди этих рейзов у топов
        if (row.sizes && row.sizes.length > 1) for (const v of row.sizes) {
          const ch = row.size && v.bucket === row.size.bucket;
          const tv = el('tr', 'rm-sz' + (ch && on ? ' on' : '') + (v.reliable ? '' : ' dim'));
          tv.append(el('td', null, '    ' + fmt(v.to, 1) + ' BB' + (v.allin ? ' → пуш' : '')), el('td', 'num', v.ev == null ? '—' : sgn(v.ev)), oppCell(v.oppFold, v.pFold, row.act), el('td', 'num', v.shareT != null ? pct(v.shareT) : ''), rngCell(a.rk, v.A, row.ru.replace(/ до .*$/, '') + ' ' + fmt(v.to, 1) + ' BB'));
          tv.title = 'размер ' + v.bucket + bucketRu(row.act, v.bucket) + ': у топов ' + v.nT + ' таких рейзов в этом споте (' + (v.shareT != null ? pct(v.shareT) : '—') + ' их рейзов), у поля ' + v.nF;
          t.append(tv);
        }
      }
      s.append(t);
      s.append(el('div', 'rm-note', 'EV — сколько BB в среднем приносит действие по сравнению с фолдом (у фолда 0). Топы, % — как часто топ-игроки делают это действие в таком споте (если у топов мало раздач — реги, затем все игроки); в строках размеров — какую долю их рейзов составляет этот размер. Диапазон — наведите, чтобы увидеть матрицу рук, с которыми в базе это делали (по вскрытиям). «—» в EV — по этой руке мало раздач.'));
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
