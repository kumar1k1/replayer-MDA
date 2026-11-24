'use strict';
// Проверка TG-бота на сотни вопросов (24.11.2026): статы × позиции × стеки × олл-ины × таблица/цифра × игрок.
// Без Claude (nobrain=1) — не тратит деньги. Запуск: node tests/tgbot_queries.cjs  (бот должен работать на 8790)
const BASE = 'http://127.0.0.1:8790/api/ask?nobrain=1';
const POS = { EP: 'из ранней позиции', MP: 'с мп', HJ: 'с хайджека', CO: 'с катоффа', BTN: 'с баттона', SB: 'с малого блайнда', BB: 'с бб' };
// стат: фраза, как узнать в заголовке, какие позиции бывают, есть ли «одна цифра», что с олл-инами, IP/OOP
const STATS = [
  { id: 'RFI', q: ['RFI', 'опен первым', 'открытие'], t: /RFI/, pos: ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'], ai: true },
  { id: '3B', q: ['3-бет', 'трибет'], t: /3bet(?! vs)/, pos: ['MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'], ai: true },
  { id: 'CC', q: ['колд-колл', 'колл в холодную'], t: /Cold call(?! 3bet)/, pos: ['MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'] },
  { id: 'OC', q: ['колл третьим в банк', 'колл четвертым в банк'], t: /Колл [34]|колл (третьим|четв)/, pos: ['MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'] },
  { id: 'ISO', q: ['изолейт', 'изо против лимпера'], t: /ISO/, pos: ['MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'], ai: true },
  { id: 'B3I', q: ['3-бет против изолейта'], t: /3bet vs ISO/, pos: ['MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'], ai: true },
  { id: 'F3', q: ['фолд на 3-бет'], t: /фолд на 3-бет/, pos: ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'], ipoop: true },
  { id: 'B4', q: ['4-бет'], t: /4bet|4-бет/, pos: ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'], ai: true, ipoop: true },
  { id: 'CC3', q: ['колл 3-бета в холодную'], t: /колл 3-бета в холодную/, pos: ['MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'] },
];
const SIMPLE = [['VPIP', /VPIP/], ['PFR', /PFR/], ['WTSD', /WTSD/], ['W$SD', /W\$SD/], ['WWSF', /WWSF/], ['бет ривер', /Bet River/], ['фолд на бет на ривере', /Fold to Bet River/], ['лимп', /лимп/], ['квадрат', /квадрат/], ['винрейт', /./], ['фолд на 3-бет в позиции', /фолд на 3-бет/]];
const STACKS = [['', null], ['на 42 бб', /36–59|36-59/], ['до 20 бб', /до 20|<12|12-19|12–19/], ['на коротких стеках', /до 20/], ['от 20 до 35 бб', /20–35|20-35/], ['на больших стеках', /60\+/]];

const checks = [];
const add = (q, ctx, exp) => checks.push({ q, ctx, exp });
const ALIAS = 'alias:все', OTHER = 'ps:FFtonny';
for (const S of STATS) for (const w of S.q) {
  add('мой ' + w, ALIAS, { t: S.t, type: 'big' });
  add('мои ' + w + ' по позициям', ALIAS, { t: S.t, type: 'table' });
  for (const p of Object.keys(POS)) {
    const ok = S.pos.includes(p) || ((p === 'EP') && S.pos.includes('MP'));
    add('мой ' + w + ' ' + POS[p], ALIAS, ok ? { t: S.t, type: 'big', pos: p === 'EP' && !S.pos.includes('EP') ? 'MP' : p } : { textOk: true });
  }
  for (const [st, re] of STACKS.slice(1)) { add('мой ' + w + ' ' + st, ALIAS, { t: S.t, note: re }); add('мои ' + w + ' по позициям ' + st, ALIAS, { t: S.t, type: 'table', note: re }); }
  if (S.ai) { add('мой ' + w + ' без олл-инов', ALIAS, { t: S.t, ai: /без олл-ин|NAI|не олл-ин/ }); add('мои ' + w + ' только олл-ины по позициям', ALIAS, { t: S.t, ai: /олл-ин|AI/ }); add('мои ' + w + ' без пушей', ALIAS, { t: S.t, ai: /без олл-ин|NAI|не олл-ин/ }); }
  if (S.ipoop) { add('мой ' + w + ' в позиции', ALIAS, { t: S.t, title: /в позиции/ }); add('мой ' + w + ' без позиции', ALIAS, { t: S.t, title: /без позиции/ }); add('мой ' + w + ' в позиции и без позиции', ALIAS, { n: 2 }); }
  add(w + ' FFtonny', '', { anyOk: true }); // игрок базы: либо данные, либо «только по вашей базе»
}
for (const [w, re] of SIMPLE) { add('мой ' + w, ALIAS, { t: re }); add('FFtonny ' + w, '', { t: re }); add('покажи ' + w, OTHER, { t: re, player: /FFtonny/ }); }
// матрица 3-бета, сайзы, несколько вопросов, уточнения
for (const [q, e] of [
  ['мой 3-бет позиция против позиции', { type: 'table', t: /позиция против позиции/ }], ['3-бет баттона против катоффа', { type: 'big', t: /с BTN против CO/ }],
  ['мой 3-бет с бб против малого блайнда', { type: 'big', t: /с BB против SB/ }], ['колд-колл позиция против позиции', { type: 'table', t: /Cold call: позиция/ }],
  ['колд-колл с баттона против катоффа', { type: 'big', t: /Cold call с BTN против CO/ }], ['мои 3-беты по сайзам', { type: 'table', t: /сайзам/ }],
  ['мои 3-беты по сайзам на 20-35 бб', { type: 'table', note: /20–35/ }], ['размеры моих 3-бетов с баттона', { type: 'table', t: /с BTN/ }],
  ['мои 3-беты по позициям и колд-коллы по позициям', { n: 2 }], ['мой VPIP, PFR и WWSF', { n: 3 }], ['мой RFI и мой 3-бет', { n: 2 }],
  ['мои изолейты против двух лимперов', { t: /ISO/ }], ['мой изолейт с баттона против одного лимпера', { type: 'big', t: /с BTN против 1/ }],
  ['мой RFI по стекам', { type: 'table' }], ['мой RFI с баттона по стекам', { type: 'table' }], ['мой RFI по средним позициям', { type: 'table', t: /MP, HJ/ }],
  ['мой RFI по поздним позициям на коротком и среднем стеке', { type: 'table' }], ['мои RFI по коротким средним и большим стекам', { type: 'table' }],
  ['RFI с бб', { textOk: true }], ['4-бет с бб', { textOk: true }], ['колд колы 3', { t: /Колл 3/ }],
  ['мой 3-бет с BB стек 50 бб против SB без олл-ина', { type: 'big', t: /3bet NAI с BB против SB/ }],
]) add(q, ALIAS, e);

// расширение: одиночный стек, «таблицей», игрок базы по всем статам и позициям, разговорные формы, голосовые ошибки
for (const S of STATS) { const w = S.q[0];
  add('мой ' + w + ' при 25 бб', ALIAS, { t: S.t, note: /20–35|20-35/ });
  add('покажи таблицей мой ' + w, ALIAS, { t: S.t, type: 'table' });
  add('скажи какой у меня ' + w, ALIAS, { t: S.t });
  add('а ' + w + ' ' + POS.BTN, ALIAS, { anyOk: true });
  for (const p of ['CO', 'BTN', 'BB']) add('FFtonny ' + w + ' ' + POS[p], '', { anyOk: true });
  add('FFtonny ' + w, '', { anyOk: true }); add('FFtonny ' + w + ' по позициям', '', { anyOk: true }); add('FFtonny ' + w + ' на 20-35 бб', '', { anyOk: true });
}
for (const [q, e] of [
  ['мой рф из баттана для стека сорок два блайнда', { type: 'big', t: /RFI с BTN/, note: /36/ }], ['мой эр эф ай с катоффа', { type: 'big', t: /RFI с CO/ }],
  ['покажи мне мой ВВСФ', { t: /WWSF/ }], ['мой втсд один на один', { t: /WTSD \(один на один\)/ }], ['мой вин доллар шоудаун', { t: /W\$SD/ }],
  ['какой у меня фолд на трибет', { t: /фолд на 3-бет/ }], ['мои трибеты без улынов по позициям', { t: /3bet NAI/ }], ['мои 3-беты только пуши', { t: /3bet AI/ }],
  ['мой колл третьим на ББ в стеках 60+', { type: 'big', t: /с BB/, note: /60/ }], ['как я колю третьим в банк', { type: 'big', t: /Колл 3/ }],
  ['мой ВПИП и ПФР', { n: 2, t: /VPIP|PFR/ }], ['мой винрейт по позициям', { anyOk: true }], ['мой алиас', { anyOk: true }], ['FFtonny', { anyOk: true }],
  ['FFtonny 3-бет позиция против позиции', { textOk: true }], ['FFtonny 3-беты по сайзам', { textOk: true }], ['FFtonny винрейт по позициям', { textOk: true }],
  ['мои 3-беты по позициям на 40-80 блайндов', { type: 'table', note: /36/ }], ['RFI по позициям на 42 больших блайнда', { type: 'table', note: /36/ }],
]) add(q, ALIAS, e);
(async () => {
  const fails = [], t0 = Date.now();
  for (const c of checks) {
    let a; try { a = await (await fetch(BASE + '&q=' + encodeURIComponent(c.q) + (c.ctx ? '&ctx=' + encodeURIComponent(c.ctx) : ''))).json(); } catch (e) { fails.push([c.q, 'нет ответа']); continue; }
    const B = (a.blocks || []).filter(b => b.title || b.big || b.table), b = B[0] || (a.blocks || [])[0] || {}, all = JSON.stringify(a.blocks || []);
    const why = [], E = c.exp;
    if (/Ошибка:/.test(all)) why.push('ОШИБКА: ' + all.slice(0, 80));
    if (E.anyOk) { if (!a.blocks || !a.blocks.length) why.push('пусто'); }
    else if (E.textOk) { if (!(a.blocks || []).length) why.push('пусто'); }
    else {
      if (/Не понял|Игрока не нашёл|Про какого игрока/.test(all)) why.push('не понял: ' + (a.blocks[0].text || '').slice(0, 40));
      if (E.t && !(B.some(x => E.t.test(x.title || '')))) why.push('стат? «' + (b.title || b.text || '').slice(0, 60) + '»');
      if (E.type === 'big' && !b.big) why.push('ждали цифру, а ' + (b.table ? 'таблица' : 'другое'));
      if (E.type === 'table' && !b.table) why.push('ждали таблицу, а ' + (b.big ? 'цифра' : 'другое'));
      if (E.pos && !new RegExp(' с ' + E.pos + '(?![A-Z])').test(b.title || '')) why.push('позиция ' + E.pos + '? «' + (b.title || '').slice(0, 50) + '»');
      if (E.note && !E.note.test((b.note || '') + ' ' + (b.title || '') + ' ' + JSON.stringify(b.table ? b.table.rows.map(r => r[0]) : ''))) why.push('стек не учтён: «' + (b.note || '').slice(0, 50) + '»');
      if (E.ai && !E.ai.test((b.ai || '') + ' ' + (b.title || '') + ' ' + (b.note || ''))) why.push('олл-ин? «' + (b.ai || '') + '»');
      if (E.title && !E.title.test(b.title || '')) why.push('заголовок? «' + (b.title || '').slice(0, 60) + '»');
      if (E.n && B.length < E.n) why.push('ответов ' + B.length + ' из ' + E.n);
      if (E.player && !E.player.test(a.player || '')) why.push('игрок ' + a.player);
    }
    if (why.length) fails.push([c.q + (c.ctx ? '  [' + c.ctx + ']' : ''), why.join('; ')]);
  }
  console.log('вопросов: ' + checks.length + ', не прошли: ' + fails.length + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + ' с');
  for (const [q, w] of fails) console.log('✗ ' + q + '  →  ' + w);
})();
