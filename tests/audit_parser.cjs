'use strict';
// П.1 ПРОВЕРКА ПАРСЕРА НА РЕАЛЬНЫХ АРХИВАХ (парсер проекта Backing, parseHand + frames).
// Для каждой раздачи проверяются инварианты; нарушения считаются по видам, первые примеры сохраняются.
//   RAW_DIRS=<папка с .rar/.txt> BACKING_DIR=<Backing> node tests/audit_parser.cjs [отчёт.json]
const fs = require('fs'), path = require('path');
const C = require('../pipeline/common.cjs'), K = require('../lib/cards.js');
const P_ = C.loadParser(), { frames } = P_, parseHand = C.makeParse(P_);

const OUT = process.argv[2] || path.join(C.OUT, 'audit_parser.json');
const R = { hands: 0, bySrc: {}, viol: {}, examples: {}, evTypes: {}, posSets: {}, show: { full: 0, partial: 0, none: 0 }, dupIds: 0, roomOf: {} };
const IDS = new C.IdSet(); R.partialByRoom = {};
const bad = (kind, x, info) => {
  R.viol[kind] = (R.viol[kind] || 0) + 1;
  const ex = R.examples[kind] || (R.examples[kind] = []);
  if (ex.length < 3) ex.push({ src: x.fp, info, hand: x.hand.slice(0, 2500) });
};
const num = (s) => parseFloat(String(s).replace(/,/g, ''));
(async () => {
  const t0 = Date.now();
  for await (const x of C.iterHands(C.sourceFiles())) {
    if (x.end) { console.log('пройден', x.end, 'рук', R.hands, ((Date.now() - t0) / 1000).toFixed(0) + ' с'); continue; }
    const room = /^\s*CoinPoker/.test(x.hand) ? 'CoinPoker' : /^\s*PokerStars/.test(x.hand) ? 'PokerStars' : /^\s*Poker Hand #/.test(x.hand) ? 'GG' : 'другой';
    R.roomOf[room] = (R.roomOf[room] || 0) + 1;
    let rp;
    try { rp = parseHand(x.hand); } catch (e) { bad('парсер: исключение', x, e.message); continue; }
    if (!rp || !rp.n || !rp.bb) { bad('парсер: пустой результат', x, null); continue; }
    R.hands++;
    // дубли по номеру раздачи (рум + номер)
    if (!IDS.add(C.roomOf(x.hand), rp.handId)) { R.dupIds++; continue; } // повторы считаются и пропускаются, как в конвейере
    let fr;
    try { fr = frames(rp); } catch (e) { bad('кадры: исключение', x, e.message); continue; }
    const fin = fr[fr.length - 1], n = rp.n, eps = Math.max(0.011, rp.bb * 0.0005);
    // 1) фишки: вложено всеми = банк; выиграно всеми = банк − рейк
    const m = /Total pot ([\d.,]+)[^\n]*?(?:Rake|CC|Fee)\s*([\d.,]+)/i.exec(x.hand);
    const inv = rp.stacks.map((s, i) => s - fin.stacks[i] + fin.won[i]);
    const sumInv = inv.reduce((a, b) => a + b, 0), sumWon = fin.won.reduce((a, b) => a + b, 0);
    if (m) {
      const pot = num(m[1]), rake = num(m[2]);
      if (Math.abs(sumInv - pot) > eps * n) bad('банк ≠ сумме вложений', x, { pot, sumInv: +sumInv.toFixed(2) });
      if (Math.abs(sumWon - (pot - rake)) > eps * n) bad('выигрыши ≠ банк − рейк', x, { pot, rake, sumWon: +sumWon.toFixed(2) });
    } else bad('нет строки Total pot', x, null);
    // 2) стеки не уходят в минус ни в одном кадре
    if (fr.some(f => f.stacks.some(s => s < -eps))) bad('отрицательный стек в кадре', x, null);
    // 3) позиции: уникальные; при 3+ игроках есть BTN, SB, BB
    const pos = rp.pl.map(p => p[0]);
    if (new Set(pos).size !== pos.length) bad('позиции повторяются', x, pos);
    if (n >= 3 && !(pos.includes('BTN') && pos.includes('SB') && pos.includes('BB'))) bad('нет BTN/SB/BB', x, pos);
    R.posSets[n] = R.posSets[n] || pos.join(' ');
    // 4) олл-ин: кто кончил раздачу с нулём и что-то вложил — должен иметь флаг олл-ина
    for (let i = 0; i < n; i++) {
      if (fin.stacks[i] - fin.won[i] < eps && inv[i] > 0 && !fin.allin[i] && !rp.ev.some(e => e.i === i && e.ai)) {
        // поставил всё блайндом/анте без действия — допустимо, отдельная категория
        const vol = rp.ev.some(e => e.i === i && 'rcb'.indexOf(e.t) >= 0);
        bad(vol ? 'олл-ин без флага' : 'олл-ин блайндом/анте (без действий)', x, { i, pos: pos[i] });
      }
    }
    // 5) вскрытия: две карты / одна карта / пусто
    for (const v of Object.values(rp.sh || {})) {
      const c = String(v).trim().split(/\s+/).filter(Boolean);
      if (c.length === 2 && K.parseCards(c)) R.show.full++; else if (c.length === 1) { R.show.partial++; R.partialByRoom[room] = (R.partialByRoom[room] || 0) + 1; } else R.show.none++;
    }
    // 6) типы событий и улицы
    for (const e of rp.ev) R.evTypes[e.t] = (R.evTypes[e.t] || 0) + 1;
    // 7) разметка префлопа: каждое префлоп-действие получило контекст
    try {
      const d = C.preflopDecisions(rp, () => 'unk');
      const nPf = rp.ev.filter(e => e.st === 0 && e.i >= 0 && 'rcfx'.indexOf(e.t) >= 0).length;
      if (d.length !== nPf) bad('префлоп: не все действия размечены', x, { d: d.length, nPf });
      if (d.some(z => !z.act)) bad('префлоп: действие без названия', x, null);
    } catch (e) { bad('префлоп: исключение', x, e.message); }
  }
  R.sec = Math.round((Date.now() - t0) / 1000);
  fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
  console.log('\nРУК:', R.hands, 'по румам:', JSON.stringify(R.roomOf), 'дублей номеров:', R.dupIds);
  console.log('НАРУШЕНИЯ:'); for (const [k, v] of Object.entries(R.viol).sort((a, b) => b[1] - a[1])) console.log(' ', k + ':', v, `(${(v / R.hands * 100).toFixed(3)}%)`);
  console.log('вскрытия:', JSON.stringify(R.show), 'неполные по румам:', JSON.stringify(R.partialByRoom), '| типы событий:', JSON.stringify(R.evTypes));
  console.log('отчёт:', OUT);
})();
