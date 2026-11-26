'use strict';
// «Мозг» TG-бота (владелец, 23.11.2026): Claude понимает вопрос любыми словами (текст или то, что услышал Whisper)
// и переводит его в точный запрос. Цифры Claude НЕ считает и не придумывает — их всегда даёт база (server.cjs answer()).
// Ключа нет / нет связи / ошибка — бот работает как раньше, по своему разбору слов.
// Ключ: переменная ANTHROPIC_API_KEY или `ant auth login`; модель — TGBOT_MODEL (по умолчанию claude-opus-5-5).
let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); Anthropic = Anthropic.default || Anthropic; } catch (e) { Anthropic = null; }

const MODEL = process.env.TGBOT_MODEL || 'claude-opus-5-5';
let client = null, disabledUntil = 0, lastErr = '', keySeen = null;
// ключ: файл tgbot/data/ключ_claude.txt (папка не в git) — владелец вставляет ключ Блокнотом, бот подхватывает без перезапуска;
// иначе — переменная ANTHROPIC_API_KEY / `ant auth login`
const KEYF = require('path').join(__dirname, 'data', 'ключ_claude.txt');
const fileKey = () => { try { const m = /sk-ant-[A-Za-z0-9_\-]+/.exec(require('fs').readFileSync(KEYF, 'utf8')); return m ? m[0] : ''; } catch (e) { return ''; } };
function getClient() {
  if (!Anthropic) return null;
  const k = fileKey();
  if (k !== keySeen) { keySeen = k; client = null; disabledUntil = 0; } // ключ появился / сменился — пробуем сразу
  if (!client) { try { client = new Anthropic(Object.assign({ timeout: 20000, maxRetries: 1 }, k ? { apiKey: k } : {})); } catch (e) { lastErr = e.message; return null; } }
  return client;
}
try { const fs = require('fs'); if (!fs.existsSync(KEYF)) fs.writeFileSync(KEYF, 'Вставьте сюда ключ Claude (начинается с sk-ant-) и сохраните файл.\r\n'); } catch (e) {}

