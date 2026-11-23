'use strict';
// ПОЛНАЯ ПРОВЕРКА РАЗБОРА РАЗДАЧ (23.11.2026) — по каждому руму и году, на равной выборке:
//  1) позиции: метка SB/BB — у того, кто ставил этот блайнд; BTN — у места баттона; сидящие без карт («out of hand»)
//  2) строки, которые парсер не узнал (могут нести фишки: пропуск действия портит раздачу) — по видам
//  3) раздачи, которые парсер не прочитал (заголовок / стол)
//  4) герой: сколько строк «Dealt to»; карты героя
//  5) бай-ин, формат (PKO / Mystery / фриз), дата, размер стола
//  6) фишки: вложено = банк, выиграно = банк − рейк (C.handIntact); олл-ин без флага; отрицательный стек
//  7) префлоп-разметка: все действия размечены; контекст RFI у BB (не бывает)
// Запуск: node tests/audit_full.cjs [раздач на файл, по умолчанию 3000] [каждый N-й файл, по умолчанию 20] [отчёт.json]
process.env.RAW_DIRS = process.env.RAW_DIRS || 'D:/маининг/реплеер/raw;D:/маининг/реплеер/raw-ps;D:/маининг/replayer-MDA/новые_румы;D:/маининг/replayer-MDA/новые_румы2';
const fs = require('fs'), path = require('path');
const C = require('../pipeline/common.cjs'), K = require('../lib/cards.js');
const P_ = C.loadParser(), { frames } = P_, parseHand = C.makeParse(P_);
const PER_FILE = +(process.argv[2] || 3000), STEP = +(process.argv[3] || 20);
const OUTF = process.argv[4] || path.join(__dirname, '..', 'pipeline', 'out2', 'проверка_разбора.json');

// известные строки раздачи (то, что парсер читает, и то, что можно спокойно пропустить)
const KNOWN = [
  /^.*Hand #\d+: Tournament #/, /^Table '/, /^Seat \d+: .+ \([\d.,]+ in chips/, /^\*\*\* /, /^Dealt to /,
  /^.+?: posts the ante [\d.]+$/, /^.+?: posts (small|big) blind [\d.]+$/, /^.+?: (folds|checks)$/,
  /^.+?: calls [\d.]+( and is all-in)?$/, /^.+?: bets [\d.]+( and is all-in)?$/, /^.+?: raises [\d.]+ to [\d.]+( and is all-in)?$/,
  /^Uncalled bet \([\d.]+\) returned to /, /^.+? collected [\d.,]+/, /^.+?: shows \[/,
  // без фишек — можно пропускать
  /^.+?: mucks hand/, /^.+?: doesn't show hand/, /^.+? is sitting out$/, /^.+? has returned$/, /^.+? will be allowed to play after the button$/,
  /^.+? said, "/, /^.+? is disconnected$/, /^.+? is connected$/, /^.+? has timed out/, /^.+? finished the tournament/,
  /^.+? wins the tournament/, /^.+? wins .* for eliminating/, /^.+? wins an entry/, /^.+? joins the table/, /^.+? leaves the table/,
  /^.+? re-buys/, /^.+? cashed out/, /^.+? wins \$?[\d.,]+ for splitting/, /^.+? wins the \$?[\d.,]+ bounty/,
];
const SUMMARY_OK = true; // строки после *** SUMMARY *** парсер не читает
const shape = (l, nicks) => { let s = l; for (const n of nicks) if (n.length > 1) s = s.split(n).join('<ник>'); return s.replace(/\[[^\]]*\]/g, '[..]').replace(/\$?[\d][\d.,]*/g, '#').slice(0, 90); };
const R = { files: 0, hands: 0, rooms: {} };
const RM = (room, yr) => { const k = room + ' ' + yr; return R.rooms[k] = R.rooms[k] || { hands: 0, nullParse: 0, viol: {}, unknown: {}, money: {}, ex: {}, kind: {}, strat: {}, table: {}, dealt: {} }; };
const inc = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
const bad = (r, kind, text, info) => { inc(r.viol, kind); const e = r.ex[kind] = r.ex[kind] || []; if (e.length < 2) e.push({ info, hand: text.slice(0, 1800) }); };

