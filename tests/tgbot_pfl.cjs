'use strict';
// Глобальная проверка постфлоп-таблиц мультивея с размерами ставок (26.11.2026).
// node tests/tgbot_pfl.cjs (бот на 8790, без Claude). Каждая клетка пересчитывается заново отдельным кодом по записям раздач (ext.rec),
// понятый ботом размер сверяется с задуманным, матрица клетки — с цифрой, без размера — со старым отдельным подсчётом (ext.cb / ext.bsk),
// сумма по всем корзинам размера — с общей цифрой.
const path = require('path'), { DatabaseSync } = require('node:sqlite');
const B = 'http://127.0.0.1:8790', KEY = 'alias:все';
const db = new DatabaseSync(path.join(__dirname, '..', 'tgbot', 'data', 'players.db'), { readOnly: true });
const E = JSON.parse(db.prepare('select ext from p where key = ?').get(KEY).ext);
const BANDS = ['<12', '12-19', '20-35', '36-59', '60-99', '100-149', '150+'];
const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : null), num = (v) => parseFloat(String(v).replace(',', '.').replace('%', ''));
const BIG = 100000;
// задуманные фильтры: текст → {улица: [от, до)}
const SIZES = [
  ['', {}],
  ['конбет до 33%', { f: [0, 33.5] }], ['флоп 25%', { f: [0, 29] }], ['флоп 33%', { f: [29, 40] }], ['флоп 50%', { f: [40, 58] }], ['флоп 66%', { f: [58, 70] }],
  ['флоп 75%', { f: [70, 88] }], ['флоп 100%', { f: [88, 100.5] }], ['флоп овербет', { f: [100.5, BIG] }], ['подбет на флопе', { f: [88, 100.5] }], ['маленькая ставка на флопе', { f: [0, 33.5] }], ['флоп от 40%', { f: [40, BIG] }], ['флоп от 30 до 50%', { f: [30, 50.5] }], ['флоп больше 60%', { f: [60, BIG] }],
  ['флоп треть банка', { f: [29, 40] }], ['флоп половина банка', { f: [40, 58] }], ['сайзингом до 40%', { f: [0, 40.5] }],
  ['тёрн 50%', { t: [40, 58] }], ['тёрн до 40%', { t: [0, 40.5] }], ['тёрн от 60%', { t: [60, BIG] }], ['терн 33%', { t: [29, 40] }],
  ['отложка до 40%', { dt: [0, 40.5] }], ['отложка 50%', { dt: [40, 58] }],
  ['ривер 75%', { r: [70, 88] }], ['ривер от 50%', { r: [50, BIG] }],
  ['флоп 33% тёрн 50%', { f: [29, 40], t: [40, 58] }], ['флоп до 33% ривер от 50%', { f: [0, 33.5], r: [50, BIG] }], ['флоп от 40% тёрн до 40%', { f: [40, BIG], t: [0, 40.5] }],
];
const STACKS = [['', BANDS], ['на больших стеках', ['60-99', '100-149', '150+']], ['на 20-35 бб', ['20-35']], ['на коротких стеках', ['<12', '12-19']]];
const MODES = [['', 'all'], ['без олл-инов', 'nai'], ['только олл-ины', 'ai']];
const KINDS = [
  { id: 'mw', t: 'мои конбеты в мультивее в позиции как рейзер', one: 'мой {X} в мультивее в позиции как рейзер', rows: [['CB', ['f', 't', 'r']], ['CB-Fold', ['ff']], ['CB-Call', ['fc']], ['CB-Raise', ['fr']], ['Delay CB', [null, 'dt', 'dr']], ['+Bet', [null, null, 'pb']]] },
  { id: 'mwo', t: 'мои конбеты в мультивее без позиции как рейзер', one: 'мой {X} в мультивее без позиции как рейзер', rows: [['CB', ['f', 't', 'r']], ['CB-Fold', ['ff']], ['CB-Call', ['fc']], ['CB-Raise', ['fr']], ['Delay CB', [null, 'dt', 'dr']], ['+Bet', [null, null, 'pb']]] },
  { id: 'bsk', t: 'мои беты в пропуск в мультивее в позиции', one: 'мой {X} в мультивее в позиции', rows: [['B vs Skip', ['f', 't', 'r']], ['B флоп + B тёрн', [null, 'bt']], ['B-Fold', ['ff']]] },
];
const ONE = { mw: [['цбет-фолд', 'ff'], ['цбет-колл', 'fc'], ['цбет-рейз', 'fr'], ['конбет на тёрне', 't'], ['конбет на ривере', 'r'], ['отложенный цбет', 'dt'], ['отложенный цбет на ривере', 'dr']], bsk: [['бет-фолд в пропуск', 'ff'], ['бет в пропуск на тёрне', 't'], ['бет в пропуск на ривере', 'r'], ['бет в пропуск', 'f']] };
ONE.mwo = ONE.mw;
// независимый пересчёт клетки по записям (ext.rec), написан отдельно от бота
function expect(kind, cell, F, bands, mode) {
  const R = (E.rec[kind] || []).filter(r => bands.includes(r[0])), has = (k) => F[k] != null, inn = (k, v) => !F[k] || (v >= F[k][0] && v < F[k][1]);
  const inDT = (v) => (F.dt ? v >= F.dt[0] && v < F.dt[1] : F.t ? v >= F.t[0] && v < F.t[1] : true);
  let den, numf;
  if (kind !== 'bsk') {
    if (cell === 'f') { if (has('t') || has('r') || has('dt')) return null; den = R.filter(r => r[2]); numf = (r) => r[3] && inn('f', r[4]); }
    else if (['ff', 'fc', 'fr'].includes(cell)) { if (has('t') || has('r') || has('dt')) return null; den = R.filter(r => r[3] && inn('f', r[4]) && r[5] && (cell === 'fr' ? !r[6] : mode === 'nai' ? !r[6] : mode === 'ai' ? r[6] : true)); numf = (r) => r[5] === { ff: 1, fc: 2, fr: 3 }[cell]; }
    else if (cell === 't') { if (has('r') || has('dt')) return null; den = R.filter(r => r[3] && inn('f', r[4]) && r[7]); numf = (r) => r[8] && inn('t', r[9]); }
    else if (cell === 'r') { if (has('dt')) return null; den = R.filter(r => r[3] && inn('f', r[4]) && r[8] && inn('t', r[9]) && r[10]); numf = (r) => r[11] && inn('r', r[12]); }
    else if (cell === 'dt') { if (has('f') || has('r')) return null; den = R.filter(r => r[13]); numf = (r) => r[14] && inDT(r[15]); }
    else if (cell === 'dr') { if (has('f') || has('t') || has('dt')) return null; den = R.filter(r => r[16]); numf = (r) => r[17] && inn('r', r[18]); }
    else if (cell === 'pb') { if (has('f')) return null; den = R.filter(r => r[14] && inDT(r[15]) && r[19]); numf = (r) => r[20] && inn('r', r[21]); }
  } else {
    if (cell === 'f') { if (has('t') || has('r') || has('dt')) return null; den = R.filter(r => r[2]); numf = (r) => r[3] && inn('f', r[4]); }
    else if (cell === 'ff') { if (has('t') || has('r') || has('dt')) return null; den = R.filter(r => r[3] && inn('f', r[4]) && r[5] && (mode === 'nai' ? !r[6] : mode === 'ai' ? r[6] : true)); numf = (r) => r[5] === 1; }
    else if (cell === 't') { if (has('f') || has('r') || has('dt')) return null; den = R.filter(r => r[7]); numf = (r) => r[8] && inn('t', r[9]); }
    else if (cell === 'r') { if (has('f') || has('t') || has('dt')) return null; den = R.filter(r => r[10]); numf = (r) => r[11] && inn('r', r[12]); }
    else if (cell === 'bt') { if (has('r') || has('dt')) return null; den = R.filter(r => r[3] && inn('f', r[4]) && r[13]); numf = (r) => r[14] && inn('t', r[15]); }
  }
  const n = den.filter(numf).length; return { d: den.length, n, p: pct(n, den.length) };
}
const fltTxt = (F) => Object.entries(F).map(([k, [lo, hi]]) => ({ f: 'флоп', t: 'тёрн', r: 'ривер', dt: 'отложка на тёрне' })[k] + ' ' + (hi >= BIG ? (lo === 100.5 ? 'больше банка' : 'от ' + lo + '%') : lo <= 0 ? 'до ' + Math.floor(hi) + '%' : lo + '–' + Math.floor(hi) + '%')).join(', ');
const ask = async (q) => (await fetch(B + '/api/ask?nobrain=1&ctx=' + encodeURIComponent(KEY) + '&q=' + encodeURIComponent(q))).json();
const hm = async (ref) => (await fetch(B + '/api/hm?r=' + encodeURIComponent(JSON.stringify([ref])))).json();
(async () => {
  let qs = 0, cells = 0, ok = 0, mats = 0; const bad = [];
  const chk = (cond, msg) => { cells++; if (cond) ok++; else if (bad.length < 60) bad.push(msg); };
  const checkCell = async (q, lab, c, kind, cell, F, bands, mode) => {
    const x = expect(kind, cell, F, bands, mode);
    if (!x) { chk(c && c.v === '—' && !c.n, q + ' · ' + lab + ': ждали «—» (размер другой улицы), пришло ' + JSON.stringify(c && c.v)); return; }
    if (!x.d) { chk(c && !c.n, q + ' · ' + lab + ': ждали 0 раздач, пришло ' + (c && c.n)); return; }
    chk(c && c.n === x.d && Math.abs(num(c.v) - x.p) < 0.06, q + ' · ' + lab + ': бот ' + (c && c.v) + ' / ' + (c && c.n) + ', пересчёт ' + x.p + '% / ' + x.d);
    if (c && c.hm) { mats++; const m = await hm(c.hm); let d = 0, n = 0; for (const v of Object.values(m.cells || {})) { d += v[0]; n += v[1]; } chk(d === x.d && n === x.n, q + ' · ' + lab + ': матрица ' + n + '/' + d + ', пересчёт ' + x.n + '/' + x.d); }
  };
  for (const K of KINDS) for (const [st, bands] of STACKS) for (const [mt, mode] of MODES) for (const [sz, F] of SIZES) {
    if (K.id === 'bsk' && F.dt) continue;
    const q = [K.t, st, mt, K.id === 'bsk' ? sz.replace('конбет', 'бет флоп') : sz].filter(Boolean).join(' '); qs++;
    const a = await ask(q), T = (a.blocks || []).find(b => b.table);
    if (!T) { chk(false, q + ': нет таблицы (' + (a.blocks || []).map(b => b.title || b.text).join(' | ') + ')'); continue; }
    const want = Object.keys(F).length ? ' · размер: ' + fltTxt(F) : '';
    chk(String(T.title).endsWith(want) && (want || !/размер:/.test(T.title)), q + ': бот понял размер «' + (/размер: (.*)$/.exec(T.title) || [, 'нет'])[1] + '», задумано «' + (fltTxt(F) || 'нет') + '»');
    for (const [lab, cs] of K.rows) { const row = T.table.rows.find(r => r[0] === lab); if (!row) { chk(false, q + ': нет строки ' + lab); continue; } for (let i = 0; i < cs.length; i++) if (cs[i]) await checkCell(q, lab + ' ' + ['флоп', 'тёрн', 'ривер'][i], row[i + 1], K.id, cs[i], F, bands, mode); }
  }
  // одиночные цифры
  for (const K of KINDS) for (const [w, cell] of ONE[K.id]) for (const [sz, F] of SIZES.filter((x, i) => i % 3 === 0 && (!x[0] || /флоп|т[её]рн|терн|ривер|отлож/.test(x[0])))) /* в одиночном вопросе со словом улицы размер без улицы неоднозначен */ for (const [st, bands] of STACKS.slice(0, 2)) {
    const q = [K.one.replace('{X}', w), st, K.id === 'bsk' ? sz.replace('конбет', 'бет флоп') : sz].filter(Boolean).join(' '); qs++; const a = await ask(q), b = (a.blocks || []).find(z => z.big);
    if (!b) { chk(false, q + ': нет цифры (' + (a.blocks || []).map(z => z.title || z.text).join(' | ') + ')'); continue; }
    const x = expect(K.id, cell, F, bands, 'all');
    if (!x) { chk(/не зависит/.test(b.big), q + ': ждали «не зависит от размера», пришло ' + b.big); continue; }
    if (!x.d) { chk(!b.n, q + ': ждали 0 раздач, пришло ' + b.n); continue; }
    await checkCell(q, 'цифра', { v: b.big, n: b.n, hm: [].concat(b.hm)[0] }, K.id, cell, F, bands, 'all');
  }
  // вопросы про сам размер: как часто ставлю, доля среди ставок, вскрытие, выигрыш на вскрытии — независимый пересчёт
  const SQ = [
    ['mw', 'как часто я ставлю овербет ривера в мультивее как рейзер в позиции', 'ar', [100.5, BIG]], ['mwo', 'как часто я ставлю овербет ривера в мультивее как рейзер без позиции', 'ar', [100.5, BIG]], ['mw', 'как часто я ставлю подбет на ривере в мультивее как рейзер в позиции', 'ar', [88, 100.5]], ['mwo', 'как часто я ставлю подбет на тёрне в мультивее как рейзер без позиции', 'at', [88, 100.5]], ['mw', 'как часто я ставлю маленькую ставку на ривере в мультивее как рейзер в позиции', 'ar', [0, 33.5]],
    ['mw', 'как часто ставлю конбет 33% в мультивее в позиции как рейзер', 'f', [29, 40]], ['mwo', 'как часто ставлю конбет 33% в мультивее без позиции как рейзер и как часто выигрываю на шоудауне', 'f', [29, 40]],
    ['mwo', 'как часто ставлю конбет до 33% в мультивее без позиции как рейзер', 'f', [0, 33.5]], ['mw', 'как часто ставлю 50% на тёрне в мультивее в позиции как рейзер', 'at', [40, 58]],
    ['mwo', 'как часто отложка 50% в мультивее без позиции как рейзер', 'dt', [40, 58]], ['mwo', 'как часто ставлю ривер от 50% в мультивее без позиции как рейзер', 'ar', [50, BIG]],
    ['bsk', 'как часто бет в пропуск 33% в мультивее в позиции как коллер', 'f', [29, 40]], ['bsk', 'как часто ставлю 75% ривер в мультивее в позиции как коллер', 'ar', [70, 88]], ['bsk', 'как часто ставлю тёрн 50% в мультивее в позиции как коллер', 't', [40, 58]], ['bsk', 'Multivay, я коллер в позиции, покажи мне, как часто я выигрываю банк, когда ставлю в пропущенный больше половины пота', 'f', [50, BIG]], ['mw', 'как часто ставлю конбет меньше трети банка в мультивее в позиции как рейзер', 'f', [0, 33.5]],
  ];
  const IDX = { mw: { f: [2, 3, 4], at: [22, 23, 24], ar: [25, 26, 27], dt: [13, 14, 15] }, bsk: { f: [2, 3, 4], t: [7, 8, 9], ar: [16, 17, 18] } }; IDX.mwo = IDX.mw;
  for (const [kd, q0, cell, [lo, hi]] of SQ) for (const [st, bands] of STACKS) {
    const q = q0 + (st ? ' ' + st : ''); qs++; const a = await ask(q), T = (a.blocks || []).find(b => b.table && /размер/.test(b.title));
    if (!T) { chk(false, q + ': нет ответа про размер (' + (a.blocks || []).map(b => b.title || b.text).join(' | ') + ')'); continue; }
    const [o, d, s] = IDX[kd][cell], R = E.rec[kd].filter(r => bands.includes(r[0])), den = R.filter(r => r[o]), all = den.filter(r => r[d]), nm = all.filter(r => r[s] >= lo && r[s] < hi), SDI = kd === 'bsk' ? 19 : 28, sd = nm.filter(r => r[SDI]), won = sd.filter(r => r[SDI + 1]), wonAll = nm.filter(r => r[SDI + 2]);
    const want = [[nm.length, den.length], [nm.length, all.length], [wonAll.length, nm.length], [sd.length, nm.length], [won.length, sd.length]];
    T.table.rows.forEach((row, i) => { const [x, y] = want[i], c = row[1]; chk(y ? c.n === y && Math.abs(num(c.v) - pct(x, y)) < 0.06 : !c.n, q + ' · ' + row[0] + ': бот ' + c.v + ' / ' + c.n + ', пересчёт ' + pct(x, y) + '% / ' + y); });
    chk(!(a.blocks || []).some(b => /W\$SD/.test(b.title || '')), q + ': лишний отдельный W$SD');
  }  // без размера — со старым отдельным подсчётом (ext.cb / ext.bsk), все стеки
  const sumB = (obj) => { const x = []; for (const b of BANDS) { const r = obj && obj[b]; if (r) r.forEach((v, j) => (x[j] = (x[j] || 0) + v)); } return x; };
  for (const kd of ['mw', 'mwo']) { const x = sumB(E.cb[kd]); const pairs = [['f', 1, 0], ['t', 3, 2], ['r', 5, 4], ['dt', 15, 14], ['dr', 17, 16], ['pb', 19, 18]];
    for (const [cell, ni, di] of pairs) { const e = expect(kd, cell, {}, BANDS, 'all'); chk(e.d === x[di] && e.n === x[ni], 'старый подсчёт ' + kd + ' ' + cell + ': записи ' + e.n + '/' + e.d + ', ext.cb ' + x[ni] + '/' + x[di]); }
    const e = expect(kd, 'ff', {}, BANDS, 'all'); chk(e.d === x[6] && e.n === x[7], 'старый подсчёт ' + kd + ' CB-Fold: записи ' + e.n + '/' + e.d + ', ext.cb ' + x[7] + '/' + x[6]); }
  { const x = sumB(E.bsk.ip); for (const [cell, ni, di] of [['f', 1, 0], ['t', 3, 2], ['r', 5, 4], ['bt', 11, 10], ['ff', 7, 6]]) { const e = expect('bsk', cell, {}, BANDS, 'all'); chk(e.d === x[di] && e.n === x[ni], 'старый подсчёт bsk ' + cell + ': записи ' + e.n + '/' + e.d + ', ext.bsk ' + x[ni] + '/' + x[di]); } }
  // сумма по корзинам размера = общая цифра (числитель), знаменатель не меняется
  const BK = [[0, 29], [29, 40], [40, 58], [58, 70], [70, 88], [88, 100.5], [100.5, BIG]];
  for (const kd of ['mw', 'mwo', 'bsk']) for (const [cell, st] of [['f', 'f'], ['t', 't'], ['r', 'r'], ...(kd === 'bsk' ? [['bt', 't']] : [['dt', 'dt'], ['pb', 'r']])]) {
    const all = expect(kd, cell, {}, BANDS, 'all'); let n = 0; for (const b of BK) { const e = expect(kd, cell, { [st]: b }, BANDS, 'all'); n += e.n; chk(e.d === all.d, 'корзины ' + kd + ' ' + cell + ': знаменатель ' + e.d + ' ≠ ' + all.d); }
    chk(n === all.n, 'корзины ' + kd + ' ' + cell + ': сумма ' + n + ' ≠ ' + all.n); }
  // размеры в записях — в разумных пределах, у ставки размер есть всегда
  for (const kd of ['mw', 'mwo', 'bsk']) for (const r of E.rec[kd]) { for (const [d, s] of [[3, 4], [8, 9], [11, 12]]) chk(!r[d] || r[s] > 0, 'запись ' + kd + ': ставка без размера ' + JSON.stringify(r)); }
  console.log('вопросов: ' + qs + ', проверок: ' + cells + ', совпало: ' + ok + ', ошибок: ' + (cells - ok) + ', матриц сверено: ' + mats);
  bad.forEach(x => console.log('✗ ' + x));
})();