const STATS = ['card', 'VPIP', 'PFR', 'VPIP_PFR', '3BET', 'COLD_CALL', 'OVERCALL', '3BET_VS_ISO', '3BET_SIZES', 'COLD_CALL_3BET', 'COLD_4BET', '4BET', 'FOLD_4BET', 'FOLD_3BET', 'LIMP', 'WTSD', 'WSD', 'WWSF', 'BET_RIVER', 'FOLD_RIVER',
  'SQUARE', 'RFI', 'WINRATE', 'WINRATE_POS', 'VS_OPEN', 'BLIND_VS_OPEN', 'VS_3BET', 'SQUEEZE', 'VS_SQUEEZE', 'ISO', 'VS_ALLIN', 'POSTFLOP', 'UNKNOWN'];
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['me', 'nick', 'stat', 'position', 'stack_bb', 'stack_from', 'stack_to', 'table', 'by_stack', 'heads_up', 'room', 'stack_groups', 'positions', 'allin', 'action', 'opener', 'vs_matrix', 'limpers', 'callers', 'parts', 'in_position', 'sqz_role'],
  properties: {
    me: { type: 'boolean', description: 'спрашивают про себя (мой, мои, у меня, моя статистика)' },
    nick: { type: 'string', description: 'ник игрока, как услышан/написан; пусто — игрок не назван (тогда «его/он» = прошлый игрок)' },
    stat: { type: 'string', enum: STATS },
    position: { type: 'string', enum: ['none', 'EP', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'] },
    stack_bb: { type: ['number', 'null'], description: 'один стек числом в больших блайндах' },
    stack_from: { type: ['number', 'null'] }, stack_to: { type: ['number', 'null'], description: 'диапазон стека «от … до …» / «до 20»' },
    table: { type: 'boolean', description: 'просят таблицу / по позициям' },
    by_stack: { type: 'boolean', description: 'просят разбивку по стекам' },
    heads_up: { type: 'boolean', description: 'один на один (HU)' },
    room: { type: 'string', enum: ['all', 'winamax', 'gg', 'wpn', 'stars'] },
    stack_groups: { type: 'array', description: 'строки таблицы — группы стеков, если их назвали (короткие/средние/большие, «до 15, 15–30, больше 30»); иначе []', items: { type: 'object', additionalProperties: false, required: ['name', 'from', 'to'], properties: { name: { type: 'string' }, from: { type: ['number', 'null'] }, to: { type: ['number', 'null'] } } } },
    opener: { type: 'string', enum: ['none', 'EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'], description: 'против чьего опена (позиция открывшего): «3-бет баттона против MP» → MP; иначе none' },
    vs_matrix: { type: 'boolean', description: '«позиция против позиции», «поза в позу», «детальный 3-бет», «против каждой позиции» — таблица моя позиция × кто открыл' },
    in_position: { type: 'string', enum: ['any', 'ip', 'oop', 'both'], description: '«в позиции» — ip, «без позиции» — oop, оба сразу («в позиции и без позиции») — both; иначе any' },
    parts: { type: 'array', items: { type: 'string' }, description: 'если в вопросе НЕСКОЛЬКО отдельных просьб (два-три разных стата / таблицы) — каждая отдельной короткой фразой с игроком, в стиле «мой 3-бет по позициям», «мой колд-колл по позициям», «FFtonny VPIP»; одна просьба — []' },
    callers: { type: 'string', enum: ['any', '1', '2+'], description: 'для оверколла: третьим в банк (1 коллер) — 1, четвёртым и дальше — 2+; иначе any' },
    limpers: { type: 'string', enum: ['any', '1', '2+'], description: 'для изолейта: против одного лимпера — 1, двух и больше — 2+; иначе any' },
    allin: { type: 'string', enum: ['any', 'without', 'only'], description: '«без олл-инов / без улынов / без пушей / NAI» — without; «только олл-ины / улыны / пуши / олл-ином / AI» — only; иначе any (голос пишет олл-ины как «улыны», «пуши»)' },
    action: { type: 'string', enum: ['any', 'call', '3bet', '4bet', 'raise', 'allin', 'fold'], description: 'для ответов на опен и на сквиз (VS_SQUEEZE: фолд / колл / 4-бет): какое одно действие спросили (колл, 3-бет, олл-ин, фолд); иначе any' },
    sqz_role: { type: 'string', enum: ['any', 'pfr', 'cc', 'cc_opener_fold', 'cc_opener_call'], description: 'для VS_SQUEEZE: «как рейзер / открывший / после опена» — pfr; «как коллер / после колла» — cc; коллер, когда первый рейзер выкинул (сбросил) — cc_opener_fold, заколлировал — cc_opener_call; иначе any' },
    positions: { type: 'array', description: 'колонки — позиции, если назвали несколько или группу позиций; иначе []', items: { type: 'string', enum: ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'] } },
  },
};
const SYSTEM = `Ты — разборщик вопросов бота покерной статистики (турниры, префлоп и пара постфлоп-статов). Пользователь говорит голосом
или пишет по-русски, часто с ошибками распознавания: «ВВСФ», «дабл ю дабл ю эс эф» = WWSF; «втсд» = WTSD; «вин доллар шоудаун» = W$SD;
«эр эф ай», «РФ», «эрфай», «опен-рейз первым», «открытие» = RFI; «трибет», «3-бет» = 3BET; «фолд на трибет» = FOLD_3BET;
«баттон», «батон», «кнопка», «дилер» = BTN; «катофф», «кат офф» = CO; «хайджек» = HJ; «малый блайнд» = SB; «большой блайнд» = BB;
«ранняя позиция», «андер зе ган», «UTG» = EP; «средняя» = MP. «Блайндов», «бб», «больших» — стек в bb; числа словами переводи в цифры.
Статы: VPIP, PFR, VPIP_PFR (оба сразу), 3BET (3-бет), COLD_CALL (колд-колл, «колл в холодную», «коллы против одного рейза / опена» без коллеров), COLD_CALL_3BET (колл 3-бета в холодную: кто-то открылся, другой 3-бетнул, я коллирую; таблица по позициям показывает и Open 4bet), COLD_4BET (4-бет в холодную, «open 4bet», «холодный 4-бет»: опен, 3-бет, я 4-бечу, не вкладываясь раньше), 4BET (мой 4-бет после моего опена и 3-бета; таблица — 4bet, 4bet Range, 4bet NAI), FOLD_4BET (мой фолд на 4-бет после моего 3-бета), 3BET_SIZES (3-беты по сайзам / размерам / сайзингам и фолд на 4-бет), 3BET_VS_ISO (3-бет против изолейта: до меня лимп, его изолировали, я 3-бечу), OVERCALL (оверколл: коллирую опен третьим / четвёртым в банк, после коллеров; владелец называет это и «колд-колл третьим / четвёртым», голос пишет «колд колы 3» — это OVERCALL), FOLD_3BET, LIMP (лимп первым; лимп-фолд / лимп-колл / лимп-рейз — action fold / call / raise; «лимпы по позициям» — таблица), WTSD, WSD (W$SD), WWSF, BET_RIVER, FOLD_RIVER
(фолд на ставку на ривере), SQUARE (квадрат WS/WN/LS/LN), RFI, WINRATE (винрейт / выигрыш / bb/100), WINRATE_POS (винрейт по позициям),
VS_OPEN (ответы на опен: колл/3-бет), BLIND_VS_OPEN (как я на BB или SB реагирую против опенов со всех позиций: таблица Fold / Call / 3B / 3B NAI / 3B AI по позиции открывшего; «BB vs», «защита BB»; position — BB или SB, оба блайнда — none), VS_3BET (после своего опена против 3-бета), SQUEEZE (мои сквизы), VS_SQUEEZE (мой ответ на сквиз против меня: фолд / колл / 4-бет на сквиз, «F vs SQZ», «реакции на сквиз»; одно действие — action, все реакции — action any), ISO (изолейт — рейз против лимперов), VS_ALLIN (колл олл-ина),
POSTFLOP (c-bet, донк, чек-рейз, флоп, тёрн), card — просто показать игрока / его карточку, UNKNOWN — не про статистику.
«Мой / мои / у меня / моя» — me=true. «Покажи мне …», «скажи мне …» — НЕ про себя (me=false): это про открытого игрока. Ник: латиница, цифры; голос может разбить ник на слова или написать по-русски — восстанови,
как он, скорее всего, пишется латиницей (например «эф эф тони» → FFtonny); не уверен — оставь как услышал.
Один стат без слов «таблица», «по позициям», «по стекам» — table=false, by_stack=false.
Несколько просьб в одном вопросе («покажи мои 3-беты по позициям и колд-коллы по позициям», «VPIP, PFR и винрейт») — заполни parts, по фразе на каждую;
остальные поля — по первой просьбе. «3-беты по коротким и большим стекам», «колл третьим и четвёртым» — одна просьба (parts = []).
Уточнение прошлого вопроса («эту таблицу», «то же самое», «тоже самое», «а теперь…», «а для…», «а без олл-инов», «а на 40–80 бб») —
возьми стат, таблицу, позиции и всё прочее из прошлого вопроса и измени только то, что уточнили. Повтор одной фразы дважды — это одна фраза.
Если же в новом вопросе сам назван стат (3-бет, RFI, VPIP…) и нет слов-уточнений («эту», «то же самое», «а теперь», «а для», «а без», «а только») —
это НОВЫЙ вопрос: из прошлого не бери ничего (ни позиций, ни стеков, ни олл-инов), только то, что сказано сейчас.
Таблица под запрос: группы стеков → stack_groups (bb, to — не включая): «короткие» {name:'короткие',from:null,to:20}, «средние» {from:20,to:60},
«большие/глубокие» {from:60,to:null}; «супер большие», «очень большие», «очень глубокие» {from:100,to:null}; «мелкие» = короткие;
«очень короткие» {from:null,to:12}; свои границы — как сказали. Названы «большие» и «супер большие» вместе — большие {from:60,to:100}. Несколько позиций или группа → positions: «ранние позиции» = [EP];
«средние позиции» = [MP, HJ]; «поздние позиции» = [CO, BTN]. «Средний стек» — это стек, НЕ позиция MP.`;

function toPhrase(o) {
  // перевод в фразу, которую понимает разбор server.cjs
  const ST = { card: '', VPIP: 'VPIP', PFR: 'PFR', VPIP_PFR: 'VPIP PFR', '3BET': '3-бет', COLD_CALL: 'колд-колл', '3BET_VS_ISO': '3-бет против изолейта', '3BET_SIZES': '3-беты по сайзам', COLD_CALL_3BET: 'колл 3-бета в холодную', COLD_4BET: '4-бет в холодную', '4BET': '4-бет', FOLD_4BET: 'фолд на 4-бет', OVERCALL: 'колл третьим в банк четвёртым в банк', FOLD_3BET: 'фолд на 3-бет', LIMP: 'лимп', WTSD: 'WTSD', WSD: 'W$SD',
    WWSF: 'WWSF', BET_RIVER: 'бет ривер', FOLD_RIVER: 'фолд на бет на ривере', SQUARE: 'квадрат', RFI: 'RFI', WINRATE: 'винрейт', WINRATE_POS: 'винрейт по позициям',
    VS_OPEN: 'против опена', BLIND_VS_OPEN: 'против опенов', VS_3BET: 'фолд на 3-бет по стекам', SQUEEZE: 'сквиз', VS_SQUEEZE: 'реакции на сквиз', ISO: 'изо', VS_ALLIN: 'олл-ин', POSTFLOP: 'c-bet', UNKNOWN: '' };
  const w = [];
  if (o.me) w.push('мой'); else if (o.nick) w.push(o.nick);
  if (o.room && o.room !== 'all' && o.me) w.push({ winamax: 'winamax', gg: 'gg', wpn: 'wpn', stars: 'stars' }[o.room]);
  w.push(ST[o.stat] || '');
  if (o.stat === 'BLIND_VS_OPEN') w[w.indexOf('против опенов')] = (o.position === 'BB' || o.position === 'SB' ? o.position : 'блайнды') + ' против опенов';
  else if (o.position && o.position !== 'none') w.push('с ' + o.position);
  if (o.stack_bb != null) w.push('стек ' + Math.round(o.stack_bb * 10) / 10 + ' бб');
  else if (o.stack_from != null || o.stack_to != null) w.push((o.stack_from != null ? o.stack_from : 0) + ' до ' + (o.stack_to != null ? o.stack_to : 1000) + ' бб');
  if (o.by_stack) w.push('по стекам');
  else if (o.table) w.push(o.stat === 'WINRATE' || o.stat === 'WINRATE_POS' ? '' : 'по позициям');
  if (o.opener && o.opener !== 'none') w.push('против ' + o.opener); else if (o.vs_matrix) w.push('позиция против позиции');
  if (o.stat === 'OVERCALL' && o.callers === '1') w[w.indexOf('колл третьим в банк четвёртым в банк')] = 'колл третьим в банк'; else if (o.stat === 'OVERCALL' && o.callers === '2+') w[w.indexOf('колл третьим в банк четвёртым в банк')] = 'колл четвёртым в банк';
  if (o.in_position === 'ip') w.push('в позиции'); else if (o.in_position === 'oop') w.push('без позиции'); else if (o.in_position === 'both') w.push('в позиции и без позиции');
  if (o.limpers === '1') w.push('против 1 лимпера'); else if (o.limpers === '2+') w.push('против 2 лимперов');
  if (o.allin === 'without') w.push('без олл-ина'); else if (o.allin === 'only') w.push('олл-ином');
  if (o.stat === 'VS_OPEN' && o.action && o.action !== 'any') w.push({ call: 'колл', '3bet': '3-бет', allin: 'олл-ин', fold: 'фолд' }[o.action]);
  if (o.stat === 'VS_SQUEEZE') { const ac = { fold: 'фолд на сквиз', call: 'колл на сквиз', '4bet': '4-бет на сквиз' }[o.action]; if (ac) w[w.indexOf('реакции на сквиз')] = ac; const rr = { pfr: 'как рейзер', cc: 'как коллер', cc_opener_fold: 'как коллер открывший сбросил', cc_opener_call: 'как коллер открывший заколлировал' }[o.sqz_role]; if (rr) w.push(rr); }
  if (o.stat === 'LIMP') { const lk = { fold: 'лимп-фолд', call: 'лимп-колл', raise: 'лимп-рейз', '3bet': 'лимп-рейз' }[o.action]; if (lk) w[w.indexOf('лимп')] = lk; }
  if (o.heads_up) w.push('один на один');
  return w.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// текст → { phrase, parsed } или null (тогда бот разбирает слова сам)
async function understand(text, prevPlayer, prevQ) {
  const c = getClient(); if (!c || Date.now() < disabledUntil) return null;
  try {
    const r = await c.beta.messages.create({
      model: MODEL, max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: (prevPlayer ? 'Прошлый игрок в разговоре: ' + prevPlayer + '\n' : '') + (prevQ ? 'Прошлый вопрос: ' + prevQ + '\n' : '') + 'Вопрос: ' + text }],
    });
    if (r.stop_reason === 'refusal') return null;
    const t = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const o = JSON.parse(t);
    return { phrase: toPhrase(o), parsed: o };
  } catch (e) {
    lastErr = (e && e.status ? e.status + ' ' : '') + (e && e.message || String(e));
    // нет ключа / неверный ключ — не дёргаем API каждую фразу (проверим снова через 5 минут)
    // нет ключа / неверный ключ / кончились деньги на счёте — не дёргаем API каждую фразу (проверим снова через 5 минут)
    if (e && (e.status === 401 || e.status === 403 || /api key|apiKey|authentication|credential|credit balance|billing/i.test(lastErr))) disabledUntil = Date.now() + 5 * 60000;
    return null;
  }
}
const status = () => ({ sdk: !!Anthropic, model: MODEL, keyInFile: !!fileKey(), ready: !!getClient() && Date.now() >= disabledUntil, lastErr });
module.exports = { understand, status, toPhrase };