(async () => {
  const all = C.sourceFiles().filter(f => fs.statSync(f).size < 2048 * 1048576);
  const files = all.filter((_, i) => i % STEP === 0); const per = {}; const t0 = Date.now();
  for await (const x of C.iterHands(files, null)) {
    if (x.end) { R.files++; if (R.files % 10 === 0) console.log('файлов', R.files, 'из', files.length, 'раздач', R.hands, ((Date.now() - t0) / 1000).toFixed(0) + ' с'); continue; }
    if ((per[x.fp] = (per[x.fp] || 0) + 1) > PER_FILE) continue;
    const room = C.roomOf(x.hand);
    const yr = (/ (20\d\d)[\/.-]\d\d[\/.-]\d\d/.exec(x.hand.slice(0, 300)) || [, '?'])[1];
    const r = RM(room, yr); r.hands++; R.hands++;
    let rp; try { rp = parseHand(x.hand); } catch (e) { bad(r, 'парсер: исключение', x.hand, e.message); continue; }
    if (!rp || !rp.n || !rp.bb) { r.nullParse++; bad(r, 'парсер не прочитал раздачу', x.hand, null); continue; }
    const text = C.normalizeHand(x.hand), lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    // 2) нераспознанные строки до SUMMARY
    let inSum = false;
    for (const l of lines) {
      if (l.indexOf('*** SUMMARY ***') === 0) { inSum = true; continue; }
      if (inSum) continue;
      if (KNOWN.some(re => re.test(l))) continue;
      const s = shape(l, rp.nm);
      const money = /\d/.test(l) && /(post|call|bet|raise|all-in|collect|return|ante|blind|win|pot|straddle|dead)/i.test(l);
      inc(money ? r.money : r.unknown, s);
      if (money) bad(r, 'строка с фишками не распознана', x.hand, s);
    }
    // 1) позиции против блайндов и баттона
    const sbE = rp.ev.find(e => e.t === 'SB'), bbE = rp.ev.find(e => e.t === 'BB');
    const lab = (p) => rp.pl.findIndex(q => q[0] === p);
    const nSB = rp.ev.filter(e => e.t === 'SB').length, nBB = rp.ev.filter(e => e.t === 'BB').length;
    if (nSB > 1 || nBB > 1) bad(r, 'блайнд ставят двое (мёртвый блайнд / пропущенный)', x.hand, { nSB, nBB });
    if (!sbE && rp.n >= 3) inc(r.viol, 'нет малого блайнда (3+ игроков)');
    if (!bbE) bad(r, 'нет большого блайнда', x.hand, null);
    if (bbE && lab('BB') !== bbE.i && rp.n >= 2) bad(r, 'метка BB — не у того, кто ставил BB', x.hand, { bb: rp.nm[bbE.i], labelBB: rp.nm[lab('BB')] });
    if (sbE && rp.n >= 3 && lab('SB') !== sbE.i) bad(r, 'метка SB — не у того, кто ставил SB', x.hand, { sb: rp.nm[sbE.i], labelSB: rp.nm[lab('SB')] });
    const bm = /Seat #(\d+) is the button/.exec(text), btnSeat = bm ? +bm[1] : 0;
    const seatNick = {}; for (const m of text.matchAll(/^Seat (\d+): (.+?) \([\d.,]+ in chips/gm)) seatNick[+m[1]] = m[2];
    if (!seatNick[btnSeat]) inc(r.viol, 'баттон на пустом месте (мёртвый баттон)');
    else if (rp.n >= 3 && rp.nm[lab('BTN')] !== seatNick[btnSeat]) bad(r, 'метка BTN — не у места баттона', x.hand, { btn: seatNick[btnSeat], labelBTN: rp.nm[lab('BTN')] });
    if (/out of hand/.test(text.slice(0, 2500))) inc(r.viol, 'за столом есть «out of hand» (без карт)');
    // кто вообще не участвовал: не ставил анте/блайнд и не действовал
    { const acted = new Set(rp.ev.filter(e => e.i >= 0).map(e => e.i)); const idle = rp.nm.filter((_, i) => !acted.has(i)).length; if (idle) inc(r.viol, 'игрок за столом без единого события (не играл)'); }
    // 4) герой
    const dealt = (text.match(/^Dealt to /gm) || []).length; inc(r.dealt, dealt > 1 ? '2+' : String(dealt));
    // 5) бай-ин, формат, стол
    inc(r.kind, C.kindOf(rp, x.hand, x.fp)); inc(r.strat, C.stratumOf(x.fp, rp.title)); inc(r.table, C.tableOf(rp.n) + '|' + (C.tableFormat(text).max || '?'));
    if (!C.buyinOf(x.fp, rp.title)) bad(r, 'бай-ин не определён', x.hand, rp.title);
    if (!/(20\d\d)[\/.-]\d\d[\/.-]\d\d/.test(String(rp.date || ''))) bad(r, 'дата не прочитана', x.hand, rp.date);
    // 6) фишки
    let fr; try { fr = frames(rp); } catch (e) { bad(r, 'кадры: исключение', x.hand, e.message); continue; }
    const fin = fr[fr.length - 1];
    if (!C.handIntact(rp, fin, text)) bad(r, 'фишки не сходятся (банк / выигрыши)', x.hand, null);
    if (fr.some(f => f.stacks.some(s => s < -Math.max(0.011, rp.bb * 0.0005)))) bad(r, 'отрицательный стек', x.hand, null);
    // 7) префлоп
    try {
      const d = C.preflopDecisions(rp, () => 'unk');
      const nPf = rp.ev.filter(e => e.st === 0 && e.i >= 0 && 'rcfx'.indexOf(e.t) >= 0).length;
      if (d.length !== nPf) bad(r, 'префлоп: не все действия размечены', x.hand, { d: d.length, nPf });
      if (d.some(z => z.tbl === 'RFI' && z.pos === 'BB')) bad(r, 'префлоп: «первый вход» у BB', x.hand, null);
    } catch (e) { bad(r, 'префлоп: исключение', x.hand, e.message); }
  }
  R.sec = Math.round((Date.now() - t0) / 1000);
  fs.writeFileSync(OUTF, JSON.stringify(R, null, 1));
  for (const [k, r] of Object.entries(R.rooms).sort()) {
    if (r.hands < 500) continue;
    console.log('\n=== ' + k + ' — раздач ' + r.hands + (r.nullParse ? ', не прочитано ' + r.nullParse : ''));
    for (const [v, c] of Object.entries(r.viol).sort((a, b) => b[1] - a[1])) console.log('  ' + v + ': ' + (c / r.hands * 100).toFixed(2) + '%');
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, c]) => (c / r.hands * 100).toFixed(2) + '% ' + s);
    if (Object.keys(r.money).length) console.log('  строки с фишками, не распознаны:\n    ' + top(r.money).join('\n    '));
    if (Object.keys(r.unknown).length) console.log('  прочие нераспознанные:\n    ' + top(r.unknown).join('\n    '));
    console.log('  Dealt to:', JSON.stringify(r.dealt), '| формат:', JSON.stringify(r.kind), '| страта:', JSON.stringify(r.strat));
    console.log('  стол (наш|N-max):', JSON.stringify(r.table));
  }
  console.log('\nотчёт:', OUTF, '| время', R.sec, 'с');
})();
