'use strict';
// TG-бот (вспомогательный проект, 23.11.2026): локальный сервер окна статистики игроков.
//   node tgbot/server.cjs  → http://127.0.0.1:8790  (окно открывает «TG-бот.cmd»)
// Запрос — обычная фраза (текстом или голосом): ник → карточка игрока; «3-беты по позициям», «опены», «фолд на 3-бет»,
// «сквиз», «изо», «колл олл-ина», «винрейт», «ривер», «до 20 бб» … Контекст — последний игрок (для «его …»).
const http = require('http'), fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
const ST = require(path.join(ROOT, 'lib', 'stats.js')), LU = require(path.join(ROOT, 'lib', 'lineup.js')), CLU = require(path.join(ROOT, 'lib', 'clusters.js'));
const PORT = +(process.env.PORT || 8790);
const DBF = path.join(__dirname, 'data', 'players.db');
if (!fs.existsSync(DBF)) { console.error('Нет базы ' + DBF + ' — запустите: node tgbot/build_db.cjs'); process.exit(1); }
const db = new DatabaseSync(DBF, { readOnly: true });
const qKey = db.prepare('SELECT * FROM p WHERE key = ?'), qLc = db.prepare('SELECT * FROM p WHERE lc = ? ORDER BY n DESC LIMIT 12');
const qLike = db.prepare("SELECT key, room, nick, n FROM p WHERE lc LIKE ? ORDER BY n DESC LIMIT 8");
// подсказки при вводе: ники, начинающиеся с введённого (диапазон по индексу lc — быстро), самые сыгранные первыми
const qPrefix = db.prepare('SELECT key, room, nick, n, cl FROM p WHERE lc >= ? AND lc < ? ORDER BY n DESC LIMIT 10');
const NCL = ST.CL.length, BANDS = LU.BANDS;
const ROOM_RU = { ps: 'PokerStars', pses: 'PokerStars.es', coin: 'CoinPoker', wpn: 'WPN', ipoker: 'iPoker', chico: 'Chico', '888': '888poker', wnmx: 'Winamax', gg: 'GGPoker', alias: 'мой алиас', 'все': 'все румы' };
const GR_RU = { reg: 'рег', nit: 'нит', fish: 'фиш', superfish: 'суперфиш' };
const pct = (a, b) => (b > 0 ? Math.round(a / b * 1000) / 10 : null);

// ---------- данные игрока ----------
function load(row) {
  const pf = new Float64Array(ST.PF_SLOTS); if (row.pf) for (const s of row.pf.split(',')) { const [o, v] = s.split(':'); pf[+o] = +v; }
  return Object.assign({}, row, { cls: JSON.parse(row.cls || '[]'), pf, r: JSON.parse(row.r || '[]'), ext: row.ext ? JSON.parse(row.ext) : null });
}
const clStat = (P, name) => { const s = ST.CL.indexOf(name); let o0 = 0, h = 0; for (let k = 0; k < 4; k++) { const o = (k * NCL + s) * 2; o0 += P.cls[o] || 0; h += P.cls[o + 1] || 0; } return { n: o0, h, p: pct(h, o0) }; };
function winrate(r, off) { // r: [n,Σ,Σ²] ×(A,B) с отступом off
  const n = (r[off] || 0) + (r[off + 3] || 0), s = (r[off + 1] || 0) + (r[off + 4] || 0), q = (r[off + 2] || 0) + (r[off + 5] || 0);
  if (!n) return null; const m = s / n, sd = Math.sqrt(Math.max(0, q / n - m * m));
  return { n, bb100: Math.round(m * 1000) / 10, ci: Math.round(1.96 * sd / Math.sqrt(n) * 1000) / 10 };
}
function title(P) { return P.room === 'alias' ? P.nick : P.nick + ' · ' + (ROOM_RU[P.room] || P.room); }

