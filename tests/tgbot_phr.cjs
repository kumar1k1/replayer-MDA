'use strict';
// Разные формулировки вопросов по трём таблицам мультивея (26.11.2026): у каждого вопроса — задуманный смысл,
// ответ бота сразу проверяется на логику (тот ли стат, роль, позиция, размер, стек) и на цифры (независимый пересчёт по раздачам).
// node tests/tgbot_phr.cjs (бот на 8790, без Claude)
const fs = require('fs'), path = require('path');
{ const s = fs.readFileSync(path.join(__dirname, 'tgbot_pfl.cjs'), 'utf8'); globalThis.require = require; globalThis.__dirname = __dirname; (0, eval)(s.slice(s.indexOf('const path'), s.indexOf('const ask')).replace(/^const /gm, 'var ')); } /* общие определения (expect, fltTxt, KINDS…) — из tgbot_pfl.cjs */
const ask = async (q) => (await fetch(B + '/api/ask?nobrain=1&ctx=' + encodeURIComponent(KEY) + '&q=' + encodeURIComponent(q))).json();
const SUBJ = {
  mw: ['мои конбеты в мультивее в позиции как рейзер', 'покажи мне мои конбеты, когда я в мультивее являюсь рейзером в позиции', 'мультивей, я рейзер в позиции, покажи конбеты', 'мои цбеты в мультипоте в позиции', 'контбеты в мультивее в позиции',
    'мои комбеты мультивея в позиции как рейзер', 'си бэты в мультивее в позиции', 'таблица конбетов в мультивее, когда я в позиции на обоих игроков как рейзер', 'продолженные ставки в мультивее в позиции как префлоп рейзер', 'multiway рейзер in position конбеты', 'мои c-bet в мультивее в позиции'],
  mwo: ['мои конбеты в мультивее без позиции как рейзер', 'мои цбеты в мультивее вне позиции', 'мультивей рейзер out of position конбеты', 'мои комбеты в мультипоте не в позиции', 'конбеты мультивей oop',
    'покажи мои конбеты, когда я в мультивее без позы как рейзер', 'контбеты в мультивее, когда я не в позиции', 'таблица цбетов в мультивее без позиции как рейзер'],
  bsk: ['мои беты в пропуск в мультивее в позиции', 'мультивей, я коллер в позиции, мои ставки в пропуск', 'мои бет скип в мультивее в позиции как коллер', 'ставки в пропущенный в мультивее в позиции как коллер', 'мои bet vs skip в мультивее в позиции',
    'как коллер в мультивее в позиции ставлю, когда все прочекали', 'таблица ставок в пропуск в мультивее в позиции как коллер'],
};
const SZ = [['', {}], ['конбетом 33%', { f: [29, 40] }], ['флоп больше половины банка', { f: [50, BIG] }], ['тёрн 50%', { t: [40, 58] }], ['флоп овербет', { f: [100.5, BIG] }], ['подбет на флопе', { f: [88, 100.5] }],
  ['маленькой ставкой на флопе', { f: [0, 33.5] }], ['отложка до 40%', { dt: [0, 40.5] }], ['ривер от 50%', { r: [50, BIG] }], ['флоп до 33% и тёрн от 50%', { f: [0, 33.5], t: [50, BIG] }]];
