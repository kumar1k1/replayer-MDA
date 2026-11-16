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
    if (next && next.a) {
      const d = next.d, a = next.a, nick = H.rp.nm[d.i], pl = A.player(H.room, nick);
      const s = sec('Сейчас ход');
      const who = el('div', 'rm-who'); const p = el('span', posCls(d.pos), d.pos); p.classList.add('rm-pos');
      who.append(p, el('span', 'rm-nick', nick + (d.i === H.hero ? ' (герой)' : '')), clChip(pl)); s.append(who);
      const meta = el('div', 'rm-meta');
      meta.append(el('span', null, TBL[a.tbl] || a.tbl), el('span', null, 'стек ' + fmt(d.stack, 1) + ' BB'), el('span', null, 'эфф. ' + fmt(d.eff, 1) + ' BB · банд ' + a.band));
      if (d.toCall > 0.001) meta.append(el('span', null, 'к коллу ' + fmt(d.toCall) + ' BB, банк ' + fmt(d.potBefore) + ' BB'));
      s.append(meta);
      if (next.cards) { const c = el('div', 'rm-hand'); c.append(el('span', null, 'рука'), el('b', null, a.hand)); s.append(c); }
      else s.append(el('div', 'rm-note', 'Карты игрока неизвестны — оценка по диапазону и частотам топов.'));
      if (a.stNote) s.append(el('div', 'rm-note', a.stNote));
      // совет
      const r = el('div', 'rm-rec'); r.append(el('span', null, 'Совет'), el('b', null, a.rec.ru)); s.append(r);
      s.append(el('div', 'rm-why', a.rec.why + (a.rec.size ? ' · размер — самый частый у топов (' + a.rec.size.bucket + (a.rec.size.share ? ', ' + fmt(a.rec.size.share, 0) + '%' : '') + ', ' + (a.rec.size.src.startsWith('tops') ? 'топы' : a.rec.size.src.startsWith('pool') ? 'пул' : 'по умолчанию') + ')' : '')));
      // варианты
      const t = el('table', 'rm-tab'); const hd = el('tr'); ['действие', 'EV, BB', 'все фолд', 'топы', 'источник'].forEach(x => hd.append(el('th', null, x))); t.append(hd);
      for (const row of a.rows) {
        const tr = el('tr', row.act === a.rec.act ? 'on' : row.reliable ? '' : 'dim');
        tr.append(el('td', null, row.ru + (row.asShove ? ' → пуш' : '')), el('td', 'num', row.ev == null ? '—' : sgn(row.ev)), el('td', 'num', row.pFold != null && row.act !== 'fold' ? pct(row.pFold) : ''), el('td', 'num', pct(row.freqT)), el('td', 'src', row.src + (row.n ? ' · n=' + row.n : '')));
        if (row.pFoldSrc && row.act !== 'fold') tr.title = 'P(все сфолдят): ' + row.pFoldSrc;
        t.append(tr);
      }
      s.append(t);
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
    } else if (pre && k === fr.length - 1) {
      sec('Префлоп закончен');
    } else if (!pre) {
      const s = sec(['Префлоп', 'Флоп', 'Тёрн', 'Ривер', 'Итог'][f.street]);
      s.append(el('div', 'rm-note', 'Подсказки — для префлопа (этап 1). Постфлоп — следующий этап проекта.'));
    }
    // оценка только что сделанного действия
    if (last && last.v) {
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
      li.append(pp, el('span', 'rm-nick', nk + (j === H.hero ? ' (герой)' : '')), clChip(pl), el('span', 'rm-pf', pl ? pl.hands + ' рук' : ''));
      P.append(li);
    });
  };
})();