// ---------- карточка ----------
function card(P) {
  const g = P.cl != null ? CLU.GROUP[P.cl] : null;
  // статы карточки: { label, v, n } — значение и (маленькой цифрой) сколько раз; { sec } — заголовок блока
  const stats = [], f1 = (v) => (v == null ? '—' : String(v).replace('.', ','));
  const add = (label, st) => stats.push({ label, v: st.p == null ? '—' : f1(st.p) + '%', n: st.n });
  const VP = clStat(P, 'VPIP'), PR = clStat(P, 'PFR');
  stats.push({ label: 'VPIP / PFR', v: VP.p == null ? '—' : f1(VP.p) + ' / ' + f1(PR.p), n: VP.n });
  add('3-бет NAI', clStat(P, '3BetNAI'));
  add('Фолд на 3-бет', clStat(P, 'F3Bet'));
  add('Лимп (не SB)', clStat(P, 'LimpNSB'));
  // WS / LS / WN / LN — банки один на один после флопа (флоп видели ровно двое, без олл-ина префлоп), lib/stats.js
  const WS = clStat(P, 'WS'), LS = clStat(P, 'LS'), WN = clStat(P, 'WN'), LN = clStat(P, 'LN'), HU = WS.n;
  const pv = (a, b) => (b ? f1(pct(a, b)) + '%' : '—');
  // TOTAL — все банки с флопом (любое число игроков): есть только у алиаса (по его раздачам)
  const T = P.ext && P.ext.tot;
  if (T && T.fl) {
    stats.push({ sec: 'TOTAL' });
    stats.push({ label: 'WTSD', v: pv(T.sd, T.fl), n: T.fl }, { label: 'W$SD', v: pv(T.sdw, T.sd), n: T.sd }, { label: 'WWSF', v: pv(T.won, T.fl), n: T.fl });
  }
  stats.push({ sec: 'HU' });
  stats.push({ label: 'WTSD', v: pv(WS.h + LS.h, HU), n: HU }, { label: 'W$SD', v: pv(WS.h, WS.h + LS.h), n: WS.h + LS.h }, { label: 'WWSF', v: pv(WS.h + WN.h, HU), n: HU });
  add('Bet River', clStat(P, 'BetRiverHU'));
  add('Fold to Bet River', clStat(P, 'FoldRiverBetHU'));
  // квадрат тренера: 4 исхода флопа один на один, в сумме 100% (нормы — из «Документации по кластерам»)
  const square = HU ? { n: HU, WS: pct(WS.h, HU), WN: pct(WN.h, HU), LS: pct(LS.h, HU), LN: pct(LN.h, HU), norm: { WS: [14, 15], WN: [38, 40], LS: [13, 14], LN: [33, 36] } } : null;
  // винрейт: у алиаса — реальный выигрыш фишек (как «бб/100» в Hand2Note), рядом — с поправкой на олл-ины по эквити;
  // у игроков базы хранится только с поправкой (так копит конвейер — для отбора топов без удачи)
  const R0 = P.ext && P.ext.raw ? P.ext.raw : P.r, real = !!(P.ext && P.ext.raw);
  const w = winrate(R0, 0), wf = { 'фризаут': winrate(R0, 6), 'PKO': winrate(R0, 12), 'Mystery': winrate(R0, 18) };
  const wev = real ? winrate(P.r, 0) : null;
  return {
    type: 'card', title: title(P),
    sub: [P.n.toLocaleString('ru') + ' рук', P.ns ? 'шорт-столы ' + P.ns.toLocaleString('ru') : '', g ? 'кластер К' + P.cl + ' · ' + (GR_RU[g] || g) + (P.rel === 0 ? ' (предварительно)' : '') : (P.room === 'alias' ? 'ники: ' + (P.nicks || '') : 'кластер не определён')].filter(Boolean),
    group: g, wr: w,
    wrFmt: Object.entries(wf).filter(([, v]) => v && v.n >= 200).map(([k, v]) => ({ k, ...v })),
    square, graph: P.ext && P.ext.graph ? P.ext.graph : null, stats,
  };
}

