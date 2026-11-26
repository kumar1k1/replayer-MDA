'use strict';
// Линии и успешность ставок в мультивее (26.11.2026): ответы бота против независимого пересчёта по записям ext.ml.
// node tests/tgbot_mwl.cjs (бот на 8790, без Claude)
const path = require('path'), { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'tgbot', 'data', 'players.db'), { readOnly: true });
const E = JSON.parse(db.prepare('select ext from p where key = ?').get('alias:все').ext);
const B = 'http://127.0.0.1:8790', BANDS = ['<12', '12-19', '20-35', '36-59', '60-99', '100-149', '150+'];
const ask = async (q) => (await (await fetch(B + '/api/ask?nobrain=1&ctx=' + encodeURIComponent('alias:все') + '&q=' + encodeURIComponent(q))).json());
const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : null), num = (v) => parseFloat(String(v).replace(',', '.').replace('%', ''));
const KIND = { rIP: 'в мультивее как рейзер в позиции', rOOP: 'в мультивее как рейзер без позиции', cIP: 'в мультивее как коллер в позиции', cOOP: 'в мультивее как коллер без позиции' };
const STK = [['', BANDS], ['на больших стеках', ['60-99', '100-149', '150+']], ['на 20-35 бб', ['20-35']]];
const SZB = [[0, 29], [29, 40], [40, 58], [58, 70], [70, 88], [88, 100.5], [100.5, 1e9]], RXB = [[0, 25], [25, 30], [30, 35], [35, 40], [40, 50], [50, 1e9]];
const SN = ['флоп', 'тёрн', 'ривер'];
(async () => {
  let n = 0, ok = 0; const bad = []; const chk = (c, m) => { n++; if (c) ok++; else if (bad.length < 40) bad.push(m); };
  const cell = (c, x, y, m) => chk(y ? c && c.n === y && Math.abs(num(c.v) - pct(x, y)) < 0.06 : !c || !c.n, m + ': бот ' + (c && c.v) + '/' + (c && c.n) + ', пересчёт ' + pct(x, y) + '%/' + y);
  // 1) успешность по размерам на каждой улице
  for (const kd of Object.keys(KIND)) for (const [st, bands] of STK) for (let s = 0; s < 3; s++) {
    const q = 'успешность моих ставок на ' + SN[s] + 'е ' + KIND[kd] + (st ? ' ' + st : ''), a = await ask(q), T = (a.blocks || []).find(b => b.table);
    if (!T) { chk(false, q + ': нет таблицы'); continue; }
    const R = E.ml[kd].filter(r => bands.includes(r[0]) && r[5 + s]); /* «ставки» — только ставки (владелец 26.11.2026) */
    const groups = [...SZB.map(([lo, hi]) => R.filter(r => r[5 + s] >= lo && r[5 + s] < hi)), R].filter(g => g.length);
    chk(T.table.head.join('|') === 'размер|раз|все сбросили|колл|рейз на меня', q + ': колонки ' + T.table.head.join('|'));
    chk(T.table.rows.length === groups.length, q + ': строк ' + T.table.rows.length + ', ждали ' + groups.length);
    groups.forEach((g, i) => { const row = T.table.rows[i]; if (!row) return; const sd = g.filter(r => r[11]);
      chk(num(row[1].v) === g.length, q + ' · ' + row[0] + ': раз ' + row[1].v + ', ждали ' + g.length);
      cell(row[2], g.filter(r => r[8 + s] === 1).length, g.length, q + ' · ' + row[0] + ' все сбросили'); cell(row[3], g.filter(r => r[8 + s] === 2).length, g.length, q + ' · ' + row[0] + ' колл'); cell(row[4], g.filter(r => r[8 + s] === 3).length, g.length, q + ' · ' + row[0] + ' рейз');
      chk(row.length === 5, q + ' · ' + row[0] + ': лишние колонки'); });
  }
  // 2) названные линии
  const LINES = [['чек бет бет', ['X', 'B', 'B']], ['бет бет бет', ['B', 'B', 'B']], ['чек чек бет', ['X', 'X', 'B']], ['бет чек бет', ['B', 'X', 'B']], ['чек колл чек', ['X', 'C', 'X']]];
  for (const kd of Object.keys(KIND)) for (const [lt, L] of LINES) for (const [st, bands] of STK.slice(0, 2)) {
    const q = 'успешность линии ' + lt + ' ' + KIND[kd] + (st ? ' ' + st : ''), a = await ask(q), T = (a.blocks || []).find(b => b.table && /линия/.test(b.title));
    if (!T) { chk(false, q + ': нет карточки линии'); continue; }
    const m = E.ml[kd].filter(r => bands.includes(r[0]) && L.every((c, i) => (r[2 + i] || '')[0] === c)), sd = m.filter(r => r[11]);
    const want = [[m.length], [m.filter(r => r[15] >= 3).length, m.length], [m.filter(r => r[15] <= 1).length, m.length], [m.filter(r => r[13]).length, m.length], [sd.length, m.length], [sd.filter(r => r[12]).length, sd.length]];
    T.table.rows.forEach((row, i) => { if (i === 0) chk(num(row[1].v) === m.length, q + ': раздач ' + row[1].v + ', ждали ' + m.length); else cell(row[1], want[i][0], want[i][1], q + ' · ' + row[0]); });
  }
  // 3) таблица линий: число раздач по каждой линии
  for (const kd of Object.keys(KIND)) { const q = 'мои линии ' + KIND[kd], a = await ask(q), T = (a.blocks || []).find(b => b.table); if (!T) { chk(false, q + ': нет таблицы'); continue; }
    const tot = T.table.rows.reduce((s2, r) => s2 + num(r[1].v), 0), all = E.ml[kd].length, small = T.table.rows.length;
    chk(tot <= all && small > 0, q + ': сумма раздач по линиям ' + tot + ' больше всех ' + all); }
  // 4) только рейзы, связки ходов на одной улице (чек-рейз, бет-фолд, чек-колл)
  for (const kd of Object.keys(KIND)) for (let s = 0; s < 3; s++) {
    const q = 'успешность моих рейзов на ' + SN[s] + 'е ' + KIND[kd], a = await ask(q), T = (a.blocks || []).find(b => b.table);
    const R = E.ml[kd].filter(r => r[16 + s]), groups = [...RXB.map(([lo, hi]) => R.filter(r => r[16 + s] >= lo && r[16 + s] < hi)), R].filter(g => g.length);
    if (!T) { chk(!R.length, q + ': нет таблицы'); continue; }
    chk(/успешность рейзов/.test(T.title), q + ': заголовок ' + T.title); chk(T.table.rows.length === groups.length && T.table.rows.every(r => /рейз/.test(r[0])), q + ': строки ' + T.table.rows.map(r => r[0]).join(', '));
    groups.forEach((g, i) => { const row = T.table.rows[i]; if (row) { chk(num(row[1].v) === g.length, q + ' · ' + row[0] + ': раз ' + row[1].v + ', ждали ' + g.length); cell(row[2], g.filter(r => r[8 + s] === 1).length, g.length, q + ' · ' + row[0] + ' все сбросили'); } });
  }
  for (const kd of Object.keys(KIND)) for (const [w, code] of [['чек-рейз', 'XR'], ['бет-фолд', 'BF'], ['чек-колл', 'XC'], ['чек-фолд', 'XF']]) for (let s = 0; s < 3; s++) {
    const q = 'успешность ' + w + 'а на ' + SN[s] + 'е ' + KIND[kd], a = await ask(q), T = (a.blocks || []).find(b => b.table && /линия/.test(b.title));
    const m = E.ml[kd].filter(r => (r[2 + s] || '').startsWith(code)), sd = m.filter(r => r[11]);
    if (!T) { chk(false, q + ': нет карточки'); continue; }
    chk(T.title.includes(w + ' на ' + SN[s] + 'е'), q + ': заголовок ' + T.title);
    chk(num(T.table.rows[0][1].v) === m.length, q + ': раздач ' + T.table.rows[0][1].v + ', ждали ' + m.length);
    cell(T.table.rows[3][1], m.filter(r => r[13]).length, m.length, q + ' · выиграл банк'); cell(T.table.rows[5][1], sd.filter(r => r[12]).length, sd.length, q + ' · выиграл на вскрытии');
  }
  // 5) десять вопросов владельцу (26.11.2026): что именно показано
  const TEN = [['успешность моих ставок на ривере в мультивее как рейзер в позиции', [/успешность ставок на ривере.*рейзер в позиции/]],
    ['успешность ставок на флопе в мультивее как коллер без позиции на больших стеках', [/успешность ставок на флопе.*коллер без позиции/]],
    ['мои линии в мультивее как рейзер без позиции', [/мои линии.*рейзер без позиции/]],
    ['успешность линии бет бет бет в мультивее как рейзер в позиции', [/линия бет · бет · бет.*рейзер в позиции/, /на флопе/, /на тёрне/, /на ривере/]],
    ['успешность линии чек чек бет в мультивее как коллер в позиции', [/линия чек · чек · бет.*коллер в позиции/, /на ривере/]],
    ['успешность ставок на тёрне больше половины банка в мультивее как рейзер без позиции', [/успешность ставок на тёрне.*рейзер без позиции/]],
    ['как часто все сбрасывают на мой овербет на ривере в мультивее как коллер без позиции, успешность', [/успешность ставок на ривере.*коллер без позиции/]],
    ['успешность моих рейзов на флопе в мультивее как коллер в позиции', [/успешность рейзов на флопе.*коллер в позиции/]],
    ['мои линии в мультивее как коллер в позиции на 20-35 бб', [/мои линии.*коллер в позиции/]],
    ['успешность линии чек бет бет в мультивее как рейзер без позиции и в позиции', [/линия чек · бет · бет.*рейзер в позиции/, /на тёрне.*в позиции/, /на ривере.*в позиции/, /линия чек · бет · бет.*рейзер без позиции/, /на тёрне.*без позиции/, /на ривере.*без позиции/]]];
  for (const [q, want] of TEN) { const a = await ask(q), ts = (a.blocks || []).map(b => b.title || b.text || ''); chk(ts.length === want.length && want.every((re, i) => re.test(ts[i])), q + ': пришло ' + ts.join(' | ')); }
  // в «овербет на ривере» — одна строка, только овербеты; в «больше половины банка» — только ставки от 50%
  { const a = await ask(TEN[6][0]), T = a.blocks[0].table; chk(T && T.rows.length === 1 && /овербет/.test(T.rows[0][0]), 'овербет: строки ' + (T && T.rows.map(r => r[0]).join(', '))); }
  console.log('проверок: ' + n + ', совпало: ' + ok + ', ошибок: ' + (n - ok)); bad.forEach(x => console.log('✗ ' + x));
})();
