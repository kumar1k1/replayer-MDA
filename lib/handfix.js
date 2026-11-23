// Исправление разбора раздачи после парсера Backing (сам парсер не меняем) — 23.11.2026.
// Парсер ставит позиции только по номеру места от баттона и считает всех, кто сидит за столом. Ошибки:
//  • PokerStars / PS.es: игрок «out of hand (moved from another table into small blind)» карт не получает, но
//    занимает место → все позиции сдвинуты на одно (настоящий SB помечен BB, BB — UTG…), а сам он считается
//    живым игроком: попадает в лайнап «за спиной» и в эффективный стек;
//  • 888 / WPN / iPoker / Chico: «мёртвый» малый блайнд (SB никто не ставит) → игрок на BB помечен SB, следующий — BB.
// Правило: в раздаче только те, у кого есть хоть одно событие (анте, блайнд, действие, выигрыш — карты сданы);
// BB — кто ставил большой блайнд, SB — кто ставил малый, BTN — место баттона (если пусто — последний перед блайндами);
// остальные — по порядку от баттона, названия как у полного стола (CO — всегда сразу перед баттоном).
// Не берутся (null): одинаковые ники за столом (обезличенные выгрузки) и раздачи, где большой блайнд никто не поставил.
// Обычные раздачи не меняются (проверено: tests/audit_full.cjs, tests/test_handfix.cjs).
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.HANDFIX = f(); })(this, function () {
  const POS_NAMES = { 2: ['BTN/SB', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['BTN', 'SB', 'BB', 'CO'], 5: ['BTN', 'SB', 'BB', 'UTG', 'CO'], 6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'], 7: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'CO'], 8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'HJ2', 'CO'], 9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'HJ', 'HJ2', 'CO'] };
  // названия «прочих» мест (не BTN / SB / BB) при k таких игроках — как у стола k+3, по порядку от первого после BB
  const others = (k) => (POS_NAMES[Math.min(Math.max(k + 3, 3), 9)] || POS_NAMES[9]).slice(3).slice(-k);

  // rp — результат parseHand (pl/nm/stacks — BTN первым, далее по часовой); text — текст раздачи (для места баттона)
  function fix(rp, text) {
    if (!rp || !rp.pl || !rp.ev) return rp;
    const n0 = rp.pl.length;
    // одинаковые ники за столом (обезличенные выгрузки WPN / 888): действия двух игроков не различить — раздачу не берём
    if (new Set(rp.nm).size !== n0) return null;
    // 1) кто в раздаче: есть хоть одно событие
    const has = new Array(n0).fill(false);
    for (const e of rp.ev) if (e.i >= 0 && e.i < n0) has[e.i] = true;
    let keep = []; for (let i = 0; i < n0; i++) if (has[i]) keep.push(i);
    if (keep.length < 2) return rp; // разобрать нельзя — как есть
    let out = rp;
    if (keep.length < n0) {
      const map = new Array(n0).fill(-1); keep.forEach((o, j) => { map[o] = j; });
      const remap = (o) => { const r = {}; for (const k in o || {}) if (map[+k] >= 0) r[map[+k]] = o[k]; return r; };
      out = Object.assign({}, rp, {
        pl: keep.map(i => rp.pl[i].slice()), nm: keep.map(i => rp.nm[i]), stacks: keep.map(i => rp.stacks[i]),
        ev: rp.ev.map(e => (e.i >= 0 ? Object.assign({}, e, { i: map[e.i] }) : e)),
        sh: remap(rp.sh), hc: rp.hc && typeof rp.hc === 'object' ? remap(rp.hc) : rp.hc,
        hero: rp.hero != null && map[rp.hero] >= 0 ? map[rp.hero] : null, n: keep.length, dropped: n0 - keep.length
      });
    } else out = Object.assign({}, rp, { pl: rp.pl.map(p => p.slice()) });
    const n = out.pl.length;
    // 1б) «фальшивые» фолд/чек игрока, который уже весь в банке анте и блайндом (PokerStars пишет «folds» у сидящего
    //     без игры с неполным блайндом) — решения у него нет, событие убираем; фишки и выигрыши не меняются
    {
      const posted = new Array(n).fill(0);
      for (const e of out.ev) if ((e.t === 'A' || e.t === 'SB' || e.t === 'BB') && e.i >= 0) posted[e.i] += e.a || 0;
      const allin = posted.map((p, i) => p > 0 && p >= out.stacks[i] - 1e-9);
      if (allin.some(Boolean) && out.ev.some(e => (e.t === 'f' || e.t === 'x') && e.i >= 0 && allin[e.i])) {
        out.ev = out.ev.filter(e => !((e.t === 'f' || e.t === 'x') && e.i >= 0 && allin[e.i]));
        out.phantom = true;
      }
    }
    // 2) метки по блайндам
    const sbE = out.ev.find(e => e.t === 'SB'), bbE = out.ev.find(e => e.t === 'BB');
    // круг от первого после места баттона: в pl индекс 0 — тот, кого парсер счёл BTN (последний по кругу), 1.. — дальше
    const ring = []; for (let j = 1; j < n; j++) ring.push(j); ring.push(0);
    const nextOf = (j) => ring[(ring.indexOf(j) + 1) % n], prevOf = (j) => ring[(ring.indexOf(j) - 1 + n) % n];
    let sb = sbE && sbE.i >= 0 ? sbE.i : -1, bb = bbE && bbE.i >= 0 ? bbE.i : -1;
    if (sb === bb) sb = -1;
    // большой блайнд никто не поставил (игрок на BB ушёл в олл-ин на анте; ~1 на 100 000 раздач) — структура раздачи
    // неправильная (решения «на BB без блайнда»), такую раздачу не берём
    if (bb < 0) return null;
    if (n === 2) { // один на один: баттон = SB
      const o = bb === 0 ? 1 : 0; out.pl[o][0] = 'BTN/SB'; out.pl[bb][0] = 'BB';
      return finish(out, rp);
    }
    // место баттона — по тексту
    let btn = -1;
    const bm = text && /Seat #(\d+) is the button/.exec(text);
    if (bm) { const re = new RegExp('^Seat ' + bm[1] + ': (.+?) \\([\\d.,]+ in chips', 'm'), m = re.exec(text); if (m) btn = out.nm.indexOf(m[1]); }
    if (btn === bb || btn === sb) btn = -1;
    // BTN не найден (мёртвый баттон / баттон без карт / на месте баттона SB — правило 888) — последний перед SB (или BB)
    if (btn < 0) { btn = prevOf(sb >= 0 ? sb : bb); if (btn === bb || btn === sb) btn = -1; }
    // малый блайнд никто не поставил, но между BTN и BB сидит игрок (ушёл в олл-ин на анте) — он на месте SB
    if (sb < 0 && btn >= 0) { const g = nextOf(btn); if (g !== bb) sb = g; }
    // прочие — по кругу от BB до баттона; кто оказался между BTN и SB / SB и BB (редко) — в конец, как поздние места
    const start = ring.indexOf(bb), rest = [], late = [];
    let afterBtn = false;
    for (let s = 1; s < n; s++) { const j = ring[(start + s) % n]; if (j === btn) { afterBtn = true; continue; } if (j === sb || j === bb) continue; (afterBtn ? late : rest).push(j); }
    const all = rest.concat(late), names = others(all.length);
    const lab = new Array(n).fill(null);
    lab[bb] = 'BB'; if (sb >= 0) lab[sb] = 'SB'; if (btn >= 0) lab[btn] = 'BTN';
    all.forEach((j, q) => { lab[j] = names[q] || 'UTG'; });
    // меток больше, чем названий (стол > 9 без блайндов — не бывает) — разметка парсера
    if (new Set(lab).size !== n || lab.some(x => !x)) return out;
    for (let j = 0; j < n; j++) out.pl[j][0] = lab[j];
    return finish(out, rp);
  }
  function finish(out, rp) {
    out.posFixed = out.pl.some((p, j) => out.dropped || p[0] !== rp.pl[j][0]);
    return out;
  }
  return { fix, POS_NAMES };
});