// ---------- префлоп-разрезы (lib/lineup.js: семейства слотов) ----------
const POSN = { rfi: ['EP', 'MP', 'CO', 'BTN', 'SB'], vso: [['BB', 'BB'], ['SB', 'SB'], ['CO', 'остальные (BTN, CO, HJ, EP)']] };
function famTable(P, fam, bands, byBand) {
  const F = LU.FAM[fam], acts = F.acts, RU = { open: 'опен', limp: 'лимп', shove: 'олл-ин', call: 'колл', '3bet': '3-бет', raise: 'рейз', fold: 'фолд', '4bet': '4-бет', iso: 'изо' };
  const head = ['', 'раз'].concat(acts.map(a => RU[a] || a)).concat(F.explicitFold ? [] : ['фолд']);
  const rowsOf = (label, slots) => {
    let n = 0; const x = acts.map(() => 0);
    for (const o of slots) { n += P.pf[o]; acts.forEach((_, k) => { x[k] += P.pf[o + 1 + k]; }); }
    const cells = x.map(v => (n ? pct(v, n) + '%' : '—'));
    if (!F.explicitFold) cells.push(n ? pct(n - x.reduce((a, b) => a + b, 0), n) + '%' : '—');
    return [label, String(n)].concat(cells);
  };
  const rows = [];
  if (fam === 'rfi' || fam === 'vso') {
    const L = fam === 'rfi' ? POSN.rfi.map(p => [p, p]) : POSN.vso;
    if (byBand) for (const b of bands) for (const [p, lab] of L) rows.push(rowsOf(b + ' · ' + lab, [LU.slotOf(fam, b, p)]));
    else for (const [p, lab] of L) rows.push(rowsOf(lab, bands.map(b => LU.slotOf(fam, b, p))));
  } else for (const b of bands) rows.push(rowsOf(b + ' bb', [LU.slotOf(fam, b, '')]));
  return { head, rows: rows.filter(r => r[1] !== '0') };
}
// RFI как Hand2Note (владелец, 23.11.2026; сверено с его Hand2Note): TOT — любой рейз первым в банк (с олл-инами),
// NAI — без олл-ина; знаменатель — все раз, когда до игрока все сбросили. Позиции: EP (5+ мест до баттона) · MP (3–4) ·
// HJ (2) · CO · BTN; TOT по позициям — без SB, как в Hand2Note. У алиаса — ext.rfi (свои раздачи);
// у игроков базы пока счётчики lineup: позиции крупнее (EP — все ранние, MP — HJ и место перед ним) — до пересчёта.
const RFI_COLS_A = ['EP', 'MP', 'HJ', 'CO', 'BTN'], RFI_COLS_B = ['EP', 'MP', 'CO', 'BTN'];
function rfiSrc(P) {
  if (P.ext && P.ext.rfi) return { h2n: true, cols: RFI_COLS_A, get: (pos, bs) => { let n = 0, t = 0, a = 0; for (const p of pos === 'TOT' ? RFI_COLS_A : [pos]) for (const b of bs) { const x = P.ext.rfi[p] && P.ext.rfi[p][b]; if (x) { n += x[0]; t += x[1]; a += x[2]; } } return { n, tot: t, nai: a }; } };
  const map = { EP: 'EP', MP: 'MP', HJ: 'MP', CO: 'CO', BTN: 'BTN', SB: 'SB' };
  return { h2n: false, cols: RFI_COLS_B, get: (pos, bs) => { let n = 0, t = 0, a = 0; for (const p of pos === 'TOT' ? RFI_COLS_B : [map[pos]]) for (const b of bs) { const s = LU.slotOf('rfi', b, p); n += P.pf[s]; a += P.pf[s + 1]; t += P.pf[s + 1] + P.pf[s + 3]; } return { n, tot: t, nai: a }; } };
}
const pctS = (x, n) => n ? String(pct(x, n)).replace('.', ',') + '%' : '—';
function rfiGrid(P, bands, byBand) {
  const S = rfiSrc(P), head = ['', 'TOT', ...S.cols], rows = [];
  const row = (lab, bs, k) => [lab, ...['TOT', ...S.cols].map(p => { const x = S.get(p, bs); return { v: pctS(x[k], x.n), n: x.n }; })];
  if (!byBand) { rows.push(row('RFI', bands, 'tot')); rows.push(row('NAI', bands, 'nai')); }
  else for (const b of bands) { const r = row(b + ' bb', [b], 'tot'); if (r[1].n) { rows.push(r); } }
  return { head, rows, grid: true };
}const FAM_T = { rfi: 'Первым в банк (опен / лимп / олл-ин) по позициям', vso: 'Против опена: колл / 3-бет / олл-ин по позициям', vs3: 'После своего опена против 3-бета', sqz: 'Сквиз (опен и колл перед ним)', iso: 'Против лимперов: изо / овер-лимп', ai: 'Против олл-ина: колл' };

