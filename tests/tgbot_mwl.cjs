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
    /* соседние размеры с одинаковыми цифрами — одной строкой (как в боте) */
    const sig = (xs) => [xs.length, ...[1, 2, 3].map(o2 => xs.filter(r => r[8 + s] === o2).length)].join(','), mg = [];
    for (const [lo, hi] of SZB) { const xs = R.filter(r => r[5 + s] >= lo && r[5 + s] < hi); if (!xs.length) continue; const p = mg[mg.length - 1]; if (p && p.hi === lo && sig(p.xs) === sig(xs)) { p.hi = hi; p.xs = p.xs.concat(xs); } else mg.push({ lo, hi, xs }); }
    const groups = [...mg.map(g => g.xs), R].filter(g => g.length);
    chk(T.table.head.join('|') === 'размер|раз|доля|фолд (успешность)|колл|рейз на меня', q + ': колонки ' + T.table.head.join('|'));
    chk(T.table.rows.length === groups.length, q + ': строк ' + T.table.rows.length + ', ждали ' + groups.length);
    groups.forEach((g, i) => { const row = T.table.rows[i]; if (!row) return; const sd = g.filter(r => r[11]);
      chk(num(row[1].v) === g.length, q + ' · ' + row[0] + ': раз ' + row[1].v + ', ждали ' + g.length);
      cell(row[2], g.length, R.length, q + ' · ' + row[0] + ' доля'); cell(row[3], g.filter(r => r[8 + s] === 1).length, g.length, q + ' · ' + row[0] + ' все сбросили'); cell(row[4], g.filter(r => r[8 + s] === 2).length, g.length, q + ' · ' + row[0] + ' колл'); cell(row[5], g.filter(r => r[8 + s] === 3).length, g.length, q + ' · ' + row[0] + ' рейз');
      chk(row.length === 6, q + ' · ' + row[0] + ': лишние колонки'); });
  }
  /* линии из нескольких улиц и таблица линий в боте пока скрыты (владелец 26.11.2026) — проверяем, что скрыты */
  const LOFF = true;
  // 2) названные линии
  const LINES = [['чек бет бет', ['X', 'B', 'B']], ['бет бет бет', ['B', 'B', 'B']], ['чек чек бет', ['X', 'X', 'B']], ['бет чек бет', ['B', 'X', 'B']], ['чек колл чек', ['X', 'C', 'X']]];
  for (const kd of Object.keys(KIND)) for (const [lt, L] of LINES) for (const [st, bands] of STK.slice(0, 2)) {
    const q = 'успешность линии ' + lt + ' ' + KIND[kd] + (st ? ' ' + st : ''), a = await ask(q), T = (a.blocks || []).find(b => b.table && /линия/.test(b.title));
    if (LOFF) { chk(!T && (a.blocks || []).some(b => /Линии в мультивее пока не показываю/.test(b.text || '')), q + ': линии скрыты, а пришло ' + (a.blocks || []).map(b => b.title || b.text).join(' | ')); continue; }
    if (!T) { chk(false, q + ': нет карточки линии'); continue; }
    const m = E.ml[kd].filter(r => bands.includes(r[0]) && L.every((c, i) => (r[2 + i] || '')[0] === c)), sd = m.filter(r => r[11]);
    const la = m.filter(r => [r[10], r[9], r[8]].find(v => v)), want = [[m.length], [m.filter(r => r[15] >= 3).length, m.length], [m.filter(r => r[15] <= 1).length, m.length], [la.filter(r => [r[10], r[9], r[8]].find(v => v) === 1).length, la.length], [m.filter(r => r[13]).length, m.length], [sd.length, m.length], [sd.filter(r => r[12]).length, sd.length]];
    T.table.rows.forEach((row, i) => { if (i === 0) chk(num(row[1].v) === m.length, q + ': раздач ' + row[1].v + ', ждали ' + m.length); else cell(row[1], want[i][0], want[i][1], q + ' · ' + row[0]); });
  }
  // 3) таблица линий: число раздач по каждой линии
  for (const kd of Object.keys(KIND)) { const q = 'мои линии ' + KIND[kd], a = await ask(q), T = (a.blocks || []).find(b => b.table); if (LOFF) { chk(!T && (a.blocks || []).some(b => /Линии в мультивее пока не показываю/.test(b.text || '')), q + ': линии скрыты'); continue; } if (!T) { chk(false, q + ': нет таблицы'); continue; }
    /* линия — действие на каждой улице по порядку (бет, чек, чек-рейз, колл, рейз, фолд), в «бет» — все раздачи со ставкой на флопе; частота — от всех раздач спота; забрал банк — все сбросили на последней улице */
    const all = E.ml[kd], act = (a) => (!a ? '' : a[0] === 'X' && a.includes('R') ? 'XR' : a[0]), AN = { B: 'бет', X: 'чек', XR: 'чек-рейз', C: 'колл ставки', R: 'рейз ставки', F: 'фолд на ставку' };
    chk(T.table.head.join('|') === 'линия|раздач|частота|забрал банк / ответ на ставку', q + ': колонки ' + T.table.head.join('|'));
    for (const row of T.table.rows) { const parts = row[0].split(' · ').map(w => Object.keys(AN).find(k => AN[k] === w)), xs = all.filter(r => parts.every((p, i) => act(r[2 + i]) === p)), s = parts.length - 1, ag = /B|R/.test(parts[s]);
      chk(num(row[1].v) === xs.length, q + ' · ' + row[0] + ': раздач ' + row[1].v + ', ждали ' + xs.length); cell(row[2], xs.length, all.length, q + ' · ' + row[0] + ' частота'); if (ag) cell(row[3], xs.filter(r => r[8 + s] === 1).length, xs.length, q + ' · ' + row[0] + ' забрал банк'); else if (parts[s] === 'X') { const fb = xs.filter(r => /^X[CF]/.test(r[2 + s] || '')), cl = fb.filter(r => /^XC/.test(r[2 + s])).length; const pv = (a, b) => String(Math.round(a / b * 1000) / 10).replace('.', ',') + '%'; chk(fb.length ? row[3].v === 'колл ' + pv(cl, fb.length) + ' · фолд ' + pv(fb.length - cl, fb.length) && row[3].n === fb.length : row[3].v === 'ставок не было', q + ' · ' + row[0] + ': ответ на ставку ' + row[3].v + ' / ' + row[3].n); } else chk(row[3].v === '—', q + ' · ' + row[0] + ': ждали «—»'); } }
  // 4) только рейзы, связки ходов на одной улице (чек-рейз, бет-фолд, чек-колл)
  for (const kd of Object.keys(KIND)) for (let s = 0; s < 3; s++) {
    const q = 'успешность моих рейзов на ' + SN[s] + 'е ' + KIND[kd], a = await ask(q), T = (a.blocks || []).find(b => b.table);
    const R = E.ml[kd].filter(r => r[16 + s]), sg = (xs) => [xs.length, ...[1, 2, 3].map(o2 => xs.filter(r => r[8 + s] === o2).length)].join(','), mg = [];
    for (const [lo, hi] of RXB) { const xs = R.filter(r => r[16 + s] >= lo && r[16 + s] < hi); if (!xs.length) continue; const p = mg[mg.length - 1]; if (p && p.hi === lo && sg(p.xs) === sg(xs)) { p.hi = hi; p.xs = p.xs.concat(xs); } else mg.push({ lo, hi, xs }); }
    const groups = [...mg.map(g => g.xs), R].filter(g => g.length);
    if (!T) { chk(!R.length, q + ': нет таблицы'); continue; }
    chk(/успешность рейзов/.test(T.title), q + ': заголовок ' + T.title); chk(T.table.rows.length === groups.length && T.table.rows.every(r => /рейз/.test(r[0])), q + ': строки ' + T.table.rows.map(r => r[0]).join(', '));
    groups.forEach((g, i) => { const row = T.table.rows[i]; if (row) { chk(num(row[1].v) === g.length, q + ' · ' + row[0] + ': раз ' + row[1].v + ', ждали ' + g.length); cell(row[3], g.filter(r => r[8 + s] === 1).length, g.length, q + ' · ' + row[0] + ' все сбросили'); } });
  }
  for (const kd of Object.keys(KIND)) for (const [w, code] of [['чек-рейз', 'XR'], ['бет-фолд', 'BF'], ['чек-колл', 'XC'], ['чек-фолд', 'XF']]) for (let s = 0; s < 3; s++) {
    const q = 'успешность ' + w + 'а на ' + SN[s] + 'е ' + KIND[kd], a = await ask(q), T = (a.blocks || []).find(b => b.table && /линия/.test(b.title));
    const m = E.ml[kd].filter(r => (r[2 + s] || '').startsWith(code)), sd = m.filter(r => r[11]);
    if (!T) { chk(false, q + ': нет карточки'); continue; }
    chk(T.title.includes(w + ' на ' + SN[s] + 'е'), q + ': заголовок ' + T.title);
    chk(num(T.table.rows[0][1].v) === m.length, q + ': раздач ' + T.table.rows[0][1].v + ', ждали ' + m.length);
    const rowL = (lab) => (T.table.rows.find(r => r[0] === lab) || [])[1]; cell(rowL('Выиграл банк'), m.filter(r => r[13]).length, m.length, q + ' · выиграл банк'); cell(rowL('Выиграл на вскрытии'), sd.filter(r => r[12]).length, sd.length, q + ' · выиграл на вскрытии');
  }
  // 5) десять вопросов владельцу (26.11.2026): что именно показано
  const TEN = [['успешность моих ставок на ривере в мультивее как рейзер в позиции', [/успешность ставок на ривере.*рейзер в позиции/]],
    ['успешность ставок на флопе в мультивее как коллер без позиции на больших стеках', [/успешность ставок на флопе.*коллер без позиции/]],
    ['мои линии в мультивее как рейзер без позиции', LOFF ? [/Линии в мультивее пока не показываю/] : [/мои линии.*рейзер без позиции/]],
    ['успешность линии бет бет бет в мультивее как рейзер в позиции', LOFF ? [/Линии в мультивее пока не показываю/] : [/линия бет · бет · бет.*рейзер в позиции/, /на флопе/, /на тёрне/, /на ривере/]],
    ['успешность линии чек чек бет в мультивее как коллер в позиции', LOFF ? [/Линии в мультивее пока не показываю/] : [/линия чек · чек · бет.*коллер в позиции/, /на ривере/]],
    ['успешность ставок на тёрне больше половины банка в мультивее как рейзер без позиции', [/успешность ставок на тёрне.*рейзер без позиции/]],
    ['как часто все сбрасывают на мой овербет на ривере в мультивее как коллер без позиции, успешность', [/успешность ставок на ривере.*коллер без позиции/]],
    ['успешность моих рейзов на флопе в мультивее как коллер в позиции', [/успешность рейзов на флопе.*коллер в позиции/]],
    ['мои линии в мультивее как коллер в позиции на 20-35 бб', LOFF ? [/Линии в мультивее пока не показываю/] : [/мои линии.*коллер в позиции/]],
    ['успешность линии чек бет бет в мультивее как рейзер без позиции и в позиции', LOFF ? [/Линии в мультивее пока не показываю/, /Линии в мультивее пока не показываю/] : [/линия чек · бет · бет.*рейзер в позиции/, /на тёрне.*в позиции/, /на ривере.*в позиции/, /линия чек · бет · бет.*рейзер без позиции/, /на тёрне.*без позиции/, /на ривере.*без позиции/]]];
  for (const [q, want] of TEN) { const a = await ask(q), ts = (a.blocks || []).map(b => b.title || b.text || ''); chk(ts.length === want.length && want.every((re, i) => re.test(ts[i])), q + ': пришло ' + ts.join(' | ')); }
  // в «овербет на ривере» — одна строка, только овербеты; в «больше половины банка» — только ставки от 50%
  { const a = await ask(TEN[6][0]), T = a.blocks[0].table; chk(T && T.rows.length === 1 && /овербет/.test(T.rows[0][0]), 'овербет: строки ' + (T && T.rows.map(r => r[0]).join(', '))); }
  // 6) успешность ставок в таблицах конбетов и ставки в пропуск — против записей (все сбросили сразу после моей ставки)
  { const R1 = { mw: E.rec.mw, mwo: E.rec.mwo }, Q1 = { mw: 'мои конбеты в мультивее в позиции как рейзер', mwo: 'мои конбеты в мультивее без позиции как рейзер' };
    for (const kd of ['mw', 'mwo']) { const a = await ask(Q1[kd]), T = (a.blocks || []).find(b => b.table), R = R1[kd];
      const rowF = (lab) => T && T.table.rows.find(r => r[0] === lab);
      const cbS = rowF('CB успешность'), dS = rowF('Delay CB успешность'), pS = rowF('+Bet успешность');
      const fl = R.filter(r => r[3]), tu = R.filter(r => r[3] && r[8]), rv = R.filter(r => r[3] && r[8] && r[11]), dt = R.filter(r => r[14]), dr = R.filter(r => r[17]), pb = R.filter(r => r[14] && r[20]);
      cell(cbS && cbS[1], fl.filter(r => r[31] === 1).length, fl.length, Q1[kd] + ' · CB успешность флоп'); cell(cbS && cbS[2], tu.filter(r => r[32] === 1).length, tu.length, Q1[kd] + ' · CB успешность тёрн'); cell(cbS && cbS[3], rv.filter(r => r[33] === 1).length, rv.length, Q1[kd] + ' · CB успешность ривер');
      cell(dS && dS[2], dt.filter(r => r[32] === 1).length, dt.length, Q1[kd] + ' · Delay успешность тёрн'); cell(dS && dS[3], dr.filter(r => r[33] === 1).length, dr.length, Q1[kd] + ' · Delay успешность ривер'); cell(pS && pS[3], pb.filter(r => r[33] === 1).length, pb.length, Q1[kd] + ' · +Bet успешность'); }
    const a = await ask('мои беты в пропуск в мультивее в позиции как коллер'), T = (a.blocks || []).find(b => b.table), R = E.rec.bsk, row = T && T.table.rows.find(r => r[0] === 'B vs Skip успешность');
    const f = R.filter(r => r[3]), tt = R.filter(r => r[8]), rv = R.filter(r => r[11]);
    cell(row && row[1], f.filter(r => r[22] === 1).length, f.length, 'пропуск · успешность флоп'); cell(row && row[2], tt.filter(r => r[23] === 1).length, tt.length, 'пропуск · успешность тёрн'); cell(row && row[3], rv.filter(r => r[24] === 1).length, rv.length, 'пропуск · успешность ривер');
    for (const [q, re] of [['успешность конбета на тёрне в мультивее в позиции как рейзер', /успешность CB тёрн/], ['успешность конбета в мультивее без позиции как рейзер', /успешность CB флоп/], ['успешность отложенного цбета в мультивее без позиции как рейзер', /успешность Delay CB тёрн/], ['успешность бета в пропуск в мультивее в позиции как коллер', /успешность B vs Skip флоп/]]) { const x = await ask(q), b = (x.blocks || [])[0]; chk(b && re.test(b.title || '') && b.big, q + ': пришло ' + (b && (b.title + ' ' + b.big))); } }  console.log('проверок: ' + n + ', совпало: ' + ok + ', ошибок: ' + (n - ok)); bad.forEach(x => console.log('✗ ' + x));
})();
