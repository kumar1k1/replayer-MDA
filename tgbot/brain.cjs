'use strict';
// «Мозг» TG-бота (владелец, 23.11.2026): Claude понимает вопрос любыми словами (текст или то, что услышал Whisper)
// и переводит его в точный запрос. Цифры Claude НЕ считает и не придумывает — их всегда даёт база (server.cjs answer()).
// Ключа нет / нет связи / ошибка — бот работает как раньше, по своему разбору слов.
// Ключ: переменная ANTHROPIC_API_KEY или `ant auth login`; модель — TGBOT_MODEL (по умолчанию claude-opus-5-5).
let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); Anthropic = Anthropic.default || Anthropic; } catch (e) { Anthropic = null; }

const MODEL = process.env.TGBOT_MODEL || 'claude-opus-5-5';
/* справочник (tests/gen_brain_ref.cjs → brain_ref.txt): что бот умеет, словарь голоса, правильные фразы — кешируется вместе с подсказкой */
const REF = (() => { try { return require('fs').readFileSync(require('path').join(__dirname, 'brain_ref.txt'), 'utf8'); } catch (e) { return ''; } })();
/* расход (27.11.2026): токены и деньги с запуска — для проверок с потолком трат (/api/brainstats); цена за 1 млн токенов: вход, запись в кеш, чтение кеша, выход */
const PRICE = { 'claude-haiku-5-5': [0.10, 0.125, 0.01, 0.50], 'claude-sonnet-5-5': [2, 2.5, 0.10, 10], 'claude-opus-5-5': [4, 5, 0.20, 20] }[MODEL] || [4, 5, 0.20, 20];
const USE = { calls: 0, in: 0, cw: 0, cr: 0, out: 0, usd: 0 };
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
  'SQUARE', 'RFI', 'WINRATE', 'WINRATE_POS', 'VS_OPEN', 'BLIND_VS_OPEN', 'VS_3BET', 'SQUEEZE', 'VS_SQUEEZE', 'ISO', 'VS_ALLIN', 'CBET', 'BET_SKIP', 'POSTFLOP', 'UNKNOWN'];
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['me', 'nick', 'stat', 'position', 'stack_bb', 'stack_from', 'stack_to', 'table', 'by_stack', 'heads_up', 'room', 'stack_groups', 'positions', 'allin', 'action', 'opener', 'vs_matrix', 'limpers', 'callers', 'parts', 'in_position', 'sqz_role', 'cbet_kind', 'cbet_pot', 'clean'],
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
    cbet_kind: { type: 'string', enum: ['none', 'table', 'sizes', 'flop', 'turn', 'river', 'fold', 'call', 'raise', 'delay_turn', 'delay_river', 'plus_bet'], description: 'для CBET и BET_SKIP: сайзинги / размеры конбета (% банка) и фолд на рейз после каждого — sizes; таблица («мои цбеты», «по улицам», «таблицей») — table; одна цифра: флоп / тёрн / ривер, цбет-фолд / колл / ререйз на рейз, отложенный цбет на тёрне / ривере, +бет; иначе none' },
    cbet_pot: { type: 'string', enum: ['any', 'hu', 'mw'], description: 'для CBET и BET_SKIP: один на один (хедз-ап) — hu; мультивей / мультипот / трое и больше / на коллеров / «как рейзер в позиции на обоих (всех) игроков» в мультивее — mw; иначе any' },
    sqz_role: { type: 'string', enum: ['any', 'pfr', 'cc', 'cc_opener_fold', 'cc_opener_call'], description: 'для VS_SQUEEZE: «как рейзер / открывший / после опена» — pfr; «как коллер / после колла» — cc; коллер, когда первый рейзер выкинул (сбросил) — cc_opener_fold, заколлировал — cc_opener_call; иначе any' },
    positions: { type: 'array', description: 'колонки — позиции, если назвали несколько или группу позиций; иначе []', items: { type: 'string', enum: ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'] } },
    clean: { type: 'string', description: 'вопрос, переписанный словами бота (как в примерах справочника): ошибки распознавания исправлены, лишние слова и повтор убраны, ВСЕ условия сохранены — спот (мультивей / против BB / хедс-ап), роль (рейзер / коллер), позиция, улицы, размер ставки с его улицей, линия, ход (фолд / колл / 3-бет / рейз), стек, олл-ин, «мой» / ник; ничего не добавляй от себя' },
  },
};
const SYSTEM = `Ты — разборщик вопросов бота покерной статистики. Кроме полей заполни clean — вопрос словами бота (смотри справочник ниже).
Бот — про турниры: префлоп и постфлоп. Пользователь говорит голосом
или пишет по-русски, часто с ошибками распознавания: «ВВСФ», «дабл ю дабл ю эс эф» = WWSF; «втсд» = WTSD; «вин доллар шоудаун» = W$SD;
«эр эф ай», «РФ», «эрфай», «опен-рейз первым», «открытие» = RFI; «трибет», «3-бет» = 3BET; «фолд на трибет» = FOLD_3BET;
«баттон», «батон», «кнопка», «дилер» = BTN; «катофф», «кат офф» = CO; «хайджек» = HJ; «малый блайнд» = SB; «большой блайнд» = BB;
«ранняя позиция», «андер зе ган», «UTG» = EP; «средняя» = MP. «Блайндов», «бб», «больших» — стек в bb; числа словами переводи в цифры.
Статы: VPIP, PFR, VPIP_PFR (оба сразу), 3BET (3-бет), COLD_CALL (колд-колл, «колл в холодную», «коллы против одного рейза / опена» без коллеров), COLD_CALL_3BET (колл 3-бета в холодную: кто-то открылся, другой 3-бетнул, я коллирую; таблица по позициям показывает и Open 4bet), COLD_4BET (4-бет в холодную, «open 4bet», «холодный 4-бет»: опен, 3-бет, я 4-бечу, не вкладываясь раньше), 4BET (мой 4-бет после моего опена и 3-бета; таблица — 4bet, 4bet Range, 4bet NAI), FOLD_4BET (мой фолд на 4-бет после моего 3-бета), 3BET_SIZES (3-беты по сайзам / размерам / сайзингам и фолд на 4-бет), 3BET_VS_ISO (3-бет против изолейта: до меня лимп, его изолировали, я 3-бечу), OVERCALL (оверколл: коллирую опен третьим / четвёртым в банк, после коллеров; владелец называет это и «колд-колл третьим / четвёртым», голос пишет «колд колы 3» — это OVERCALL), FOLD_3BET, LIMP (лимп первым; лимп-фолд / лимп-колл / лимп-рейз — action fold / call / raise; «лимпы по позициям» — таблица), WTSD, WSD (W$SD), WWSF, BET_RIVER, FOLD_RIVER
(фолд на ставку на ривере), SQUARE (квадрат WS/WN/LS/LN), RFI, WINRATE (винрейт / выигрыш / bb/100), WINRATE_POS (винрейт по позициям),
VS_OPEN (ответы на опен: колл/3-бет), BLIND_VS_OPEN (как я на BB или SB реагирую против опенов со всех позиций: таблица Fold / Call / 3B / 3B NAI / 3B AI по позиции открывшего; «BB vs», «защита BB»; position — BB или SB, оба блайнда — none), VS_3BET (после своего опена против 3-бета), SQUEEZE (мои сквизы), VS_SQUEEZE (мой ответ на сквиз против меня: фолд / колл / 4-бет на сквиз, «F vs SQZ», «реакции на сквиз»; одно действие — action, все реакции — action any), ISO (изолейт — рейз против лимперов), VS_ALLIN (колл олл-ина), BET_SKIP («как часто ставлю овербет ривера / конбет 33% / отложку 50% … и выигрыш на шоудауне» — один вопрос про размер, не дели на части и не добавляй W; размер ставки в % банка из вопроса бот берёт сам — «конбет до 33%», «тёрн 50%», «отложка от 40%» — таблица покажет ответы только после этого размера; в мультивее роль важна: «как рейзер» — CBET, «как коллер» — BET_SKIP; роль не названа — не выбирай сам, бот покажет обе; «бет флоп + бет тёрн» — cbet_kind turn; ставка на пропуск / бет в пропуск / бет скип / bet vs skip: в мультивее я коллер до флопа, все до меня чекнули — ставлю; флоп / тёрн / ривер, бет-фолд; таблица — «беты в пропуск»; слова «в мультивее» и «в позиции» / «без позиции» передавай, только если сказаны), CBET (конбеты; посчитаны «в мультивее в позиции» и «в мультивее без позиции / вне позиции / out of position / OOP» — cbet_pot mw и in_position ip / oop ставь ТОЛЬКО если человек сам это сказал, иначе any — бот подскажет; дилей / отложенный цбет — delay_turn; продолженная ставка / цбет / си-бет / конбет / контбет / «кон бэт» — голос пишет по-разному: я рейзил до флопа и ставлю на флопе, тёрне, ривере; цбет-фолд, цбет-колл, цбет-ререйз на рейз; отложенный цбет; в позиции — in_position ip, без позиции — oop),
POSTFLOP (c-bet, донк, чек-рейз, флоп, тёрн), card — просто показать игрока / его карточку, UNKNOWN — не про статистику.
«Мой / мои / у меня / моя» — me=true. «Покажи мне …», «скажи мне …» — НЕ про себя (me=false): это про открытого игрока. Ник: латиница, цифры; голос может разбить ник на слова или написать по-русски — восстанови,
как он, скорее всего, пишется латиницей (например «эф эф тони» → FFtonny); не уверен — оставь как услышал.
Один стат без слов «таблица», «по позициям», «по стекам» — table=false, by_stack=false. Таблицу просят и словами «матрица», «разбивка», «сетка», «сводка», «раскладка», «подробно», «развёрнуто», «целиком» — это table=true.
Несколько просьб в одном вопросе («покажи мои 3-беты по позициям и колд-коллы по позициям», «VPIP, PFR и винрейт») — заполни parts, по фразе на каждую;
остальные поля — по первой просьбе. Варианты одного стата — тоже отдельные просьбы, по фразе на каждый: «в позиции и без позиции», «с олл-инами и без олл-инов», «без олл-инов и только олл-ины», «по позициям и по стекам», «цбет-фолд и цбет-колл», «лимп-фолд, лимп-колл и лимп-рейз», «как рейзер и как коллер», «BB и SB» — в каждой фразе повтори всё общее (игрока, мультивей, стек). «3-беты по коротким и большим стекам», «колл третьим и четвёртым» — одна просьба (parts = []).
Уточнение прошлого вопроса («эту таблицу», «то же самое», «тоже самое», «а теперь…», «а для…», «а без олл-инов», «а на 40–80 бб») —
возьми стат, таблицу, позиции и всё прочее из прошлого вопроса и измени только то, что уточнили. Если дан «Разговор» — это последние вопросы: «вернись к прошлой / к той таблице», «то же для второй таблицы», «сравни с предыдущим», «а для рейзера тоже» — бери нужный вопрос из разговора; если вопросов несколько — parts. Повтор одной фразы дважды — это одна фраза.
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
    VS_OPEN: 'против опена', BLIND_VS_OPEN: 'против опенов', VS_3BET: 'фолд на 3-бет по стекам', SQUEEZE: 'сквиз', VS_SQUEEZE: 'реакции на сквиз', ISO: 'изо', VS_ALLIN: 'олл-ин', CBET: 'цбет', BET_SKIP: 'бет в пропуск', POSTFLOP: 'c-bet', UNKNOWN: '' };
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
  if (o.stat === 'CBET') { const ck = { sizes: 'сайзинги цбета', table: 'цбеты таблицей', flop: 'цбет', turn: 'цбет на тёрне', river: 'цбет на ривере', fold: 'цбет фолд на рейз', call: 'цбет колл на рейз', raise: 'цбет ререйз', delay_turn: 'отложенный цбет', delay_river: 'отложенный цбет на ривере', plus_bet: 'цбет плюс бет' }[o.cbet_kind]; if (ck) w[w.indexOf('цбет')] = ck; if (o.cbet_pot === 'mw') w.push('в мультивее'); else if (o.cbet_pot === 'hu') w.push('один на один'); }
  if (o.stat === 'BET_SKIP') { const bk = { table: 'беты в пропуск таблицей', turn: 'бет в пропуск на тёрне', river: 'бет в пропуск на ривере', fold: 'бет-фолд в пропуск' }[o.cbet_kind]; if (bk) w[w.indexOf('бет в пропуск')] = bk; if (o.cbet_pot === 'mw') w.push('в мультивее'); }
  if (o.heads_up && o.stat !== 'CBET') w.push('один на один');
  return w.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// текст → { phrase, parsed } или null (тогда бот разбирает слова сам)
async function understand(text, prevPlayer, prevQ, mem) {
  /* память разговора (26.11.2026): последние 3 вопроса — что спросил, как понял бот, что показал; для «вернись к прошлой», «то же для второй таблицы», «сравни» */
  const memTxt = Array.isArray(mem) && mem.length ? 'Разговор (последние вопросы, от старых к новым):\n' + mem.map((m, i) => (i + 1) + ') спросил: ' + String(m.q || '') + ' → бот понял: ' + String(m.u || '') + (m.s ? ' → показал: ' + String(m.s) : '')).join('\n') + '\n' : '';
  const c = getClient(); if (!c || Date.now() < disabledUntil) return null;
  try {
    const r = await c.beta.messages.create({
      model: MODEL, max_tokens: 2000,
      ...(/haiku/.test(MODEL) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }), /* у Haiku запасной модели при отказе нет */
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: SYSTEM + (REF ? '\n\n' + REF : ''), cache_control: { type: 'ephemeral' } }], /* подсказка и справочник кешируются — повторные вопросы дешевле */
      messages: [{ role: 'user', content: (prevPlayer ? 'Прошлый игрок в разговоре: ' + prevPlayer + '\n' : '') + memTxt + (prevQ ? 'Прошлый вопрос: ' + prevQ + '\n' : '') + 'Вопрос: ' + text }],
    });
    { const u = r.usage || {}; USE.calls++; USE.in += u.input_tokens || 0; USE.cw += u.cache_creation_input_tokens || 0; USE.cr += u.cache_read_input_tokens || 0; USE.out += u.output_tokens || 0; USE.usd = (USE.in * PRICE[0] + USE.cw * PRICE[1] + USE.cr * PRICE[2] + USE.out * PRICE[3]) / 1e6; }
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
const status = () => ({ sdk: !!Anthropic, model: MODEL, keyInFile: !!fileKey(), ready: !!getClient() && Date.now() >= disabledUntil, lastErr, use: USE });
module.exports = { understand, status, toPhrase };