// ---------- разбор фразы ----------
const STOP = new Set('покажи показать покажите дай выведи найди игрок игрока ник ника стат статы статистика статистику его её ее он она по на в и с у а о об мне про какой какая какие как часто сколько это этот того этого позициям позиции позиций стекам стеку стек стеки бб bb до от против опен опены опена открытия открытие 3бет 3-бет 3-беты 3бета 3-бета трибет трибеты 4бет 4-бет фолд колл коллы сквиз изо лимп лимпы олл-ин олл ин пуш пуши винрейт ривер ривера ставка ставки ставку размер размеры игроку человек человека я мне меня хочу хотел хотела бы узнать скажи посмотреть посмотри из для при стека стеке стеком стэк блайнд блайнда блайндов больших баттон баттона баттоне кнопки катоффа позиции rfi рфи'.split(' '));
// числа словами (голос иногда пишет «сорок два», «сто двадцать») → цифры
const NUMW = { 'ноль': 0, 'один': 1, 'одного': 1, 'два': 2, 'двух': 2, 'три': 3, 'трёх': 3, 'трех': 3, 'четыре': 4, 'четырёх': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10, 'одиннадцать': 11, 'двенадцать': 12, 'тринадцать': 13, 'четырнадцать': 14, 'пятнадцать': 15, 'шестнадцать': 16, 'семнадцать': 17, 'восемнадцать': 18, 'девятнадцать': 19, 'двадцать': 20, 'двадцати': 20, 'тридцать': 30, 'тридцати': 30, 'сорок': 40, 'сорока': 40, 'пятьдесят': 50, 'пятидесяти': 50, 'шестьдесят': 60, 'семьдесят': 70, 'восемьдесят': 80, 'девяносто': 90, 'сто': 100, 'ста': 100, 'двести': 200, 'двухсот': 200 };
function wordsToNum(q) {
  const t = q.split(/\s+/), out = []; let acc = null;
  const flush = () => { if (acc != null) { out.push(String(acc)); acc = null; } };
  for (const w of t) { const k = w.replace(/[.,!?]+$/, ''); if (k in NUMW) { const v = NUMW[k]; acc = acc == null ? v : (acc % 10 === 0 && v < 10) || (acc % 100 === 0 && v < 100) ? acc + v : (out.push(String(acc)), v); } else { flush(); out.push(w); } }
  flush(); return out.join(' ');
}
// позиция во фразе (RFI: EP · MP · CO · BTN · SB)
// отдельное слово (\b в JS не работает с кириллицей — границы вручную)
const W = (alts) => new RegExp('(?:^|[^a-zа-яё0-9])(?:' + alts + ')(?=$|[^a-zа-яё0-9])', 'i');
const POS_RE = [
  ['BTN', /баттон|батон|кнопк|button|дилер/, W('btn|бтн|бт|бу|bu')],
  ['CO', /катоф|кат оф|cut\s*off|cutoff/, W('co|ко|со|си о|си-о')],
  ['SB', /мал[а-яё]* блайнд|смол|small\s*blind/, W('sb|сб|эс би|эсби')],
  ['HJ', /хайдж|хай дж|хайж|hi\s*jack|хиджек/, W('hj|хдж|эйч джей')],
  ['MP', /мидл|middle|средн/, W('mp|мп|эм пи')],
  ['EP', /ранн|андер|under\s*the\s*gun|early/, W('ep|еп|utg|ютг|ю ти джи')],
];
function posOf(q) { for (const [p, a, b] of POS_RE) if (a.test(q) || b.test(q)) return p; return null; }
const bandOfNum = (v) => { let k = 0; const E = [12, 20, 36, 60, 100, 150]; while (k < E.length && v >= E[k]) k++; return BANDS[k]; };
function bandsOf(q) {
  const s = q.replace(',', '.');
  // один стек числом: «стек 42 блайнда», «42 бб», «на 42 больших», «стеком 42»
  const one1 = /(?:стек\w*|стэк\w*|глубин\w*)\s*(?:в\s*)?(\d{1,3}(?:\.\d+)?)/.exec(s) || /(\d{1,3}(?:\.\d+)?)\s*(?:бб|bb|б\.б|блайнд|больш|биг)/.exec(s);
  if (one1 && !/(\d+)\s*(?:-|–)\s*\d+/.test(s) && !/до\s*\d/.test(s)) return Object.assign([bandOfNum(+one1[1])], { num: +one1[1] });
  if (/коротк/.test(s)) return ['<12', '12-19'];
  if (/глубок/.test(s)) return ['60-99', '100-149', '150+'];
  const m = /(\d+)\s*(?:-|–|до|\s)\s*(\d+)\s*(?:бб|bb|б\.б|больш)/.exec(s) || /(?:от\s*)?(\d+)\s*(?:-|–)\s*(\d+)/.exec(s);
  const one = /до\s*(\d+)\s*(?:бб|bb|больш)?/.exec(s);
  const idx = (v) => { let k = 0; const E = [12, 20, 36, 60, 100, 150]; while (k < E.length && v >= E[k]) k++; return k; };
  if (m) { const a = idx(+m[1]), b = idx(Math.max(+m[1], +m[2] - 0.01)); return BANDS.slice(a, b + 1); }
  if (one) return BANDS.slice(0, idx(+one[1] - 0.01) + 1);
  return null;
}
function intentOf(q) {
  if (/донк|c-?bet|кбет|конт|си-?бет|чек-?рейз|чекрейз|флоп|т[её]рн|проб|флоат|барр?ел/.test(q)) return 'postflop';
  if (/сквиз|squeeze/.test(q)) return 'sqz';
  if (/(фолд|ответ|против|на)\s*(на\s*)?(3|три|тр[её]х)\s*-?\s*бет|4\s*-?\s*бет|четыр[её]х?бет|vs\s*3/.test(q)) return 'vs3';
  if (/3\s*-?\s*бет|трибет|тр[её]хбет|3bet|защит|против опен|колл опен|на опен/.test(q)) return 'vso';
  if (/опен|открыт|первым|rfi|рфи|эр\s*эф|стил/.test(q)) return 'rfi';
  if (/изо|лимп|limp|iso/.test(q)) return 'iso';
  if (/олл-?ин|пуш|all-?in/.test(q)) return 'ai';
  if (/винрейт|winrate|выигр|bb\/100|бб\/100|результат|профит/.test(q)) return /позиц/.test(q) ? 'wrpos' : 'wr';
  if (/ривер/.test(q)) return 'river';
  return 'card';
}
function findPlayer(q, ctx) {
  const ql = q.toLowerCase();
  // «я / мой / мою / моей / моих / свою / себя / алиас …» — все формы: «покажи мою статистику», «мои 3-беты», «про себя»
  // «я / мне / меня» не считаем: «я хочу узнать RFI его…» — про другого игрока
  const ali = /(^|[^a-zа-яё])(мой|моя|мою|моё|мое|мои|моих|моим|моими|моей|моего|моему|моём|моем|себя|собой|свой|своя|свою|своё|свое|свои|своих|своей|своего|алиас|алиаса)([^a-zа-яё]|$)/.test(ql);
  if (ali) { const rm = /winamax|винамакс|гг|gg|wpn|впн|stars|старс|покерстарс/.exec(ql); const k = rm ? ({ winamax: 'wnmx', 'винамакс': 'wnmx', 'гг': 'gg', gg: 'gg', wpn: 'wpn', 'впн': 'wpn', stars: 'ps', 'старс': 'ps', 'покерстарс': 'ps' })[rm[0]] : 'все'; const r = qKey.get('alias:' + k) || qKey.get('alias:все'); return r ? { rows: [r] } : { none: true }; }
  // ник: вся фраза, отдельные слова, пары слов (с пробелом и слитно — голос рвёт ники)
  const raw = q.trim().replace(/[.,!?]+$/, ''), toks = raw.split(/\s+/).filter(Boolean);
  // сначала — длинные варианты (голос рвёт ники на слова: «bluf to much» → BlufToMuch / Bluf_To_Much / Bluf To Much),
  // потом короче; одиночное слово — от 3 знаков и не служебное
  const cands = [];
  const joins = (a) => [a.join(' '), a.join(''), a.join('_'), a.join('-'), a.join('.')];
  for (let len = Math.min(4, toks.length); len >= 2; len--) for (let i = 0; i + len <= toks.length; i++) { const seg = toks.slice(i, i + len); if (seg.some(t => STOP.has(t.toLowerCase()))) continue; cands.push(...joins(seg)); }
  cands.unshift(raw);
  for (const t of toks) if (t.length >= 3 && !STOP.has(t.toLowerCase())) cands.push(t);
  for (const c of cands) { const lc = c.toLowerCase(); if (!lc || STOP.has(lc)) continue; const rows = qLc.all(lc); if (rows.length) return { rows }; }
  if (ctx) { const r = qKey.get(ctx); if (r) return { rows: [r], ctx: true }; }
  return { none: true };
}

