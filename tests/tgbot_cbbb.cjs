/* Конбеты против BB один на один (26.11.2026): ответы бота против пересчёта по записям ext.rec.bb; разные формулировки, позиция, стеки.
   Запуск: node tests/tgbot_cbbb.cjs (бот должен работать на 8790; без Claude — nobrain=1) */
const http = require('http'), { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(__dirname + '/../tgbot/data/players.db'), E = JSON.parse(db.prepare('select ext from p where key=?').get('alias:все').ext), ALL = E.rec.bb;
const ask = (q) => new Promise((ok, no) => http.get('http://127.0.0.1:8790/api/ask?nobrain=1&ctx=' + encodeURIComponent('alias:все') + '&q=' + encodeURIComponent(q), (r) => { let s = ''; r.on('data', d => (s += d)); r.on('end', () => { try { ok(JSON.parse(s)); } catch (e) { no(e); } }); }).on('error', no));
const pv = (a, b) => (b ? String(Math.round(a / b * 1000) / 10).replace('.', ',') + '%' : '—');
let n = 0, bad = 0; const chk = (c, m) => { n++; if (!c) { bad++; if (bad <= 15) console.log('✗ ' + m); } };
const want = (R) => [['CB', () => true], ['CB до 35% банка', (p) => p < 35], ['CB больше 50% банка', (p) => p > 50], ['CB больше 80% банка', (p) => p > 80]].map(([lab, ok]) => {
  const fl = R.filter(r => r[2]), cb = fl.filter(r => r[3] && ok(r[4])), tu = cb.filter(r => r[7]), rv = tu.filter(r => r[8] && r[10]);
  return [lab, [cb.length, fl.length], [tu.filter(r => r[8]).length, tu.length], [rv.filter(r => r[11]).length, rv.length]]; });
/* CB-Fold / Call / 3Bet: ответ на рейз после моей ставки — флоп [5], тёрн [35], ривер [36] (1 фолд, 2 колл, 3 рейз) */
const wantR = (R) => [['CB-Fold', 1], ['CB-Call', 2], ['CB-3Bet', 3]].map(([lab, k]) => [lab, ...[[5, 6], [35, 37], [36, 38]].map(([i, ai]) => { const xs = R.filter(r => r[i] >= 1 && r[i] <= 3 && (k !== 3 || !r[ai])); return [xs.filter(r => r[i] === k).length, xs.length]; })]); /* 3Bet — без чек-рейзов олл-ином */
const Q = ['мои конбеты против BB', 'таблица моих конбетов как рейзер против большого блайнда вдвоём', 'мои цбеты против бб', 'c-bet против big blind', 'мои контбеты против ББ один на один', 'мои комбеты на бб', 'Total CBET рейзер против BB, хедс-ап', 'тотал цбет хедс-ап банк как рейзер', 'total c-bet рейзер против большого блайнда', 'мои конбеты в хедз-ап банке', 'мой цбет один на один как рейзер'];
const POS = [['', 1], [' в позиции', 1], [' без позиции', 1]] /* только в позиции (владелец 26.11.2026): SB не берём, «без позиции» — та же таблица */, STK = [['', null], [' на 20-35 бб', [20, 35]], [' на больших стеках', 'big']];
(async () => {
  const bandsOf = async () => null;
  for (const q0 of Q) for (const [pw, ip] of POS) for (const [sw] of STK) {
    const q = q0 + pw + sw, a = await ask(q), B = (a.blocks || []).find(b => b.table);
    if (!B) { chk(false, q + ': нет таблицы — ' + (a.blocks || []).map(b => b.title || b.text).join(' | ')); continue; }
    chk(/Total CBET: я рейзер против большого блайнда, хедс-ап банк/.test(B.title), q + ': заголовок ' + B.title);
    chk(/, в позиции( · стек .*)?$/.test(B.title) && !/SB/.test(B.title), q + ': позиция в заголовке ' + B.title);
    /* стек — бот сам переводит слова в банды; пересчёт берёт те же банды из подписи «стек …» нельзя — берём все записи при пустом стеке */
    if (!sw) { const R = ALL.filter(r => r[34] === 1), W = want(R).concat(wantR(R)); { const o = R.filter(r => r[39]), row = B.table.rows.find(x => x[0] === 'CB · XX · B'); chk(row && row[3].v === pv(o.filter(r => r[40]).length, o.length) && row[3].n === o.length, q + ' · CB · XX · B: бот ' + (row && row[3].v) + ', пересчёт ' + pv(o.filter(r => r[40]).length, o.length)); }
      W.forEach((w, i) => { const row = B.table.rows[i]; chk(row && row[0] === w[0], q + ': строка ' + (row && row[0]) + ', ждали ' + w[0]);
        for (let c = 1; c <= 3; c++) chk(row && row[c].v === pv(w[c][0], w[c][1]) && row[c].n === w[c][1], q + ' · ' + w[0] + ' · улица ' + c + ': бот ' + (row && row[c].v) + '/' + (row && row[c].n) + ', пересчёт ' + pv(w[c][0], w[c][1]) + '/' + w[c][1]); }); }
    else { /* со стеком — суммы: каждая клетка не больше, чем без стека */
      const R = ALL.filter(r => r[34] === 1), W = want(R);
      W.forEach((w, i) => { const row = B.table.rows[i]; for (let c = 1; c <= 3; c++) chk(row && row[c].n <= w[c][1], q + ' · ' + w[0] + ': знаменатель со стеком больше общего'); });
      chk(/стек/.test(B.note), q + ': в подписи нет стека'); }
  }
  /* сами записи: размер конбета есть у каждого конбета, тёрн — только после конбета, ривер — только после ставки на тёрне */
  for (const r of ALL) { if (r[3]) chk(r[4] > 0, 'запись: конбет без размера'); if (r[7]) chk(r[3], 'запись: тёрн без конбета'); if (r[10]) chk(r[8], 'запись: ривер без ставки на тёрне'); chk(r[34] === 0 || r[34] === 1, 'запись: позиция'); }
  /* голое «Total CBET» без пояснения — подсказка, не таблица (владелец 26.11.2026) */
  for (const q of ['Total CBET', 'тотал цбет', 'мой тотал конбет']) { const a = await ask(q); chk(!(a.blocks || []).some(b => b.table && /Total CBET/.test(b.title || '')) && (a.blocks || []).some(b => /хедс-ап банка, когда я рейзер против большого блайнда/.test(b.text || '')), q + ': ждали подсказку, пришло ' + (a.blocks || []).map(b => b.title || b.text).join(' | ')); }
  /* названный размер × стек (владелец 26.11.2026): все клетки — только раздачи с этим размером на этой улице, ответы на чек-рейз — после этого размера; стек — фильтр */
  const SZQ = [['больше 60%', 0, 60, 1e5], ['до 35%', 0, 0, 35.5], ['от 40 до 60%', 0, 40, 60.5], ['тёрн больше 60%', 1, 60, 1e5], ['тёрн до 50%', 1, 0, 50.5], ['ривер от 50%', 2, 50, 1e5], ['овербет', 0, 100.5, 1e5], ['флоп треть', 0, 29, 40]];
  for (const [sw, s0, lo, hi] of SZQ) for (const [stw] of STK) {
    const q = 'мои конбеты против BB ' + sw + stw, a = await ask(q), B = (a.blocks || []).find(b => b.table);
    if (!B) { chk(false, q + ': нет таблицы'); continue; }
    chk(/размер:/.test(B.title), q + ': в заголовке нет размера ' + B.title);
    /* стек: банды берём из ответа бота на тот же стек без размера — число раздач CB флоп совпадает */
    const SB = { '': null, ' на 20-35 бб': ['20-35'], ' на больших стеках': ['60-99', '100-149', '150+'] }[stw]; const R = ALL.filter(r => r[34] === 1 && (!SB || SB.includes(r[0])));
    const OI = [2, 7, 10], BI = [3, 8, 11], ZI = [4, 9, 12], RI = [[5, 6], [35, 37], [36, 38]], inS = (r, s) => s !== s0 || (r[BI[s]] && r[ZI[s]] >= lo && r[ZI[s]] < hi), up = (r, s) => { for (let i = 0; i < s; i++) if (!inS(r, i)) return false; return true; };
    const W = [['CB', ...[0, 1, 2].map(s => { if (s < s0) return null; const b = R.filter(r => up(r, s) && r[OI[s]]); return [b.filter(r => r[BI[s]] && inS(r, s)).length, b.length]; })], ...[['CB-Fold', 1], ['CB-Call', 2], ['CB-3Bet', 3]].map(([lab, k]) => [lab, ...[0, 1, 2].map(s => { if (s < s0) return null; const [i, ai] = RI[s], b = R.filter(r => up(r, s + 1) && r[i] >= 1 && r[i] <= 3 && (k !== 3 || !r[ai])); return [b.filter(r => r[i] === k).length, b.length]; })])];
    W.forEach((w, j) => { const row = B.table.rows[j]; chk(row && row[0] === w[0], q + ': строка ' + (row && row[0])); for (let c = 1; c <= 3; c++) { const x = w[c]; chk(row && (x ? row[c].v === pv(x[0], x[1]) && row[c].n === x[1] : row[c].v === '—'), q + ' · ' + w[0] + ' · улица ' + c + ': бот ' + (row && row[c].v) + '/' + (row && row[c].n) + ', пересчёт ' + (x ? pv(x[0], x[1]) + '/' + x[1] : '—')); } });
    { const row = B.table.rows[4], b = s0 === 1 ? null : R.filter(r => r[39] && (s0 !== 0 || (r[3] && r[4] >= lo && r[4] < hi))), x = b && [b.filter(r => r[40] && (s0 !== 2 || (r[41] >= lo && r[41] < hi))).length, b.length]; chk(row && row[0] === 'CB · XX · B' && (x ? row[3].v === pv(x[0], x[1]) && row[3].n === x[1] : row[3].v === '—'), q + ' · CB · XX · B: бот ' + (row && row[3].v) + ', пересчёт ' + (x ? pv(x[0], x[1]) : '—')); }
    chk(B.table.rows.length === 5, q + ': строк ' + B.table.rows.length);
  }
  /* мультивей не задет */
  { const a = await ask('мои конбеты в мультивее в позиции как рейзер'), B = (a.blocks || []).find(b => b.table); chk(B && /мультивее/.test(B.title), 'мультивей: ' + (B && B.title)); }
  console.log('проверок: ' + n + ', совпало: ' + (n - bad) + ', ошибок: ' + bad);
})();
