'use strict';
// ПРОХОД A v7: статы игроков только по ПОЛОВИНЕ A базы (половина — по хэшу номера раздачи, common.halfOf).
// Зачем: в v6 топы выбирались по винрейту на тех же раздачах, на которых потом мерился их EV, — в EV топов
// попадала их удача (отбор по результату). Теперь топы выбираются по половине A, а модель меряется по половине B.
//   node pipeline/passA_v7.cjs            → out/players_A.json  (формат как players.json v6)
const fs = require('fs'), path = require('path');
const C = require('./common.cjs');
const P_ = C.loadParser(), { frames } = P_, parseHand = C.makeParse(P_);
const HALF = process.env.HALF || 'A';

const players = new Map(), IDS = new C.IdSet(); let stats_broken = 0;
const mk = () => ({ n: 0, vpip: 0, pfr: 0, ws: 0, wn: 0, ls: 0, ln: 0, netBb: 0 });
function rec(nick, st) {
  let r = players.get(nick);
  if (!r) { r = { pool: mk(), strata: {} }; players.set(nick, r); }
  if (!r.strata[st]) r.strata[st] = mk();
  return [r.pool, r.strata[st]];
}
(async () => {
  const t0 = Date.now(); let n = 0, skipped = 0, errs = 0;
  for await (const x of C.iterHands(C.sourceFiles())) {
    if (x.end) { C.log('A: источник пройден', x.end, 'рук', n); continue; }
    try {
      const rp = parseHand(x.hand);
      if (!rp || !rp.n || !rp.bb) continue;
      if (C.halfOf(rp.handId) !== HALF) { skipped++; continue; }
      if (!IDS.add(C.roomOf(x.hand), rp.handId)) continue; // повтор раздачи
      const fr = frames(rp); if (!fr.length) continue;
      const fin = fr[fr.length - 1], st = C.stratumOf(x.fp, rp.title);
      if (!C.handIntact(rp, fin, x.hand)) { stats_broken++; continue; } // повреждённая история (банк не сходится)
      const room = C.roomOf(x.hand), tf = C.tableFormat(x.hand).fmt;
      rp.nm.forEach((nick0, j) => {
        const nick = C.playerKey(room, nick0); // ключ «рум:ник»
        let inv = false, rz = false, fp = false;
        for (const e of rp.ev) if (e.i === j && e.st === 0) { if (e.t === 'c') inv = true; if (e.t === 'r') { inv = true; rz = true; } if (e.t === 'f') fp = true; }
        const net = (fin.stacks[j] - rp.stacks[j]) / rp.bb;
        for (const a of rec(nick, st + '|' + tf)) { // страта и формат стола (short / full)
          a.n++; if (inv) a.vpip++; if (rz) a.pfr++; a.netBb += net;
          if (!fp) { if (rp.sh[j]) (fin.won[j] > 0 ? a.ws++ : a.ls++); else (fin.won[j] > 0 ? a.wn++ : a.ln++); }
        }
      });
      n++;
      if (n % 1000000 === 0) C.log('A:', n, 'рук, игроков', players.size, ((Date.now() - t0) / 60000).toFixed(1) + ' мин');
    } catch (e) { if (++errs <= 5) C.log('A ERR', e.message); }
  }
  const fin = (a) => { const r = a.ws + a.ls + a.wn + a.ln; return { n: a.n, vpip: +(a.vpip / a.n * 100).toFixed(1), pfr: +(a.pfr / a.n * 100).toFixed(1), ws: r ? Math.round(a.ws / r * 100) : null, wn: r ? Math.round(a.wn / r * 100) : null, ls: r ? Math.round(a.ls / r * 100) : null, ln: r ? Math.round(a.ln / r * 100) : null, bb100: +(a.netBb / a.n * 100).toFixed(1) }; };
  const out = {};
  for (const [nick, r] of players) { const o = { pool: fin(r.pool), strata: {} }; for (const k in r.strata) o.strata[k] = fin(r.strata[k]); out[nick] = o; }
  fs.writeFileSync(path.join(C.OUT, 'players_' + HALF + '.json'), JSON.stringify(out));
  C.log('ПРОХОД A v7 готов: рук', n, '(другая половина пропущена:', skipped + ') игроков', players.size, 'ошибок', errs);
})();