function answer(q, ctx, key) {
  q = wordsToNum(String(q || '').trim()); const ql = q.toLowerCase();
  if (key) { const r = qKey.get(key); if (r) { const P0 = load(r); return Object.assign(answerFor(P0, ql, 'card', [r]), { heard: q }); } }
  if (!q) return { blocks: [{ type: 'text', text: 'Напишите или скажите ник игрока. Например: «покажи FFtonny» или «мой алиас», потом «его 3-беты по позициям».' }] };
  const intent = intentOf(ql);
  const f = findPlayer(q, ctx);
  if (f.none) return { blocks: [{ type: 'text', text: 'Игрока не нашёл.' }] }; // похожие ники не показываем (владелец, 23.11.2026)
  return Object.assign(answerFor(load(f.rows[0]), ql, intent, f.rows), { heard: q, ctxUsed: !!f.ctx });
}
function answerFor(P, ql, intent, rows0) {
  const others = rows0.slice(1).map(r => ({ label: r.nick + ' · ' + (ROOM_RU[r.room] || r.room) + ' · ' + r.n.toLocaleString('ru') + ' рук', key: r.key }));
  const blocks = [];
  const bands0 = bandsOf(ql), bands = bands0 || BANDS, byBand = /по ст[еэ]к|ст[еэ]кам|ст[еэ]ков|разбив|сайз/.test(ql) && !(bands0 && bands0.num != null);
  const bnote = bands0 ? 'стек ' + (bands0.length > 1 ? bands0[0] + ' … ' + bands0[bands0.length - 1] : bands0[0]) + ' bb' : 'все стеки';
  if (intent === 'card') blocks.push(card(P));
  else if (intent === 'wr') { const c = card(P); blocks.push({ type: 'card', title: c.title, sub: c.sub, group: c.group, wr: c.wr, wrFmt: c.wrFmt, graph: c.graph }); }
  else if (intent === 'wrpos') {
    if (!P.ext || !P.ext.pos) blocks.push({ type: 'text', title: title(P), text: 'Винрейт по позициям пока посчитан только для вашего алиаса (по вашим раздачам). Для игроков базы он появится после следующего прохода по базе.' });
    else {
      const f1 = (v) => (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',');
      const rows = [], T = [0, 0, 0];
      for (const p of ['BB', 'SB', 'BTN', 'CO', 'MP', 'UTG']) { const x = P.ext.pos[p]; if (!x) continue; T[0] += x[0]; T[1] += x[1]; T[2] += x[2]; rows.push([p, String(x[0]), f1(x[1] / x[0] * 100), f1(x[2] / x[0] * 100)]); }
      rows.push(['ИТОГ', String(T[0]), f1(T[1] / T[0] * 100), f1(T[2] / T[0] * 100)]);
      blocks.push({ type: 'table', title: title(P) + ' — винрейт по позициям', note: 'позиции как в Hand2Note (UTG — только при полном столе); «реально» — как «бб/100» в Hand2Note; «с поправкой» — олл-ины по эквити (у Hand2Note своя формула EV, цифры могут отличаться)' + (P.ext.dup ? '; дубли раздач убраны: ' + P.ext.dup : ''), table: { head: ['позиция', 'руки', 'бб/100 реально', 'бб/100 с поправкой'], rows, signed: true } });
    }
  }
  else if (intent === 'river') { const c = card(P); blocks.push({ type: 'card', title: title(P) + ' — ривер (один на один)', stats: c.stats.filter(r => r.label && /river/i.test(r.label)) }); }
  else if (intent === 'postflop') blocks.push({ type: 'text', title: title(P), text: 'Постфлоп-статы (c-bet, донк, чек-рейз, флоп / тёрн) ещё не посчитаны — это следующий этап: сначала отрабатываем на ваших раздачах, потом один проход по всей базе. Сейчас есть только ривер один на один — скажите «ривер».' });
  else if (intent === 'rfi') {
    // один стат — одна цифра; «по стекам» / «по позициям» / без позиции — таблица (владелец, 23.11.2026)
    const S = rfiSrc(P), pos = posOf(ql), total = /общ|в целом|всего|итог|tot/.test(ql);
    const stackTxt = bands0 ? (bands0.num != null ? 'стек ' + String(bands0.num).replace('.', ',') + ' bb (в диапазоне ' + bands0[0] + ' bb)' : bnote) : 'все стеки';
    const posNote = S.h2n ? '' : ' · у игроков базы позиции пока крупнее (EP — все ранние, MP — HJ и место перед ним); как в Hand2Note — после пересчёта';
    const p1 = pos === 'SB' ? 'SB' : pos || (total ? 'TOT' : null);
    if (p1 && !byBand) {
      const x = S.get(p1, bands);
      blocks.push({ type: 'big', title: title(P) + ' — RFI ' + (p1 === 'TOT' ? 'общий' : 'с ' + p1), big: x.n ? pctS(x.tot, x.n) : 'нет данных', n: x.n, note: stackTxt + (x.n ? ' · без олл-инов ' + pctS(x.nai, x.n) : '') + posNote });
    } else if (p1) {
      const T = { head: ['стек', 'RFI', 'NAI'], rows: [], grid: true };
      for (const b of bands) { const x = S.get(p1, [b]); if (x.n) T.rows.push([b + ' bb', { v: pctS(x.tot, x.n), n: x.n }, { v: pctS(x.nai, x.n), n: x.n }]); }
      blocks.push({ type: 'table', title: title(P) + ' — RFI ' + (p1 === 'TOT' ? 'общий' : 'с ' + p1) + ' по стекам', note: 'NAI — без олл-инов' + posNote, table: T });
    } else blocks.push({ type: 'table', title: title(P) + ' — RFI по позициям', note: stackTxt + (byBand ? ' · по стекам, с олл-инами' : ' · NAI — без олл-инов') + posNote, table: rfiGrid(P, bands, byBand && !(bands0 && bands0.length === 1)) });
  }  else {
    const t = famTable(P, intent, bands, byBand);
    blocks.push({ type: 'table', title: title(P) + ' — ' + FAM_T[intent], note: bnote + (intent === 'vso' ? ' · BTN, CO, HJ пока одной группой (разделим при следующем пересчёте)' : ''), table: t });
    if (!t.rows.length) blocks.push({ type: 'text', text: 'В этой ситуации у игрока нет раздач' + (bands0 ? ' при таком стеке' : '') + '.' });
  }
  return { key: P.key, player: title(P), group: P.cl != null ? CLU.GROUP[P.cl] : null, intent, blocks, sugg: others };
}

