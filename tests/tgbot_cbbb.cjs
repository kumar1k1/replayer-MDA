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
const Q = ['мои конбеты против BB', 'таблица моих конбетов как рейзер против большого блайнда вдвоём', 'мои цбеты против бб', 'c-bet против big blind', 'мои контбеты против ББ один на один', 'мои комбеты на бб', 'Total CBET рейзер против BB, хедс-ап', 'тотал цбет хедс-ап банк как рейзер', 'total c-bet рейзер против большого блайнда', 'мои конбеты в хедз-ап банке', 'мои цбеты один на один как рейзер'];
const POS = [['', 1], [' в позиции', 1], [' без позиции', 1]] /* только в позиции (владелец 26.11.2026): SB не берём, «без позиции» — та же таблица */, STK = [['', null], [' на 20-35 бб', [20, 35]], [' на больших стеках', 'big']];
(async () => {
  const bandsOf = async () => null;
  for (const q0 of Q) for (const [pw, ip] of POS) for (const [sw] of STK) {
    const q = q0 + pw + sw, a = await ask(q), B = (a.blocks || []).find(b => b.table);
    if (!B) { chk(false, q + ': нет таблицы — ' + (a.blocks || []).map(b => b.title || b.text).join(' | ')); continue; }
    chk(/Total CBET: я рейзер против большого блайнда, хедс-ап банк/.test(B.title), q + ': заголовок ' + B.title);
    chk(/, в позиции( \(без позиции — с моего SB — не считаем\))?( · стек .*)?$/.test(B.title), q + ': позиция в заголовке ' + B.title);
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
  /* одна цифра из таблицы (владелец 27.11.2026): ход × улица × размер × стек разными словами — против пересчёта по записям */
  { const MV = [['CB', ['мой конбет', 'мой цбет', 'как часто я ставлю конбет']], ['CB-Fold', ['мой цбет-фолд', 'мой конбет фолд', 'мой фолд на чек-рейз после конбета', 'как часто я сбрасываю на чек-рейз после конбета', 'мой си бет фолд']], ['CB-Call', ['мой цбет-колл', 'мой конбет колл', 'мой колл на чек-рейз после конбета', 'как часто я коллирую чек-рейз после конбета']], ['CB-3Bet', ['мой цбет 3-бет', 'мой 3-бет на чек-рейз после конбета', 'как часто я перерейзиваю чек-рейз после конбета', 'мой ререйз на чек-рейз после конбета']]];
    const ST = [['на флопе', 1], ['на тёрне', 2], ['на ривере', 3], ['по тёрну', 2]], CTX = [' против BB', ' против большого блайнда', ' в хедс-апе против бб'];
    const SZ = [['', null], [' после мелкой по флопу', [0, 0, 33.5]], [' после конбета больше 60% на флопе', [0, 60, 1e5]], [' после маленького конбета', [0, 0, 33.5]]];
    const SKS = [['', null], [' на 20-35 бб', ['20-35']], [' на больших стеках', ['60-99', '100-149', '150+']]];
    const OI = [2, 7, 10], BI = [3, 8, 11], ZI = [4, 9, 12], RI = [[5, 6], [35, 37], [36, 38]];
    let k = 0;
    for (const [lab, words] of MV) for (const w of words) for (const [stw, col] of ST) for (const [szw, sz] of SZ) { k++; const ctx = CTX[k % 3], [skw, sb] = SKS[k % 3];
      const q = w + ' ' + stw + szw + ctx + skw, a = await ask(q), B = (a.blocks || [])[0];
      if (!B || B.type !== 'big' || (a.blocks || []).length !== 1) { chk(false, q + ': ждали одну цифру, пришло ' + (a.blocks || []).map(b => b.type + ' ' + (b.title || b.text)).join(' | ')); continue; }
      const s = col - 1, s0 = sz ? sz[0] : -1, R = ALL.filter(r => r[34] === 1 && (!sb || sb.includes(r[0])));
      const inS = (r, i) => i !== s0 || (r[BI[i]] && r[ZI[i]] >= sz[1] && r[ZI[i]] < sz[2]), up = (r, i) => { for (let j = 0; j < i; j++) if (!inS(r, j)) return false; return true; };
      let x; if (sz && s < s0) x = null; else if (lab === 'CB') { const b = R.filter(r => up(r, s) && r[OI[s]]); x = [b.filter(r => r[BI[s]] && inS(r, s)).length, b.length]; } else { const kk = { 'CB-Fold': 1, 'CB-Call': 2, 'CB-3Bet': 3 }[lab], [i, ai] = RI[s], b = R.filter(r => up(r, s + 1) && r[i] >= 1 && r[i] <= 3 && (kk !== 3 || !r[ai])); x = [b.filter(r => r[i] === kk).length, b.length]; }
      chk(B.title.includes('— ' + lab + ' ' + ['флоп', 'тёрн', 'ривер'][s] + ' ·'), q + ': понял как ' + B.title);
      chk(!sz || /размер: флоп/.test(B.title), q + ': размер не понят — ' + B.title); chk(!sb || /стек/.test(B.title), q + ': стек не понят — ' + B.title);
      chk(x && x[1] ? B.big === pv(x[0], x[1]) && B.n === x[1] : B.big === 'нет данных', q + ': бот ' + B.big + '/' + B.n + ', пересчёт ' + (x ? pv(x[0], x[1]) + '/' + x[1] : '—')); }
    /* CB · XX · B одной цифрой */
    for (const q of ['мой бет на ривере после чек-чека по терну и конбета флопа против BB', 'мой бет ривера после конбета флопа и чек-чека на тёрне против бб', 'моя ставка на ривере после чек-чека по тёрну и конбета на флопе в хедс-апе против бб', 'мой конбет на ривере после чек-чек на тёрне против BB', 'моя ставка на ривере после конбета и прочеканного тёрна против бб', 'мой CB XX B против большого блайнда']) { const a = await ask(q), B = (a.blocks || [])[0], o = ALL.filter(r => r[34] === 1 && r[39]); chk(B && B.type === 'big' && /CB · XX · B ривер/.test(B.title) && B.big === pv(o.filter(r => r[40]).length, o.length), q + ': ' + (B && (B.title + ' ' + B.big))); }
    /* несколько ходов / улиц в одном вопросе — ответ на каждый */
    for (const [q, n] of [['мой цбет фолд и цбет колл против BB', 2], ['мой цбет фолд на флопе и на тёрне против BB', 2], ['мой цбет 3-бет на флопе, тёрне и ривере против бб', 3]]) { const a = await ask(q); chk((a.blocks || []).filter(b => b.type === 'big').length === n, q + ': ответов ' + (a.blocks || []).length + ', ждали ' + n); }
  }
  /* линии рейзера против BB (владелец 27.11.2026): линия × размер × олл-ин × стек — выигрыш на шоудауне / банка против пересчёта */
  { const LN = [['бет-чек-бет', 'BXB'], ['чек-бет-бет', 'XBB'], ['бет-бет-чек', 'BBX'], ['бет бет бет', 'BBB'], ['бет-чек-чек', 'BXX'], ['чек-чек-бет', 'XXB'], ['бет-бет', 'BB'], ['ставя все 3 улицы', 'BBB'], ['три барреля', 'BBB']];
    const COND = [['', [], []], [' при ставке по риверу больше пота', [[2, 100.5, 1e5]], []], [' при ставке на флопе до 33%', [[0, 0, 33.5]], []], [' и завершая на ривере олл-ин ставкой', [], [2]], [' с олл-ином на тёрне', [], [1]], [' при ставке на тёрне от 50%', [[1, 50, 1e5]], []]];
    const WH = [['как часто рейзер выигрывает на шоудауне по линии ', 'sd'], ['мой выигрыш на шоудауне по линии ', 'sd'], ['как часто я выигрываю банк по линии ', 'pot'], ['как часто рейзер выигрывает у большого блайнда банк по линии ', 'pot']];
    const SKS = [['', null], [' на больших стеках', ['60-99', '100-149', '150+']], [' на 20-35 бб', ['20-35']]];
    let k = 0;
    for (const [lw, code] of LN) for (const [cw, sz, ai] of COND) for (const [ww, what] of WH) { k++; const [skw, sb] = SKS[k % 3], ctx = /большого блайнда/.test(ww) ? '' : [' против BB', ' в хедс-апе против бб', ' против большого блайнда'][k % 3];
      const pre = /ставя|баррел/.test(lw) ? ww.replace(/по линии $/, '') : ww, q = pre + lw + cw + ctx + skw, a = await ask(q), B = (a.blocks || [])[0];
      if (!B || B.type !== 'big' || (a.blocks || []).length !== 1) { chk(false, q + ': ждали одну цифру, пришло ' + (a.blocks || []).map(b => b.type + ' ' + (b.title || b.text)).join(' | ')); continue; }
      const R = ALL.filter(r => r[34] === 1 && (!sb || sb.includes(r[0])) && code.split('').every((c, s) => (r[42 + s] || '')[0] === c) && sz.every(([s, lo, hi]) => r[48 + s] && r[48 + s] >= lo && r[48 + s] < hi) && ai.every(s => r[45 + s] === 1)), sd = R.filter(r => r[28]);
      const want = what === 'sd' ? (sd.length ? pv(sd.filter(r => r[29]).length, sd.length) : 'нет данных') : (R.length ? pv(R.filter(r => r[30]).length, R.length) : 'нет данных');
      chk(B.title.includes('линия ' + code.split('').map(c => (c === 'B' ? 'бет' : 'чек')).join(' · ')), q + ': линия понята как ' + B.title);
      chk(what === 'sd' ? /выигрыш на шоудауне/.test(B.title) : /выиграл банк/.test(B.title), q + ': что показать — ' + B.title);
      chk(B.big === want, q + ': бот ' + B.big + ', пересчёт ' + want);
      chk(!sb || /стек/.test(B.title), q + ': стек не понят'); chk(!ai.length || /олл-ин на/.test(B.title), q + ': олл-ин не понят'); chk(!sz.length || /\(.*(флоп|тёрн|ривер)/.test(B.title), q + ': размер не понят — ' + B.title); }
  }
  /* все сыгранные линии (владелец 27.11.2026): каждая строка — линия с размерами, раздач, вскрытий, W$SD — против пересчёта */
  { const SZ = (p) => (p < 29 ? '~25%' : p < 40 ? '~33%' : p < 58 ? '~50%' : p < 70 ? '~66%' : p < 88 ? '~75%' : p <= 100.5 ? '~100%' : 'овер');
    const lab = (r) => [0, 1, 2].map(s => { const a = r[42 + s]; if (!a) return null; return a.split('').map((c, j) => (c === 'B' && j === 0 ? 'B(' + SZ(r[48 + s]) + (r[45 + s] ? ' AI' : '') + ')' : c)).join('-'); }).filter(Boolean).join(' · ');
    for (const [q, sb] of [['все мои линии против BB', null], ['все сыгранные линии рейзера против большого блайнда', null], ['какие линии я играл в хедс-апе против бб на больших стеках', ['60-99', '100-149', '150+']], ['все мои линии против BB на 20-35 бб', ['20-35']]]) {
      const a = await ask(q), B = (a.blocks || [])[0]; if (!B || !B.table) { chk(false, q + ': нет списка — ' + (a.blocks || []).map(b => b.title || b.text).join(' | ')); continue; }
      const R = ALL.filter(r => r[34] === 1 && (!sb || sb.includes(r[0]))), G = {}; for (const r of R) { const k = lab(r); if (k) (G[k] = G[k] || []).push(r); }
      const W = Object.entries(G).filter(([, xs]) => xs.some(r => r[28]));
      chk(B.table.rows.length === W.length, q + ': строк ' + B.table.rows.length + ', ждали ' + W.length);
      let prev = 1e9; for (const row of B.table.rows) { const xs = G[row[0]]; if (!xs) { chk(false, q + ': лишняя линия ' + row[0]); continue; } const sd = xs.filter(r => r[28]); chk(+row[1].v === xs.length && +row[2].v === sd.length && row[3].v === pv(sd.filter(r => r[29]).length, sd.length), q + ' · ' + row[0] + ': бот ' + row.slice(1).map(c => c.v).join('/') + ', пересчёт ' + xs.length + '/' + sd.length + '/' + pv(sd.filter(r => r[29]).length, sd.length)); chk(sd.length <= prev, q + ': порядок'); prev = sd.length; }
    }
    /* «ставя все 3 улицы» — не список, а одна линия */
    { const a = await ask('как часто рейзер выигрывает у большого блайнда банк, ставя все 3 улицы'), B = (a.blocks || [])[0]; chk(B && B.type === 'big' && /линия бет · бет · бет/.test(B.title), 'все 3 улицы: ' + (B && B.title)); }
  }
  /* размеры ставок в линии (владелец 27.11.2026): «самая частая по размеру ставка на ривере, когда играю бет-бет-бет» — корзины против пересчёта; «бет-бет-бет» без слова «линия» */
  { const SZ = (p) => (p < 29 ? '~25%' : p < 40 ? '~33%' : p < 58 ? '~50%' : p < 70 ? '~66%' : p < 88 ? '~75%' : p <= 100.5 ? '~100%' : 'овер'), BK = ['~25%', '~33%', '~50%', '~66%', '~75%', '~100%', 'овер'];
    const QS = [['Какая у меня самая частая по размеру ставка на ривере, когда я рейзер против большого блайнда и играю бет-бет-бет?', 'BBB', 2, null], ['какой размер ставки на тёрне я чаще всего ставлю по линии чек-бет-бет против BB', 'XBB', 1, null], ['какие сайзинги я использую на флопе в линии бет-бет-бет против бб на больших стеках', 'BBB', 0, ['60-99', '100-149', '150+']], ['каким размером я ставлю ривер, когда играю бет-чек-бет против бб', 'BXB', 2, null], ['размер ставки на флопе в линии бет-бет-чек против BB', 'BBX', 0, null]];
    for (const [q, code, s, sb] of QS) { const a = await ask(q), B = (a.blocks || [])[0]; if (!B || !B.table) { chk(false, q + ': нет таблицы размеров — ' + (a.blocks || []).map(b => b.title || b.text).join(' | ')); continue; }
      const X = ALL.filter(r => r[34] === 1 && (!sb || sb.includes(r[0])) && code.split('').every((c, i) => (r[42 + i] || '')[0] === c) && r[48 + s]), G = {}; for (const r of X) (G[SZ(r[48 + s])] = G[SZ(r[48 + s])] || []).push(r);
      const W = BK.filter(k => G[k]); chk(B.table.rows.length === W.length, q + ': строк ' + B.table.rows.length + ', ждали ' + W.length);
      W.forEach((k, i) => { const row = B.table.rows[i], xs = G[k], sd = xs.filter(r => r[28]); chk(row && +row[1].v === xs.length && row[2].v === pv(xs.length, X.length) + ' (' + (sd.length ? pv(sd.filter(r => r[29]).length, sd.length) : '—') + ')', q + ' · ' + k + ': бот ' + (row && row.slice(1).map(c => c.v).join('/'))); });
      const top = W.slice().sort((a2, b2) => G[b2].length - G[a2].length)[0]; chk(B.title.includes('на ' + ['флопе', 'тёрне', 'ривере'][s]) && B.title.includes('чаще всего ' + (top === 'овер' ? 'овербет' : top)) && B.title.includes('(выиграл на вскрытии ' + (() => { const sd = G[top].filter(r => r[28]); return sd.length ? pv(sd.filter(r => r[29]).length, sd.length) : '—'; })() + ')'), q + ': заголовок ' + B.title); }
    /* «чек-чек» в Total CBET — не линия */
    { const a = await ask('мой конбет на ривере после чек-чек на тёрне против BB'), B = (a.blocks || [])[0]; chk(B && /CB · XX · B/.test(B.title), 'чек-чек не линия: ' + (B && B.title)); }
  }
  /* линия записью размеров (журнал 27.11.2026): «b33%+b60%+b75%+» — бет от 33 / 60 / 75%; «x» — чек; число без «+» — корзина размера */
  { const SZB = [[0, 29], [29, 40], [40, 58], [58, 70], [70, 88], [88, 100.5], [100.5, 100000]], bk = (n) => SZB.find(([lo, hi]) => n >= lo && n < hi);
    for (const [q, code, fs, what] of [['выйгрыш на шд после связки сайзингов когдя я рейзер против ББ b 33%+b60%++b75%+', 'BBB', [[33, 1e5], [60, 1e5], [75, 1e5]], 'sd'], ['выигрыш на шоудауне по линии b33+ x b75+ против BB', 'BXB', [[33, 1e5], null, [75, 1e5]], 'sd'], ['выигрыш банка b50 b75 против бб', 'BB', [bk(50), bk(75)], 'pot']]) {
      const a = await ask(q), B = (a.blocks || [])[0], R = ALL.filter(r => r[34] === 1 && code.split('').every((c, s) => (r[42 + s] || '')[0] === c) && fs.every((f, s) => !f || (r[48 + s] && r[48 + s] >= f[0] && r[48 + s] < f[1]))), sd = R.filter(r => r[28]);
      const want = what === 'sd' ? (sd.length ? pv(sd.filter(r => r[29]).length, sd.length) : 'нет данных') : (R.length ? pv(R.filter(r => r[30]).length, R.length) : 'нет данных');
      chk(B && B.type === 'big' && B.big === want && B.title.includes('линия ' + code.split('').map(c => (c === 'B' ? 'бет' : 'чек')).join(' · ')), q + ': бот ' + (B && (B.big + ' ' + B.title)) + ', пересчёт ' + want); } }
  /* мультивей не задет */
  { const a = await ask('мои конбеты в мультивее в позиции как рейзер'), B = (a.blocks || []).find(b => b.table); chk(B && /мультивее/.test(B.title), 'мультивей: ' + (B && B.title)); }
  console.log('проверок: ' + n + ', совпало: ' + (n - bad) + ', ошибок: ' + bad);
})();
