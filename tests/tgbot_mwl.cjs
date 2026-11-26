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
    const R = E.ml[kd].filter(r => bands.includes(r[0]) && (r[5 + s] || r[16 + s]));
    const groups = [...SZB.map(([lo, hi]) => R.filter(r => r[5 + s] && r[5 + s] >= lo && r[5 + s] < hi)), ...RXB.map(([lo, hi]) => R.filter(r => r[16 + s] && r[16 + s] >= lo && r[16 + s] < hi)), R].filter(g => g.length);
    chk(T.table.rows.length === groups.length, q + ': строк ' + T.table.rows.length + ', ждали ' + groups.length);
    groups.forEach((g, i) => { const row = T.table.rows[i]; if (!row) return; const sd = g.filter(r => r[11]);
      chk(num(row[1].v) === g.length, q + ' · ' + row[0] + ': раз ' + row[1].v + ', ждали ' + g.length);
      cell(row[2], g.filter(r => r[8 + s] === 1).length, g.length, q + ' · ' + row[0] + ' все сбросили'); cell(row[3], g.filter(r => r[8 + s] === 2).length, g.length, q + ' · ' + row[0] + ' колл'); cell(row[4], g.filter(r => r[8 + s] === 3).length, g.length, q + ' · ' + row[0] + ' рейз');
      cell(row[5], g.filter(r => r[13]).length, g.length, q + ' · ' + row[0] + ' выиграл банк'); cell(row[6], sd.length, g.length, q + ' · ' + row[0] + ' вскрытие'); cell(row[7], sd.filter(r => r[12]).length, sd.length, q + ' · ' + row[0] + ' выиграл на вскрытии'); });
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
  console.log('проверок: ' + n + ', совпало: ' + ok + ', ошибок: ' + (n - ok)); bad.forEach(x => console.log('✗ ' + x));
})();