const STK = [['', BANDS], ['на больших стеках', ['60-99', '100-149', '150+']], ['на 20-35 бб', ['20-35']]];
const ROWS = { mw: KINDS[0].rows, mwo: KINDS[1].rows, bsk: KINDS[2].rows };
const KDT = { mw: 'в мультивее, в позиции, как рейзер', mwo: 'в мультивее, без позиции, как рейзер', bsk: 'в мультивее, в позиции, как коллер' };
// одиночные: [фраза, клетка, ожидаемая подпись в заголовке]
const ONE1 = {
  mw: [['цбет-фолд', 'ff'], ['фолд на рейз после конбета', 'ff'], ['конбет фолд', 'ff'], ['CB-Fold', 'ff'], ['цбет-колл', 'fc'], ['колл на рейз после конбета', 'fc'], ['CB-Call', 'fc'], ['цбет-рейз', 'fr'], ['ререйз после конбета', 'fr'],
    ['конбет на тёрне', 't'], ['второй конбет на тёрне', 't'], ['конбет на ривере', 'r'], ['отложенный цбет', 'dt'], ['дилей цбет', 'dt'], ['отложка', 'dt'], ['отложенный цбет на ривере', 'dr'], ['плюс бет после отложки', 'pb'], ['конбет', 'f'], ['как часто ставлю конбет', 'f']],
  bsk: [['бет-фолд в пропуск', 'ff'], ['фолд на рейз после ставки в пропуск', 'ff'], ['бет в пропуск на тёрне', 't'], ['бет в пропуск на ривере', 'r'], ['бет в пропуск', 'f'], ['бет флоп + бет тёрн в пропуск', 'bt']],
};
ONE1.mwo = ONE1.mw;
const ROLE1 = { mw: ' в мультивее в позиции как рейзер', mwo: ' в мультивее без позиции как рейзер', bsk: ' в мультивее в позиции как коллер' };
// вопросы про размер: [фраза, клетка, диапазон]
const SQ1 = { mw: [['как часто я ставлю конбет 33%', 'f', [29, 40]], ['как часто я выигрываю банк, когда ставлю конбет больше половины пота', 'f', [50, BIG]], ['сколько раз я ставлю овербет на ривере', 'ar', [100.5, BIG]],
    ['как часто ставлю подбет на тёрне', 'at', [88, 100.5]], ['как часто ставлю маленькую ставку на флопе', 'f', [0, 33.5]], ['как часто отложка 50%', 'dt', [40, 58]], ['как часто выигрываю на шоудауне после конбета до 33%', 'f', [0, 33.5]], ['покажи мне, как часто я выигрывал на шоудауне, когда я был рейзером, после ставки моей на ривере размером в пот', 'ar', [88, 100.5]], ['как часто ставлю на тёрне размером банка', 'at', [88, 100.5]], ['покажи мне, как часто я выигрывал на шоудауне, когда я был рейзером, после ставки моей на ривень размером в под', 'ar', [88, 100.5]], ['как часто ставлю под бет на ривеле', 'ar', [88, 100.5]], ['подбет на тэрне как часто', 'at', [88, 100.5]]],
  bsk: [['как часто ставлю в пропуск 33%', 'f', [29, 40]], ['как часто я выигрываю банк, когда ставлю в пропущенный больше половины пота', 'f', [50, BIG]], ['как часто ставлю овербет на ривере', 'ar', [100.5, BIG]], ['как часто ставлю 50% на тёрне', 't', [40, 58]], ['как часто я выигрывал на шоудауне после ставки на ривере в пот', 'ar', [88, 100.5]]] };