// ---------- сервер ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/ask') {
    const t0 = Date.now(); let out;
    try { out = answer(u.searchParams.get('q'), u.searchParams.get('ctx'), u.searchParams.get('key')); } catch (e) { out = { blocks: [{ type: 'text', text: 'Ошибка: ' + e.message }] }; }
    out.ms = Date.now() - t0;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(out));
  }
  if (u.pathname === '/api/suggest') {
    const p = String(u.searchParams.get('p') || '').trim().toLowerCase();
    const rows = p.length >= 2 ? qPrefix.all(p, p + '￿').filter(r => r.room !== 'alias') : [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(rows.map(r => ({ key: r.key, nick: r.nick, room: ROOM_RU[r.room] || r.room, n: r.n, group: r.cl != null ? CLU.GROUP[r.cl] : null }))));
  }
  if (u.pathname === '/api/meta') { const m = Object.fromEntries(db.prepare('SELECT k, v FROM meta').all().map(r => [r.k, r.v])); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(m)); }
  const f = path.join(__dirname, 'ui', u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!f.startsWith(path.join(__dirname, 'ui')) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
srv.on('error', (e) => { if (e.code === 'EADDRINUSE') { console.log('TG-бот уже запущен на порту ' + PORT); process.exit(0); } throw e; });
srv.listen(PORT, '127.0.0.1', () => console.log('TG-бот: http://127.0.0.1:' + PORT));
module.exports = { answer };