SQ1.mwo = SQ1.mw;
const IDX = { mw: { f: [2, 3, 4], at: [22, 23, 24], ar: [25, 26, 27], dt: [13, 14, 15] }, bsk: { f: [2, 3, 4], t: [7, 8, 9], ar: [16, 17, 18] } }; IDX.mwo = IDX.mw;
(async () => {
  let qs = 0, cells = 0, ok = 0; const bad = [], badQ = new Set();
  const chk = (cond, q, msg) => { cells++; if (cond) ok++; else { badQ.add(q); if (bad.length < 80) bad.push(q + ' → ' + msg); } };
  const cellOk = (q, lab, c, kind, cell, F, bands, mode) => { const x = expect(kind, cell, F, bands, mode); if (!x) return chk(c && c.v === '—' && !c.n, q, lab + ': ждали «—», пришло ' + (c && c.v)); if (!x.d) return chk(c && !c.n, q, lab + ': ждали 0 раздач, пришло ' + (c && c.n)); chk(c && c.n === x.d && Math.abs(num(c.v) - x.p) < 0.06, q, lab + ': бот ' + (c && c.v) + ' / ' + (c && c.n) + ', пересчёт ' + x.p + '% / ' + x.d); };
  // 1) таблицы
  for (const kind of ['mw', 'mwo', 'bsk']) for (const subj of SUBJ[kind]) for (const [sz, F] of SZ) for (const [st, bands] of STK) {
    if (kind === 'bsk' && F.dt) continue;
    const q = [subj, sz && (kind === 'bsk' ? sz.replace('конбетом', 'ставкой') : sz), st].filter(Boolean).join(' '); qs++;
    const a = await ask(q), T = (a.blocks || []).find(b => b.table), titles = (a.blocks || []).map(b => b.title || b.text).join(' | ');
    if (!T) { chk(false, q, 'нет таблицы: ' + titles); continue; }
    chk(String(T.title).includes(KDT[kind]), q, 'не та таблица: ' + T.title);
    const want = Object.keys(F).length ? ' · размер: ' + fltTxt(F) : '';
    chk(want ? String(T.title).endsWith(want) : !/размер:/.test(T.title), q, 'размер понят «' + ((/размер: (.*)$/.exec(T.title) || [, 'нет'])[1]) + '», задумано «' + (fltTxt(F) || 'нет') + '»');
    if (!String(T.title).includes(KDT[kind])) continue;
    for (const [lab, cs] of ROWS[kind]) { const row = T.table.rows.find(r => r[0] === lab); if (!row) { chk(false, q, 'нет строки ' + lab); continue; } cs.forEach((cell, i) => { if (cell) cellOk(q, lab, row[i + 1], kind, cell, F, bands, 'all'); }); }
  }
  // 2) одиночные цифры
  for (const kind of ['mw', 'mwo', 'bsk']) for (const [ph, cell] of ONE1[kind]) for (const [st, bands] of STK) for (const [sz, F] of [['', {}], ['конбетом 33%', { f: [29, 40] }]]) {
    if (sz && !['ff', 'fc', 'fr', 't', 'r', 'bt'].includes(cell)) continue;
    const q = [ph + ROLE1[kind], sz && (kind === 'bsk' ? 'ставкой 33% на флопе' : sz), st].filter(Boolean).join(' '); qs++;
    const a = await ask(q), b = (a.blocks || []).find(z => z.big), titles = (a.blocks || []).map(z => z.title || z.text).join(' | ');
    if (!b) { chk(false, q, 'нет цифры: ' + titles); continue; }
    chk(String(b.title).includes(KDT[kind]), q, 'не тот спот: ' + b.title);
    if (!expect(kind, cell, F, bands, 'all')) { chk(/не зависит/.test(b.big), q, 'ждали «не зависит от размера», пришло ' + b.big); continue; }
    cellOk(q, 'цифра «' + b.title.replace(/^.*? — /, '') + '»', { v: b.big, n: b.n }, kind, cell, F, bands, 'all');
  }
  // 3) вопросы про размер
  for (const kind of ['mw', 'mwo', 'bsk']) for (const [ph, cell, [lo, hi]] of SQ1[kind]) for (const [st, bands] of STK) {
    const q = [ph + ROLE1[kind], st].filter(Boolean).join(' '); qs++;
    const a = await ask(q), T = (a.blocks || []).find(z => z.table && /размер/.test(z.title || '')), titles = (a.blocks || []).map(z => z.title || z.text).join(' | ');
    if (!T) { chk(false, q, 'нет ответа про размер: ' + titles); continue; }
    chk(String(T.title).includes(KDT[kind]), q, 'не тот спот: ' + T.title);
    const [o, d, s] = IDX[kind][cell], R = E.rec[kind].filter(r => bands.includes(r[0])), den = R.filter(r => r[o]), all = den.filter(r => r[d]), nm = all.filter(r => r[s] >= lo && r[s] < hi), SDI = kind === 'bsk' ? 19 : 28, sd = nm.filter(r => r[SDI]), won = sd.filter(r => r[SDI + 1]), wa = nm.filter(r => r[SDI + 2]);
    const want = [[nm.length, den.length], [nm.length, all.length], [wa.length, nm.length], [sd.length, nm.length], [won.length, sd.length]];
    T.table.rows.forEach((row, i) => { const [x, y] = want[i], c = row[1]; chk(y ? c.n === y && Math.abs(num(c.v) - pct(x, y)) < 0.06 : !c.n, q, row[0] + ': бот ' + c.v + ' / ' + c.n + ', пересчёт ' + pct(x, y) + '% / ' + y); });
    chk((a.blocks || []).length === 1, q, 'лишние ответы: ' + titles);
  }
  console.log('вопросов: ' + qs + ', проверок: ' + cells + ', совпало: ' + ok + ', ошибок: ' + (cells - ok) + ', вопросов с ошибкой: ' + badQ.size);
  bad.forEach(x => console.log('✗ ' + x));
})();
