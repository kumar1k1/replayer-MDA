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
  { const H = P.ext && P.ext.h3 && P.ext.h3.TOT; if (H) stats.push({ label: '3-бет NAI', v: f1(pct(H[1], H[0])) + '%', n: H[0] }); else add('3-бет NAI', clStat(P, '3BetNAI')); } // у алиаса — как Hand2Note
  { const F = P.ext && P.ext.f3 && P.ext.f3.TOT && P.ext.f3.TOT.all && P.ext.f3.TOT.all.all; if (F) stats.push({ label: 'Фолд на 3-бет', v: f1(pct(F[1], F[0])) + '%', n: F[0] }); else add('Фолд на 3-бет', clStat(P, 'F3Bet')); }
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
const pctS = (x, n) => n ? String(pct(x, n)).replace('.', ',') + '%' : '—';
function famTable(P, fam, bands, byBand, G) {
  const F = LU.FAM[fam], acts = F.acts, RU = { open: 'опен', limp: 'лимп', shove: 'олл-ин', call: 'колл', '3bet': '3-бет', raise: 'рейз', fold: 'фолд', '4bet': '4-бет', iso: 'изо' };
  // клетки — { v, n } как в таблице RFI (салатовые плашки, число раздач мелко); яркость — по каждой колонке (владелец, 24.11.2026)
  const head = [''].concat(acts.map(a => RU[a] || a)).concat(F.explicitFold ? [] : ['фолд']);
  const rowsOf = (label, slots) => {
    let n = 0; const x = acts.map(() => 0);
    for (const o of slots) { n += P.pf[o]; acts.forEach((_, k) => { x[k] += P.pf[o + 1 + k]; }); }
    const cells = x.map(v => ({ v: pctS(v, n), n }));
    if (!F.explicitFold) cells.push({ v: pctS(n - x.reduce((a, b) => a + b, 0), n), n });
    return [label].concat(cells);
  };
  const rows = [];
  if (G) { // группы стеков из запроса
    const L = fam === 'rfi' ? POSN.rfi.map(p => [p, p]) : fam === 'vso' ? POSN.vso : null;
    for (const [gl, bs] of G) { if (L) for (const [p, lab] of L) rows.push(rowsOf(gl + ' · ' + lab, bs.map(b => LU.slotOf(fam, b, p)))); else rows.push(rowsOf(gl, bs.map(b => LU.slotOf(fam, b, '')))); }
  } else if (fam === 'rfi' || fam === 'vso') {
    const L = fam === 'rfi' ? POSN.rfi.map(p => [p, p]) : POSN.vso;
    if (byBand) for (const b of bands) for (const [p, lab] of L) rows.push(rowsOf(b + ' · ' + lab, [LU.slotOf(fam, b, p)]));
    else for (const [p, lab] of L) rows.push(rowsOf(lab, bands.map(b => LU.slotOf(fam, b, p))));
  } else for (const b of bands) rows.push(rowsOf(b + ' bb', [LU.slotOf(fam, b, '')]));
  return { head, rows: rows.filter(r => r[1].n), grid: true, heatCol: true };
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
function rfiGrid(P, bands, byBand) {
  const S = rfiSrc(P), head = ['', 'TOT', ...S.cols], rows = [];
  const row = (lab, bs, k) => [lab, ...['TOT', ...S.cols].map(p => { const x = S.get(p, bs); return { v: pctS(x[k], x.n), n: x.n, hm: HMref(P, 'rfi|' + p, k, bs) }; })];
  if (!byBand) { rows.push(row('RFI', bands, 'tot')); rows.push(row('NAI', bands, 'nai')); }
  else for (const b of bands) { const r = row(b + ' bb', [b], 'nai'); if (r[1].n) { rows.push(r); } } // по стекам — без олл-инов, как таблица Hand2Note (сверено 23.11)
  return { head, rows, grid: true };
}const FAM_T = { rfi: 'Первым в банк (опен / лимп / олл-ин) по позициям', vso: 'Против опена: колл / 3-бет / олл-ин по позициям', vs3: 'После своего опена против 3-бета', sqz: 'Сквиз (опен и колл перед ним)', iso: 'Против лимперов: изо / овер-лимп', ai: 'Против олл-ина: колл' };

// ---------- разбор фразы ----------
const STOP = new Set('покажи показать покажите дай выведи найди игрок игрока ник ника стат статы статистика статистику его её ее он она по на в и с у а о об мне про какой какая какие как часто сколько это этот того этого позициям позиции позиций стекам стеку стек стеки бб bb до от против опен опены опена открытия открытие 3бет 3-бет 3-беты 3бета 3-бета трибет трибеты 4бет 4-бет фолд колл коллы сквиз изо лимп лимпы олл-ин олл ин пуш пуши винрейт ривер ривера ставка ставки ставку размер размеры игроку человек человека я мне меня хочу хотел хотела бы узнать скажи посмотреть посмотри из для при стека стеке стеком стэк блайнд блайнда блайндов больших баттон баттона баттоне кнопки катоффа позиции rfi рфи vpip впип pfr пфр wtsd втсд wwsf ввсф w$sd wssd вссд wsd шоудаун шоудауне вскрытии лимп квадрат фиата фиат bet fold river на ривере ривер хайджека хайджек катоф ранней поздней мой мою моя мои'.split(' '));
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
  ['BTN', /батт?[оа]н|кнопк|button|дилер/, W('btn|бтн|бт|бу|bu')],
  ['CO', /катоф|кат оф|cut\s*off|cutoff/, W('co|ко|со|си о|си-о')],
  ['SB', /мал[а-яё]* блайнд|смол|small\s*blind/, W('sb|сб|эс би|эсби')],
  ['HJ', /хайдж|хай дж|хайж|hi\s*jack|хиджек/, W('hj|хдж|эйч джей')],
  ['MP', /мидл|middle|средн[\wа-яё]*\s*позиц|позиц[\wа-яё]*\s*средн/, W('mp|мп|эм пи')],
  ['EP', /ранн|андер|under\s*the\s*gun|early/, W('ep|еп|utg|ютг|ю ти джи')],
];
// BB как позиция: «бб / bb / би би / большой блайнд» без числа перед ним («60 бб» — стек)
const BB_POS = /(?<![\d.,]\s?)(?<![\d.,])(?<![a-zа-яё0-9])(bb|бб|би\s*би)(?![a-zа-яё0-9])|(?<![\d.,]\s?)больш[а-яё]*\s*блайнд|big\s*blind/;
function posOf(q) { for (const [p, a, b] of POS_RE) if (a.test(q) || b.test(q)) return p; return BB_POS.test(q) ? 'BB' : null; }
const bandOfNum = (v) => { let k = 0; const E = [12, 20, 36, 60, 100, 150]; while (k < E.length && v >= E[k]) k++; return BANDS[k]; };
function bandsOf(q) {
  const s = q.replace(',', '.');
  // один стек числом: «стек 42 блайнда», «42 бб», «на 42 больших», «стеком 42»
  const one1 = /(?:стек[\wа-яё]*|стэк[\wа-яё]*|глубин[\wа-яё]*)\s*(?:в\s*)?(\d{1,3}(?:\.\d+)?)/.exec(s) || /(\d{1,3}(?:\.\d+)?)\s*(?:бб|bb|б\.б|блайнд|больш|биг)/.exec(s);
  if (one1 && !/(\d+)\s*(?:-|–)\s*\d+/.test(s) && !/до\s*\d/.test(s)) return Object.assign([bandOfNum(+one1[1])], { num: +one1[1] });
  if (/коротк|(маленьк|мелк)[а-яё]*\s*ст[еэ]к/.test(s)) return ['<12', '12-19'];
  if (/глубок/.test(s)) return ['60-99', '100-149', '150+'];
  const m = /(\d+)\s*(?:-|–|до|\s)\s*(\d+)\s*(?:бб|bb|б\.б|больш)/.exec(s) || /(?:от\s*)?(\d+)\s*(?:-|–)\s*(\d+)/.exec(s);
  const one = /до\s*(\d+)\s*(?:бб|bb|больш)?/.exec(s);
  const idx = (v) => { let k = 0; const E = [12, 20, 36, 60, 100, 150]; while (k < E.length && v >= E[k]) k++; return k; };
  if (m) { const a = idx(+m[1]), b = idx(Math.max(+m[1], +m[2] - 0.01)); return BANDS.slice(a, b + 1); }
  if (one) return BANDS.slice(0, idx(+one[1] - 0.01) + 1);
  return null;
}
// ---------- таблица под запрос (владелец, 24.11.2026): строки — названные группы стеков, колонки — названные позиции ----------
// стеки в базе копятся диапазонами BANDS; группа «от … до …» берёт диапазоны, чья середина внутри неё, подпись — реальные границы
const BANDR = { '<12': [0, 12], '12-19': [12, 20], '20-35': [20, 36], '36-59': [36, 60], '60-99': [60, 100], '100-149': [100, 150], '150+': [150, Infinity] };
// диапазон стеков берём, если он хотя бы наполовину внутри названного интервала (40–80 → 36–59 и 60–99)
const bandsIn = (lo, hi) => BANDS.filter(b => { const [a, z0] = BANDR[b], z = z0 === Infinity ? 200 : z0, L = lo == null ? 0 : lo, H = hi == null ? Infinity : hi; const ov = Math.min(z, H) - Math.max(a, L); return ov > 0 && ov / (z - a) >= 0.5; });
// Whisper иногда повторяет фразу дважды — убираем повтор
/* частые ошибки распознавания голоса (26.11.2026): «ривень / ривел / ривэр» → ривер, «размером в под» → в пот, «тэрн» → тёрн */
const voiceFix = (q) => String(q || '').replace(/(^|[^а-яё])(крутим|крутив|протев|против[ао])(?=\s+(больш[а-яё]*\s*блайнд|бб|bb))/gi, '$1против') /* «крутим большого блайнда» — так Whisper слышит «против» (журнал 27.11.2026) */.replace(/(^|[^а-яё])рив[еэ](н|л)[ьяеюи]?(?![а-яё])/gi, '$1ривер').replace(/(^|[^а-яё])рив[еэ]р(а|е|у|ом)?(?![а-яё])/gi, (m, a, b) => a + 'ривер' + (b || '')).replace(/(^|[^а-яё])т[эе]рн/gi, '$1тёрн').replace(/(размер[а-яё]*\s*(в\s*)?)под(?![а-яё])/gi, '$1пот').replace(/(ставк[а-яё]*|б[еэ]т[а-яё]*)\s+в\s+под(?![а-яё])/gi, '$1 в пот')
  .replace(/шоу?\s*-?\s*д[ао]?у?н[а-яё]*/gi, 'шоудауне').replace(/(^|[^а-яё])мультиве(?![а-яё])/gi, '$1мультивее').replace(/(^|[^а-яё])мойц\s*бет/gi, '$1мой цбет').replace(/бетфолд/gi, 'бет-фолд').replace(/бетколл?/gi, 'бет-колл').replace(/(^|[^а-яё])(ботана|баттана|батона)(?![а-яё])/gi, '$1баттона')
  .replace(/без\s*-?\s*ол\s*-?\s*л?ин[а-яё]*|безол+ын[а-яё]*|без\s*ул+ын[а-яё]*/gi, 'без олл-инов').replace(/(^|[^а-яё])лимбы(?![а-яё])/gi, '$1лимпы').replace(/(^|[^а-яё])на\s*т[еёэ]рни(?![а-яё])|(^|[^а-яё])нат[еёэ]рни(?![а-яё])/gi, ' на тёрне').replace(/(^|[^а-яё])реизер/gi, '$1рейзер')
  .replace(/(на|против)\s+рейс(?![а-яё])/gi, '$1 рейз').replace(/(4\s*-?\s*бет[а-яё]*|четыр[её]х\s*-?\s*бет[а-яё]*)\s+холодн/gi, '$1 в холодн'); /* остальные частые искажения голоса (26.11.2026) */
/* автоисправление похожих слов (26.11.2026): незнакомое слово, очень похожее на покерный термин по написанию и звучанию, заменяем на термин —
   для любого человека и любого нового искажения голоса. Знакомые слова (из всех проверок, tgbot/vocab.json) не трогаем. */
const VOCAB = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'vocab.json'), 'utf8')); } catch (e) { return { words: [], catalog: [] }; } })();
const KNOWN = new Set(VOCAB.words);
const TERMS = ('потбет ривер ривера ривере ривером тёрн тёрна тёрне флоп флопа флопе конбет конбеты конбета конбетов конбетом цбет цбеты цбета цбетов мультивей мультивее мультивея мультивеях мультипот мультипоте ' +
  'баттон баттона баттоне катофф катоффа хайджек хайджека блайнд блайнда блайндов лимп лимпы лимпа лимпов сквиз сквизы сквиза сквизов изолейт изолейты изолейта изолейтов шоудаун шоудауне шоудауна ' +
  'рейзер рейзера рейзером рейзеры коллер коллера коллером коллеры рейз рейза рейзы рейзов рейзами рейзах рейзом колл колла коллы коллов фолд фолда фолды фолдов овербет подбет отложка отложки отложку отложками отложках отложенный отложенные пропуск сайзинг сайзинги сайзингов винрейт дилей вскрытие вскрытии позиции позиция').split(' ');
const skel = (w) => w.toLowerCase().replace(/[ёэ]/g, 'е').replace(/о/g, 'а').replace(/[ъь-]/g, '').replace(/й/g, 'и').replace(/(.)\1+/g, '$1');
const TSK = TERMS.map(t => [skel(t), t]);
const lev1 = (a, b) => { if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, e = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } } return e + (a.length - i) + (b.length - j) <= 1; };
function fuzzyFix(q) {
  return String(q).replace(/[а-яё][а-яё-]{3,}/gi, (w) => { const l = w.toLowerCase(); if (KNOWN.has(l) || TERMS.includes(l.replace(/ё/g, 'е')) || TERMS.includes(l)) return w;
    const s = skel(l), ex = TSK.filter(([k]) => k === s); if (ex.length) return ex[0][1];
    if (s.length >= 6) { const near = TSK.filter(([k]) => lev1(k, s)); if (near.length && new Set(near.map(x => x[1])).size === 1) return near[0][1]; }
    return w; });
}
/* кнопки «Может, вы имели в виду…» — самые похожие вопросы из каталога */
function suggestQs(q, n) {
  const toks = (t) => String(t).toLowerCase().split(/[^а-яёa-z0-9$]+/).filter(w => w.length >= 3 && !/^(мой|мои|моя|мне|как|что|для|это|покажи|часто)$/.test(w)).map(skel);
  const qt = toks(q); if (!qt.length) return [];
  const sc = VOCAB.catalog.map(c => { const ct = toks(c); let s = 0; for (const t of qt) { if (ct.includes(t)) s += 1; else if (t.length >= 5 && ct.some(x => lev1(x, t) || (x.length >= 5 && (x.startsWith(t.slice(0, 5)) || t.startsWith(x.slice(0, 5)))))) s += 0.6; } return [s / Math.sqrt(ct.length + 1), c]; });
  return sc.filter(x => x[0] > 0).sort((a, b) => b[0] - a[0] || a[1].length - b[1].length).slice(0, n || 3).map(x => x[1]);
}
const dedupPhrase = (q) => { const p = String(q || '').split(/(?<=[.!?])\s+/); const out = p.filter((x, i) => i === 0 || x.trim().toLowerCase() !== p[i - 1].trim().toLowerCase()); return out.join(' '); };
const grpLabel = (name, bs) => { const a = BANDR[bs[0]][0], z = BANDR[bs[bs.length - 1]][1]; const r = a === 0 ? 'до ' + z + ' bb' : z === Infinity ? a + '+ bb' : a + '–' + (z - 1) + ' bb'; return name ? name + ' (' + r + ')' : r; };
const SG = { short: ['короткие', 0, 20], mid: ['средние', 20, 60], deep: ['большие', 60, null] };
function groupsRule(ql) {
  const q = ql.replace(/больш[\wа-яё]*\s*блайнд[\wа-яё]*|\d+\s*больш[\wа-яё]*/g, ' ').replace(new RegExp(SMALL_RE.source, 'g'), (m0) => (/ст[еэ]к/.test(m0) ? m0 : ' ')); /* «мелкая ставка» — размер, не стек (27.11.2026) */
  const sup = /(супер|очень|сверх)\s*-?\s*(больш|глубок)/.test(q), q2 = q.replace(/(супер|очень|сверх)\s*-?\s*(больш|глубок)[\wа-яё]*/g, ' ');
  const k = /коротк|мелк/.test(q), m = /средн[\wа-яё]*(?!\s*позиц)/.test(q) && /ст[еэ]к|коротк|мелк|больш|глубок|сайз/.test(q), d = /больш|глубок|длинн/.test(q2);
  if (sup && (k + m + d) >= 1) return [k && SG.short, m && SG.mid, d && ['большие', 60, 100], ['супер большие', 100, null]].filter(Boolean).map(([n, lo, hi]) => { const bs = bandsIn(lo, hi); return [grpLabel(n, bs), bs]; });
  if ((k + m + d) < 2 && !((k || m || d) && /тип[\wа-яё]*|групп[\wа-яё]*|ст[еэ]к|сайз/.test(q))) return null; // одна группа со словом «стек» — фильтр
  return [k && SG.short, m && SG.mid, d && SG.deep].filter(Boolean).map(([n, lo, hi]) => { const bs = bandsIn(lo, hi); return [grpLabel(n, bs), bs]; });
}
// позиции, названные во фразе (несколько)
// группы позиций: ранние — EP; средние — MP, HJ; поздние — CO, BTN; блайнды — SB (владелец, 24.11.2026)
function posListRule(ql) { const out = []; for (const [p, a, b] of POS_RE) if (a.test(ql) || b.test(ql)) out.push(p);
  if (/средн[\wа-яё]*\s*позиц|позиц[\wа-яё]*\s*средн/.test(ql)) out.push('MP', 'HJ'); if (/поздн[\wа-яё]*\s*позиц|позиц[\wа-яё]*\s*поздн|поздн[\wа-яё]*\s*мест/.test(ql)) out.push('CO', 'BTN'); if (/ранн[\wа-яё]*\s*позиц|позиц[\wа-яё]*\s*ранн/.test(ql)) out.push('EP'); if (/блайнд[\wа-яё]*\s*позиц|из\s*блайнд/.test(ql)) out.push('SB'); return ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'].filter(p => out.includes(p)); }
// описание таблицы от Claude: { stack_groups: [{name, from, to}], positions: [...] }
function specFromBrain(o) {
  if (!o) return null; const sp = {};
  if (Array.isArray(o.stack_groups) && o.stack_groups.length) sp.groups = o.stack_groups.map(g => { const bs = bandsIn(g.from, g.to); return bs.length ? [grpLabel(g.name || '', bs), bs] : null; }).filter(Boolean);
  if (Array.isArray(o.positions) && o.positions.length > 1) sp.pos = ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'].filter(p => o.positions.includes(p));
  return sp.groups || sp.pos ? sp : null;
}function intentOf(q) {
  if (CB_RE.test(q) || isTCB(q) || isTLN(q) || BSK_RE.test(q) || mwRoute(q) || (MW_Q.test(q) && MWL_W.test(q))) return 'stat'; if (/выигр[а-яё]*\s*(на\s*)?(шоу?\s*-?\s*даун|вскрыти)|w\s*\$\s*sd|вин\s*доллар/.test(q)) return 'stat'; /* «выигрыш на шоудауне общий» — W$SD, не винрейт (26.11.2026) */ if (/донк|c-?bet|кбет|конт|си-?бет|чек-?рейз|чекрейз|флоп|т[её]рн|проб|флоат|барр?ел/.test(q)) return 'postflop';
  if (/сквиз|squeeze/.test(q)) return 'sqz';
  if (/(?<![а-яё])(фолд|ответ|против|на)\s*(на\s*)?(3|три|тр[её]х)\s*-?\s*бет|4\s*-?\s*бет|четыр[её]х?бет|vs\s*3/.test(q)) return 'vs3';
  if (/3\s*-?\s*бет|трибет|тр[её]хбет|3bet|защит|против опен|колл опен|на опен/.test(q)) return 'vso';
  if (/опен|открыт|первым|rfi|рфи|эр\s*эф|стил/.test(q)) return 'rfi';
  if (/изо|лимп|limp|iso/.test(q)) return 'iso';
  if (/олл-?ин|пуш|all-?in/.test(q)) return 'ai';
  if (/винрейт|winrate|выигр|bb\/100|бб\/100|результат|профит/.test(q)) return /позиц/.test(q) ? 'wrpos' : 'wr';
  if (/ривер/.test(q)) return 'river';
  return 'card';
}
// «своё»: явные слова о себе — мой / моя / мою / мои / свою / алиас / у меня / про меня («покажи мне …» — НЕ о себе)
const isOwn = (ql) => /(^|[^a-zа-яё])(мой|моя|мою|моё|мое|мои|моих|моим|моими|моей|моего|моему|моём|моем|себя|собой|свой|своя|свою|своё|свое|свои|своих|своей|своего|алиас|алиаса)([^a-zа-яё]|$)/.test(ql) || /(^|[^a-zа-яё])(у|для|про|обо?)\s+(меня|мне)([^a-zа-яё]|$)/.test(ql);
function aliasRow(ql) { const rm = /winamax|винамакс|гг|gg|wpn|впн|stars|старс|покерстарс/.exec(ql); const k = rm ? ({ winamax: 'wnmx', 'винамакс': 'wnmx', 'гг': 'gg', gg: 'gg', wpn: 'wpn', 'впн': 'wpn', stars: 'ps', 'старс': 'ps', 'покерстарс': 'ps' })[rm[0]] : 'все'; return qKey.get('alias:' + k) || qKey.get('alias:все'); }
function findPlayer(q, ctx) {
  const ql = q.toLowerCase();
  // «я / мой / мою / моей / моих / свою / себя / алиас …» — все формы: «покажи мою статистику», «мои 3-беты», «про себя»
  // «я / мне / меня» не считаем: «я хочу узнать RFI его…» — про другого игрока
  const ali = /(^|[^a-zа-яё])(мой|моя|мою|моё|мое|мои|моих|моим|моими|моей|моего|моему|моём|моем|себя|собой|свой|своя|свою|своё|свое|свои|своих|своей|своего|алиас|алиаса)([^a-zа-яё]|$)/.test(ql) || /(^|[^a-zа-яё])(у|для|про|обо?)\s+(меня|мне)([^a-zа-яё]|$)/.test(ql);
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

// ---------- один стат — одна цифра (владелец, 23.11.2026): «покажи мой WWSF», «его VPIP», «фолд на 3-бет» ----------
// таблица — только когда просят таблицу / «по позициям» / «по стекам». Слова — как пишет и как слышит голос.
const STATS = [
  // «колд-колл третьим / четвёртым / 3 / 4» — тоже колл третьим в банк (так говорит владелец); «3 бб» — стек
  ['OC', /(колд|cold|кол[дл]?)[\s-]*кол[а-яё]*\s*(трет|четв[её]рт|[34](?![\s,.]*(бб|bb|б\.б|больш|блайнд|[0-9.,])))|трет[а-яё]*\s*(в\s*)?банк|четв[её]рт[а-яё]*\s*(в\s*)?банк|(колл?[а-яё]*|кол[а-яё]*|заход[а-яё]*)\s*(трет|четв[её]рт)|(трет|четв[её]рт)[а-яё]*\s*(колл?|кол|заход)|оверколл|овер-?\s*колл|overcall|колл?[а-яё]*\s*(после|за)\s*колл?ер/],
  ['CC', /колд|cold|в\s*холодн|холодн[а-яё]*\s*кол|(^|[^а-яё])кол{1,2}[а-яё]*\s*(опен|рейз|против\s*(одного\s*|1\s*)?(опен|рейз))/],
  ['FRB', /фолд[\wа-яё]*\s*(на|против)\s*(бет[\wа-яё]*|ставк[\wа-яё]*)\s*(на\s*)?ривер|fold\s*to\s*(bet\s*)?river|сброс[\wа-яё]*\s*на\s*ривер/],
  ['BR', /бет\s*ривер|бет[\wа-яё]*\s*на\s*ривер|bet\s*river|став[\wа-яё]*\s*на\s*ривер/],
  ['F3', /фолд[\wа-яё]*\s*(на|против)\s*(3|три|тр[её]х)\s*-?\s*бет|fold\s*to\s*3|ф3б/],
  ['WWSF', /wwsf|ввсф|в\s*в\s*с\s*ф|вэ\s*вэ\s*эс\s*эф|ввсэф|дабл[\wа-яё]*\s*дабл[\wа-яё]*|выигр[\wа-яё]*\s*(когда|после|если)\s*(увид[\wа-яё]*\s*)?флоп|won\s*when\s*saw/],
  ['WSD', /w\s*\$\s*sd|wssd|w\$sd|в\s*\$\s*сд|в\s*доллар[\wа-яё]*\s*с\s*д|вссд|в\s*с\s*с\s*д|вдсд|вин\s*доллар|w\s*money|выигр[\wа-яё]*\s*на\s*(шоу\s*даун[\wа-яё]*|вскрыти[\wа-яё]*)|won\s*at\s*showdown/],
  ['WTSD', /wtsd|втсд|в\s*т\s*с\s*д|вэ\s*тэ\s*эс\s*дэ|went\s*to\s*show|доход[\wа-яё]*\s*до\s*(шоу\s*даун[\wа-яё]*|вскрыти[\wа-яё]*)|ход[\wа-яё]*\s*на\s*(шоу\s*даун|вскрыти)|шоу\s*даун|шоудаун|вскрыти/],
  ['VPIPPFR', /(vpip|впип|в\s*п\s*и\s*п|випип).{0,12}(pfr|пфр|п\s*ф\s*р)/],
  ['VPIP', /vpip|впип|в\s*п\s*и\s*п|вэ\s*пэ\s*ай\s*пи|ви\s*пи\s*ай\s*пи|випиай|випип|вип\b/],
  ['PFR', /pfr|пфр|п\s*ф\s*р|пэ\s*эф\s*эр|пи\s*эф\s*ар|префлоп[\wа-яё]*\s*рейз/],
  ['3B', /(3|три|тр[её]х)\s*-?\s*бет|трибет|3bet|три\s*бэт/],
  ['LIMP', /лимп|limp/],
  ['SQ', /квадрат|фиат/],
];
const NO_STAT = /rfi|опен|открыт|первым|стил|сквиз|изо|изол|iso|против\s*(опен|лимп|олл)|колл\s*опен|на\s*опен|винрейт|winrate|выигрыш|профит|bb\/100|бб\/100/;
/* мультивей: ставки — всегда с ролью (владелец 26.11.2026): как рейзер — конбеты, как коллер — ставка на пропуск; роль не названа — оба ответа */
const MW_Q = /мульти|мульт[иы]\s*-?\s*пот|мультик|multi/, BET_W = /б[еэ]т|bet|ставк|ставок|ставлю|ставил|отложк|овербет|подбет|потбет/, ROLE_R = /рейзер|открывш|открыл[а-яё]*\s*перв|(^|[^a-z])pfr([^a-z]|$)|префлоп[а-яё]*\s*агресс/, ROLE_C = /колл?ер|колер|коллиров|заколлир/;
function mwRoute(ql) { if (!MW_Q.test(ql) || !BET_W.test(ql) || /донк/.test(ql)) return null; const r = ROLE_R.test(ql), c = ROLE_C.test(ql.replace(/рейз[а-яё]*\s*(никто\s*)?(не\s*)?заколл[а-яё]*/g, ' ')); if (c && !r) return 'BSK'; if (r && !c) return 'CB'; if (CB_RE.test(ql)) return 'CB'; if (BSK_RE.test(ql)) return 'BSK'; return 'MWB'; }
/* Total CBET против BB: ход на чек-рейз без слова «конбет» («перерейзиваю чек-рейз на тёрне против бб») — тоже эта таблица (27.11.2026) */
function isTCB(ql) { return !MW_Q.test(ql) && (HU_BB.test(ql) || HU_W.test(ql)) && (CB_RE.test(ql) || /чек\s*-?\s*рейз|перерейз|(пере|ре)\s*-?\s*рейз/.test(ql)); }
function statOf(ql) { if (isTLN(ql)) return 'CB'; if (MW_Q.test(ql) && TLN_SEQ.test(ql)) return 'MWL'; /* линия в мультивее — пока скрыта, бот так и говорит (27.11.2026) */ /* линии рейзера против BB — к таблице конбетов против BB (27.11.2026) */ if (MW_Q.test(ql) && MWL_W.test(ql)) { if (!/лини/.test(ql) && /конбет|цбет|комбет|контбет|c-?bet|(^|[^a-z])cb(?![a-z])|отлож|дил[еэ]й|(\+|плюс)\s*б[еэ]т/.test(ql)) return 'CB'; if (!/лини/.test(ql) && BSK_RE.test(ql)) return 'BSK'; return 'MWL'; } /* «успешность конбета / ставки в пропуск» — их таблица; иначе — линии и успешность всех ставок */ /* линии и успешность ставок в мультивее */ { const mr = mwRoute(ql); if (mr) return mr; } if (/выигр[а-яё]*\s*(на\s*)?(шоу?\s*-?\s*даун|вскрыти)/.test(ql) && !/\d\s*(%|процент)|овербет|подбет|маленьк|половин|трет|размер[а-яё]*\s*(в\s*)?(банк|пот)[а-яё]*|(в|на)\s*(весь\s*)?пот(?![а-яё])|пот\s*-?\s*сайз[а-яё]*/.test(ql) && !mwRoute(ql)) return 'WSD'; /* «выигрыш на шоудауне общий» (26.11.2026) */ if (BSK_RE.test(ql)) return 'BSK'; if (CB_RE.test(ql) || isTCB(ql)) return 'CB'; if (isBVS(ql)) return 'BVS'; if (FSQ_RE.test(ql)) return 'FSQ'; if (SQ_RE.test(ql)) return 'SQZ'; if (/фолд[а-яё]*\s*(на|против)\s*(3|три|тр[её]х)\s*-?\s*бет|fold\s*to\s*3/.test(ql)) return 'F3'; if (S3_RE.test(ql)) return 'S3'; if (F4_RE.test(ql)) return 'F4'; /* 5-бет не делаем (владелец, 24.11.2026) */ if (CC3_RE.test(ql) || COLD4_RE.test(ql)) return 'CC3'; if (B4_RE.test(ql)) return 'B4'; if (B3I_RE.test(ql)) return 'B3I'; if (NO_STAT.test(ql)) return null; for (const [id, re] of STATS) if (re.test(ql)) return id; return null; }
const TBL_W = /таблиц|матриц|разбив|разбивк|сетк|раскладк|сводк|разв[её]рн|подробн|детальн|целиком|полност|по\s*всем\s*(позиц|улиц|стек)/; /* как ещё просят таблицу (26.11.2026): матрица, разбивка, сетка, сводка, раскладка, подробно, развёрнуто, целиком */
const WANT_TABLE = /таблиц|по\s*позици|по\s*ст[еэ]к|ст[еэ]кам|разбив|таблиц|матриц|разбив|разбивк|сетк|раскладк|сводк|разв[её]рн|подробн|детальн|целиком|полност|по\s*всем\s*(позиц|улиц|стек)/;
const STAT_RU = { VPIP: 'VPIP', PFR: 'PFR', VPIPPFR: 'VPIP / PFR', '3B': '3-бет NAI', F3: 'Фолд на 3-бет', LIMP: 'Лимп (не SB)', WTSD: 'WTSD', WSD: 'W$SD', WWSF: 'WWSF', BR: 'Bet River', FRB: 'Fold to Bet River' };
const H3POS = ['MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
// ---------- ответы на опен по каждой позиции (алиас — ext.vso, по своим раздачам; у игроков базы — после пересчёта) ----------
// правило — как 3-бет NAI: против ровно одного опена без коллеров, опен не олл-ин, BB против SB не берём; стек — свой, без анте
const VPOS = ['MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const VACT = { call: ['колл', [1]], b3: ['3bet NAI', [2]], shove: ['олл-ин', [3]], fold: ['фолд', [0]], b3all: ['3bet', [2, 3]], b3ai: ['3bet AI', [3]] };
function vsoGet(P, pos, bs, totKey) { if (pos === 'TOT' && totKey) pos = totKey; const _ref = { P, p: 'vso|' + pos, bs }; let n = 0; const x = [0, 0, 0, 0]; for (const b of bs) { const r = P.ext.vso[pos] && P.ext.vso[pos][b]; if (r) { n += r[0]; x[1] += r[1]; x[2] += r[2]; x[3] += r[3]; } } x[0] = n - x[1] - x[2] - x[3]; return { n, x, _ref }; }
const VHM = { call: 'call', b3: 'b3', shove: 'ai', fold: 'fold', b3all: 'b3all', b3ai: 'ai' };
const vCell = (r, k) => ({ v: pctS(VACT[k][1].reduce((a, i) => a + r.x[i], 0), r.n), n: r.n, hm: r._ref ? HMref(r._ref.P, r._ref.p, VHM[k], r._ref.bs) : undefined });
const focusAct = (ql, dflt) => (/3\s*-?\s*бет|трибет|3bet/.test(ql) ? 'b3' : /колл|кол(?![а-яё])|уравн/.test(ql) ? 'call' : /олл|пуш|all/.test(ql) ? 'shove' : /фолд|сброс/.test(ql) ? 'fold' : dflt);
const vPosList = (PL) => (PL ? [...new Set(PL.map(p => (p === 'EP' ? 'MP' : p)))].filter(p => VPOS.includes(p)) : null);
VPOS.TOT = true;
const RS0 = (G, byBand) => !!(G || byBand);
// олл-ин в вопросе: «без олл-инов / без улынов / NAI» → nai; «только олл-ины / олл-ином / пуши / AI» → ai; иначе — всё (владелец, 24.11.2026)
const AIW = '(?:олл-?\s*ин|ол\s*ин|ул[ыи]н|all-?\s*in|пуш)';
function aiMode(ql) { if (new RegExp('(^|[^а-яё])(с|включая|вместе\\s*с|учитывая)\\s*' + AIW).test(ql) && !new RegExp('без\\s*' + AIW + '|только\\s*' + AIW).test(ql)) return 'all'; /* «с олл-инами» — вместе с ними (26.11.2026) */ if (new RegExp('без\\s*' + AIW + '|(^|[^a-zа-яё])(nai|наи|н\\s*а\\s*и)([^a-zа-яё]|$)').test(ql)) return 'nai'; if (new RegExp('только\\s*' + AIW + '|' + AIW + '[а-яё]*ом(?![а-яё])|' + AIW + '[а-яё]*ами|(^|[^a-zа-яё])(ai|аи)([^a-zа-яё]|$)|' + AIW).test(ql)) return 'ai'; return 'all'; }
function vsoBlocks(P, ql, o) {
  let { G, PL, bands, byBand, pos, focus } = o; const cols = vPosList(PL) || (pos ? [pos === 'EP' ? 'MP' : pos] : null); // pos 'TOT' — одна общая цифра
  const RS = G || (byBand ? bands.map(b => [b + ' bb', [b]]) : null), note = 'против одного опена без коллеров; стек — свой, без анте' + (!RS0(G, byBand) && bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '');
  // 3-бет: «всего» (с олл-ином), «без олл-ина», «олл-ином»; одна цифра — всего, в подписи — разбивка
  if (o.three) {
    focus = { nai: 'b3', ai: 'b3ai', all: 'b3all' }[aiMode(ql)];
    const C1 = cols || ['TOT', ...VPOS];
    if (C1.length === 1 && !RS) { const r = vsoGet(P, C1[0], bands); return [{ type: 'big', hm: vCell(r, focus).hm, title: title(P) + ' — ' + VACT[focus][0] + (C1[0] === 'TOT' ? '' : ' с ' + C1[0]), big: r.n ? vCell(r, focus).v : 'нет данных', n: r.n, note: (r.n && focus === 'b3all' ? 'NAI ' + vCell(r, 'b3').v + ' · AI ' + vCell(r, 'b3ai').v + ' · ' : '') + note }]; }
    if (!RS) { const LBL = { b3all: '3bet', b3: '3bet NAI', b3ai: '3bet AI' }; const rows = (focus === 'b3all' ? ['b3all', 'b3', 'b3ai'] : [focus]).map(k => [LBL[k], ...C1.map(p => vCell(vsoGet(P, p, bands), k))]); return [{ type: 'table', title: title(P) + ' — ' + (focus === 'b3all' ? '3bet' : VACT[focus][0]) + ' по позициям', note: 'NAI — без олл-ина, AI — олл-ином; ' + note + '; TOT — с BB против SB', table: { head: ['', ...C1], rows, grid: true, heatRow: true } }]; }
  }
  if (focus) { // одно действие: колонки — позиции, строки — стеки
    const C = cols || ['TOT', ...VPOS], name = VACT[focus][0];
    if (C.length === 1 && !RS) { const r = vsoGet(P, C[0], bands, o.totKey); return [{ type: 'big', hm: vCell(r, focus).hm, title: title(P) + ' — ' + name + ' против опена' + (C[0] === 'TOT' ? '' : ' с ' + C[0]), big: r.n ? vCell(r, focus).v : 'нет данных', n: r.n, note }]; }
    const rows = (RS || [[name, bands]]).map(([l, bs]) => [l, ...C.map(p => vCell(vsoGet(P, p, bs, o.totKey), focus))]).filter(r => r.slice(1).some(c => c.n));
    return [{ type: 'table', title: title(P) + ' — ' + name + (o.three ? '' : ' против опена') + (RS ? ' по стекам' : ' по позициям'), note, table: { head: ['', ...C], rows, grid: true } }];
  }
  // все действия: строки — позиции (и группы стеков), колонки — колл / 3-бет / олл-ин / фолд
  const A = ['call', 'b3', 'shove', 'fold'], C = cols || VPOS, rows = [];
  for (const [gl, bs] of RS || [['', bands]]) for (const p of C) { const r = vsoGet(P, p, bs); if (r.n) rows.push([(gl ? gl + ' · ' : '') + p, ...A.map(k => vCell(r, k))]); }
  return [{ type: 'table', title: title(P) + ' — против опена по позициям' + (RS ? ' и стекам' : ''), note, table: { head: ['', ...A.map(k => VACT[k][0])], rows, grid: true, heatCol: true } }];
}// ---------- 3-бет «позиция против позиции» (алиас — ext.v3m; сверено с таблицей владельца 24.11.2026: общий 3-бет) ----------
// строки — моя позиция, колонки — кто открыл; «3-бет баттона против MP» — одна цифра. Слева от «против» — моя позиция, справа — открывший
const V3H = ['MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'], V3O = ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'], ORD = ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
function posIn(t) { const out = []; for (const [p, a, b] of POS_RE) if (a.test(t) || b.test(t)) out.push(p); if (/(?<![\d.,]\s?)(?<![\d.,])(?<![a-zа-яё0-9])(bb|бб|би\s*би)(?![a-zа-яё0-9])|(?<![\d.,]\s?)больш[а-яё]*\s*блайнд|big\s*blind/.test(t)) out.push('BB'); /* «бб» без числа перед ним — позиция, «50 бб» — стек */ return ORD.filter(p => out.includes(p)); }
function vsInfo(ql) {
  // «против опена / открытия» — не разделитель позиций, если дальше есть ещё «против X»
  const all = [...ql.matchAll(/(против|vs\.?|versus|на\s*опен[\wа-яё]*|на\s*открыт[\wа-яё]*)/g)], pick = all.filter(x => !/^против$/.test(x[0]) || !/^\s*(опен|открыт)/.test(ql.slice(x.index + x[0].length)));
  const m = pick.length ? pick[pick.length - 1] : all[0], matrix = /позици[\wа-яё]*\s*против\s*позици|поз[аыу]?\s*в\s*поз|детальн|против\s*(кажд|всех\s*позиц)|по\s*открывающ|по\s*опенер/.test(ql);
  if (!m && !matrix) return null;
  const left = m ? posIn(ql.slice(0, m.index)) : [], right = m ? posIn(ql.slice(m.index + m[0].length)) : [];
  if (!matrix && !right.length) return null;
  return { hero: left.filter(p => V3H.includes(p === 'EP' ? 'MP' : p)).map(p => (p === 'EP' ? 'MP' : p)), opp: right.filter(p => V3O.includes(p)) };
}
function v3mBlocks(P, ql, vs, bands, metric) {
  const M = P.ext.v3m, k = metric === 'call' ? 'call' : aiMode(ql), name = { all: '3bet', nai: '3bet NAI', ai: '3bet AI', call: 'Cold call' }[k];
  const get = (h, o) => { let n = 0, a = 0, b = 0, c = 0; for (const bd of bands) { const x = M[h] && M[h][o] && M[h][o][bd]; if (x) { n += x[0]; c += x[1]; a += x[2]; b += x[3]; } } return { n, v: k === 'call' ? c : k === 'all' ? a + b : k === 'nai' ? a : b, a, b, hm: HMref(P, 'v3m|' + h + '|' + o, { call: 'call', all: 'b3all', nai: 'b3', ai: 'ai' }[k], bands) }; };
  const H = vs.hero.length ? vs.hero : V3H, O = vs.opp.length ? vs.opp : V3O, note = 'строки — моя позиция, колонки — кто открыл; против одного опена без коллеров' + (bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '');
  if (H.length === 1 && O.length === 1) { const r = get(H[0], O[0]); return [{ type: 'big', hm: r.hm, title: title(P) + ' — ' + name + ' с ' + H[0] + ' против ' + O[0], big: r.n ? pctS(r.v, r.n) : 'нет данных', n: r.n, ai: k === 'call' ? 'колл — опен не олл-ин' : undefined, note: (r.n && k === 'all' ? 'NAI ' + pctS(r.a, r.n) + ' · AI ' + pctS(r.b, r.n) + ' · ' : '') + 'против одного опена без коллеров' + (bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '') }]; }
  // осталась одна клетка (одна моя позиция с данными против одного опенера) — одна цифра
  if (O.length === 1) { const Hd = H.filter(h => ORD.indexOf(O[0]) < ORD.indexOf(h) && get(h, O[0]).n); if (Hd.length === 1) return v3mBlocks(P, ql, { hero: Hd, opp: O }, bands, metric); }
  const rows = H.map(h => [h, ...O.map(o => { if (ORD.indexOf(o) >= ORD.indexOf(h)) return ''; const r = get(h, o); return r.n ? { v: pctS(r.v, r.n), n: r.n, hm: r.hm } : { v: '—', n: 0 }; })]).filter(r => r.slice(1).some(c => c && c.n));
  return [{ type: 'table', title: title(P) + ' — ' + name + ': позиция против позиции', note, ai: k === 'call' ? 'колл — опен не олл-ин' : undefined, table: { head: ['', ...O], rows, grid: true } }];
}// ---------- блайнды против опенов (25.11.2026): BB vs / SB vs — колонки кто открыл, строки Fold / Call / 3B / 3B NAI / 3B AI (ext.v3m) ----------
const BVS_RE = /(реакц|реагир|ответ|защит|действ)[а-яё]*|(^|[^a-z])(bb|sb)\s*vs/;
/* «BB против опенов», «как я на BB реагирую против открытий», «BB vs» — без названного стата (или со словами реакция / ответы / защита) */
function isBVS(ql) { const bl = posIn(ql).some(p => p === 'BB' || p === 'SB') || /блайнд/.test(ql); if (!bl) return false; const vs = /(против|vs\.?|на)\s*(опен|открыт|рейз|все[хм]?\s*позиц|позици)/.test(ql) || /(^|[^a-z])(bb|sb)\s*vs/.test(ql); if (!vs) return false; return BVS_RE.test(ql) || !/3\s*-?\s*бет|тр[её]х\s*-?\s*бет|колл|кол[лд]?(\s|$)|фолд|изо|сквиз|лимп|rfi|vpip|pfr/.test(ql); }
function bvsBlocks(P, ql, bands) {
  const own = posIn(ql.replace(/(против|vs\.?|на)\s*(опен|открыт|рейз)[а-яё]*.*/, ' ')), hs = own.filter(p => p === 'BB' || p === 'SB'), H = hs.length ? hs : /блайнд/.test(ql) ? ['BB', 'SB'] : ['BB'], mode = aiMode(ql);
  const O = ['BTN', 'CO', 'HJ', 'MP', 'EP'], LAB = { BTN: 'BU' }, st = bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '';
  const R = [['Fold', 'fold', x => x[0] - x[1] - x[2] - x[3]], ['Call', 'call', x => x[1]], ['3B', 'b3all', x => x[2] + x[3]], ['3B NAI', 'b3', x => x[2]], ['3B AI', 'ai', x => x[3]]].filter(r => mode === 'all' || r[0] === 'Fold' || r[0] === 'Call' || (mode === 'nai' ? r[0] === '3B NAI' : r[0] === '3B AI'));
  return H.map(h => { const get = (o) => { const x = [0, 0, 0, 0]; for (const b of bands) { const r = P.ext.v3m[h] && P.ext.v3m[h][o] && P.ext.v3m[h][o][b]; if (r) for (let j = 0; j < 4; j++) x[j] += r[j]; } return x; };
    return { type: 'table', title: title(P) + ' — ' + h + ' против опенов', note: 'колонки — кто открыл; один опен (не олл-ин) без коллеров и лимпов, мы на ' + h + ' отвечаем' + st, ai: mode === 'nai' ? '3-бет без олл-инов' : mode === 'ai' ? '3-бет олл-ином' : '3B — общий · NAI — без олл-ина · AI — олл-ином',
      table: { head: [h + ' vs', ...O.map(o => LAB[o] || o)], rows: R.map(([lab, m, f]) => [lab, ...O.map(o => { const x = get(o); return x[0] ? { v: pctS(f(x), x[0]), n: x[0], hm: HMref(P, 'v3m|' + h + '|' + o, m, bands) } : ''; })]), grid: true, heatRow: true } }; });
}// ---------- лимп первым (алиас — ext.lmp; 26.11.2026, правило сверено с таблицей владельца) ----------
// TOT — лимп из возможностей открыться; L-F / L-C / L-R — после лимпа ровно один рейз, за нами никто не лимпил, рейз никто не заколлировал;
// L-R — только против рейза не олл-ином (на олл-ин рейзить нельзя). TOT колонки — без SB
const LMP_POS = ['TOT', 'EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'];
function lmpBlocks(P, ql, o) {
  if (o.pos === 'BB') return [{ type: 'text', title: title(P) + ' — лимп с BB', text: 'С BB лимпа не бывает: BB уже поставил блайнд и может только чекнуть или рейзнуть.' }];
  const { bands } = o, mode = aiMode(ql), st = bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '';
  const get = (p) => { const x = new Array(10).fill(0); for (const b of bands) { const r = P.ext.lmp[p] && P.ext.lmp[p][b]; if (r) for (let j = 0; j < 10; j++) x[j] += r[j] || 0; } return x; };
  const d = (x) => (mode === 'ai' ? x[6] : mode === 'nai' ? x[2] - x[6] : x[2]), v = (x, j) => (mode === 'ai' ? x[j + 4] : mode === 'nai' ? x[j] - x[j + 4] : x[j]), sfx = mode === 'all' ? '' : mode;
  const K = {
    limp: ['Limp', (x) => ({ v: pctS(x[1], x[0]), n: x[0] }), 'limp', 'лимп первым'],
    lf: ['L-F', (x) => ({ v: pctS(v(x, 3), d(x)), n: d(x) }), 'lf' + sfx, 'лимп-фолд'],
    lc: ['L-C', (x) => ({ v: pctS(v(x, 4), d(x)), n: d(x) }), 'lc' + sfx, 'лимп-колл'],
    lr: ['L-R', (x) => ({ v: pctS(x[5] - x[9], x[2] - x[6]), n: x[2] - x[6] }), 'lrnai', 'лимп-рейз'] };
  const want = /лимп[\s-]*(фолд|fold)|(^|[^a-z])l-?f([^a-z]|$)/.test(ql) ? 'lf' : /лимп[\s-]*(колл?|кол|call)|(^|[^a-z])l-?c([^a-z]|$)/.test(ql) ? 'lc' : /лимп[\s-]*(рейз|рэйз|raise)|(^|[^a-z])l-?r([^a-z]|$)/.test(ql) ? 'lr' : null;
  const rows = want ? [want] : mode === 'ai' ? ['limp', 'lf', 'lc'] : ['limp', 'lf', 'lc', 'lr'];
  const note = 'лимп — первыми в банк коллируем BB (из возможностей открыться); L-F / L-C / L-R — после лимпа ровно один рейз, за нами никто не лимпил, рейз до нас никто не заколлировал; L-R — против рейза не олл-ином; TOT — без SB' + st;
  const ai = mode === 'nai' ? 'рейз после лимпа — не олл-ин' : mode === 'ai' ? 'рейз после лимпа — олл-ин' : 'любой рейз, L-R — против рейза не олл-ином';
  const cell = (k, p) => { const x = get(p), c = K[k][1](x); return c.n ? { v: c.v, n: c.n, hm: HMref(P, 'lmp|' + p, K[k][2], bands) } : ''; };
  const pos = o.pos && LMP_POS.includes(o.pos) ? o.pos : null;
  if (!o.table && !o.PL) { const p = pos || 'TOT'; return rows.slice(0, want ? 1 : 1).map(k => { const c = cell(k, p); return { type: 'big', hm: c && c.hm, title: title(P) + ' — ' + K[k][3] + (p === 'TOT' ? '' : ' с ' + p), big: c ? c.v : 'нет данных', n: c ? c.n : 0, ai, note: (k === 'limp' && c ? ['lf', 'lc', 'lr'].map(q => { const z = cell(q, p); return K[q][0] + ' ' + (z ? z.v : '—'); }).join(' · ') + ' · ' : '') + note }; }); }
  const cols = o.PL ? ['TOT', ...o.PL.filter(p => LMP_POS.includes(p) && p !== 'TOT')] : ['TOT', 'EP', 'MP', 'HJ', 'CO', 'BTN'];
  return [{ type: 'table', title: title(P) + ' — лимпы по позициям', note, ai, table: { head: ['Limp', ...cols], rows: rows.map(k => [k === 'limp' ? 'TOT' : K[k][0], ...cols.map(p => cell(k, p))]), grid: true, heatRow: true } }];
}// ---------- продолженная ставка в позиции (алиас — ext.cb.ip; 26.11.2026) ----------
// я последний рейзил до флопа и на флопе хожу последним; CB — ставка, когда до меня все чекнули; Turn / River — следующая ставка после ставки, которую заколлировали;
// CB-Fold / Call / Raise — ответ на рейз после ставки на флопе (Raise — против рейза не олл-ином); Delay CB — флоп прочекали, ставка на тёрне; River — флоп и тёрн прочекали; +Bet — ривер после отложенной на тёрне
const CB_RE = /(^|[^a-zа-яё])(c|си|ц|цэ|кон|конт|кант|кам|ком|con|cont)\s*-?\s*(бет|бэт|bet)|(^|[^a-z])cb(?![a-z])|кбет|конбет|контбет|комбет|конт[а-яё]*\s*ставк|продолж[а-яё]*\s*ставк|отложенн[а-яё]*\s*(ставк|бет|бэт|цбет|конбет)|delay/;
/* конбеты один на один против BB (владелец 26.11.2026, ext.rec.bb): я открылся (один опен, лимпов нет), заколлировал только BB, на флопе вдвоём;
   строки: CB — все конбеты; CB до 35% — флоп: конбет меньше 35% банка, тёрн / ривер — следующая ставка после него (заколлировали, тёрн прочекан до меня);
   CB больше 50% — то же для конбета больше половины банка. [34] — 1 в позиции, 0 — я на SB (без позиции) */
const HU_BB = /(против|vs|на|с|у)\s*(бб|bb|би\s*би|больш[а-яё]*\s*блайнд[а-яё]*|big\s*blind)(?![a-zа-яё0-9])/;
/* название таблицы (владелец 26.11.2026): Total CBET — рейзер против BB; «тотал цбет» / «total c-bet» без «мультивей» — эта таблица */
const HU_W = /х[еэ]дс?\s*-?\s*ап|х[еэ]дз\s*-?\s*ап|heads?\s*-?\s*up|(^|[^a-z])hu([^a-z]|$)|вдво[её]м|один\s*на\s*один|1\s*на\s*1/;
const TOT_CB = /(тотал|total|тотл)\s*-?\s*((c|си|ц|цэ|кон|конт|ком)\s*-?\s*(бет|бэт|bet)|cb(?![a-z]))/;
/* линии рейзера против BB (владелец 27.11.2026): разовый стат — линия по улицам (мой первый ход: бет / чек), размеры моих ставок по улицам, олл-ин;
   ответ — выигрыш на шоудауне по этой линии (W$SD) или выигрыш банка; в таблицу не выводим. Записи ext.rec.bb [42..44] ходы, [45..47] олл-ин, [48..50] размер */
const TLN_RE = /лини[яиюей]|все\s*(3|три)\s*улиц|(3|три)\s*баррел|на\s*всех\s*(тр[её]х\s*)?улиц|ставя\s*(на\s*)?вс[её]/;
const TLN_SEQ = /(б[еэ]т|чек)\s*-\s*(б[еэ]т|чек)\s*-\s*(б[еэ]т|чек)(?![а-яё])/; /* «играю бет-бет-бет» — линия и без слова «линия» (27.11.2026) */
function isTLN(ql) { return !MW_Q.test(ql) && (HU_BB.test(ql) || HU_W.test(ql)) && (TLN_SEQ.test(ql) || TLN_RE.test(ql)) && /б[еэ]т|чек|bet|check|улиц|баррел|(^|[^а-яё])(все|всех|мои|сыгранн[а-яё]*|список|какие)(?![а-яё])/.test(ql); }
const TL_SZ = (p) => (p < 29 ? '~25%' : p < 40 ? '~33%' : p < 58 ? '~50%' : p < 70 ? '~66%' : p < 88 ? '~75%' : p <= 100.5 ? '~100%' : 'овер');
/* линия раздачи кратко: B(~33%) · X · B(овер); на улице несколько ходов — через «-» (B(~33%)-C — поставил, на чек-рейз заколлировал); олл-ин — «AI» */
const tlnLabel = (r) => [0, 1, 2].map(s => { const a = r[42 + s]; if (!a) return null; return a.split('').map((c, j) => (c === 'B' && j === 0 ? 'B(' + TL_SZ(r[48 + s]) + (r[45 + s] ? ' AI' : '') + ')' : c)).join('-'); }).filter(Boolean).join(' · ');
function tlnList(P, ql, R, bands) {
  const G = new Map(); for (const r of R) { const k = tlnLabel(r); if (!k) continue; const g = G.get(k) || G.set(k, []).get(k); g.push(r); }
  /* показываем линии, дошедшие до вскрытия (у остальных кто-то сбросил — выигрыша на шоудауне нет); больше вскрытий — выше */
  const all = [...G.entries()], hid = all.filter(([, xs]) => !xs.some(r => r[28]));
  const rows = all.filter(([, xs]) => xs.some(r => r[28])).sort((a, b) => b[1].filter(r => r[28]).length - a[1].filter(r => r[28]).length || b[1].length - a[1].length).map(([k, xs]) => { const sd = xs.filter(r => r[28]); return [k, { v: String(xs.length), n: 0 }, sd.length ? { v: String(sd.length), n: 0 } : { v: '—', n: 0 }, sd.length ? { v: pctS(sd.filter(r => r[29]).length, sd.length), n: sd.length } : { v: '—', n: 0 }]; });
  const st = bands.length < BANDS.length ? ' · стек ' + grpLabel('', bands) : '';
  return [{ type: 'table', title: title(P) + ' — все мои линии: рейзер против BB, хедс-ап' + st, note: 'линия — мои ходы по улицам (флоп · тёрн · ривер): B — бет (в скобках — % банка перед ставкой: ~25 / ~33 / ~50 / ~66 / ~75 / ~100%, овер — больше банка; AI — олл-ином), X — чек, C — колл, R — рейз, F — фолд; несколько ходов на улице — через «-» (B-C — поставил и заколлировал чек-рейз); линия кончается, когда кто-то сбросил; W$SD — выиграл на вскрытии из дошедших до вскрытия; показаны линии, где было вскрытие (' + rows.length + '), выше — где вскрытий больше; ещё ' + hid.length + ' линий (' + hid.reduce((a, [, xs]) => a + xs.length, 0) + ' раздач) кончились до вскрытия — кто-то сбросил; я открылся, заколлировал только большой блайнд, я в позиции', table: { head: ['линия', 'раздач', 'вскрытий', 'W$SD'], rows, grid: true } }];
}function tlnBlocks(P, ql, R, bands) {
  const qw = noSize(ql), SN = ['флоп', 'тёрн', 'ривер'], ON = { B: 'бет', X: 'чек' };
  let L = null; const m = /(б[еэ]т|чек|bet|check)(\s*[-–—·,]?\s*(б[еэ]т|чек|bet|check)){1,2}(?![а-яёa-z])/.exec(qw);
  if (m) L = m[0].split(/[\s\-–—·,]+/).filter(Boolean).map(w => (/чек|check/.test(w) ? 'X' : 'B'));
  else if (/все\s*(3|три)\s*улиц|(3|три)\s*баррел|на\s*всех\s*(тр[её]х\s*)?улиц|ставя\s*(на\s*)?вс[её]/.test(qw)) L = ['B', 'B', 'B'];
  /* все сыгранные линии (владелец 27.11.2026): «все мои линии против BB» — каждая линия с размерами моих ставок по улицам и выигрыш на шоудауне напротив */
  if (!L || (!m && /(все|всех|какие|список|перечень)\s*(мо[иеё][а-яё]*\s*)?(сыгранн[а-яё]*\s*)?лини|сыгранн[а-яё]*\s*лини|лини[а-яё]*\s*(все|целиком|списком)/.test(qw))) return tlnList(P, ql, R, bands);  if (!L) return [{ type: 'text', text: 'Назовите линию по улицам: «бет-чек-бет», «чек-бет-бет», «бет-бет-чек» или «ставя все три улицы» — и что показать: выигрыш на шоудауне или выигрыш банка.' }];
  /* размеры ставок в линии (владелец 27.11.2026): «какая самая частая по размеру ставка на ривере, когда играю бет-бет-бет» — корзины размера моей ставки на улице среди раздач этой линии */
  if (/сайз|разм[еи]р|какой\s*(%|процент)|каким\s*(размер|сайз)|(сам[аыо][яейх]|наиболее)\s*част|чаще\s*всего\s*став|частых\s*(моих\s*)?ставок|список\s*[а-яё\s]*ставок/.test(ql) && !Object.keys(sizeFilters(ql)).length) {
    const sw0 = /ривер/.test(qw) ? 2 : /т[её]рн|терн/.test(qw) ? 1 : /флоп/.test(qw) ? 0 : L.lastIndexOf('B');
    if (sw0 < 0 || L[sw0] !== 'B') return [{ type: 'text', text: 'В этой линии на ' + ['флопе', 'тёрне', 'ривере'][Math.max(0, sw0)] + ' нет моей ставки — назовите улицу, где я ставлю.' }];
    const X0 = R.filter(r => L.every((a, s) => (r[42 + s] || '')[0] === a) && r[48 + sw0]), BK = ['~25%', '~33%', '~50%', '~66%', '~75%', '~100%', 'овер'], G = {}; for (const r of X0) (G[TL_SZ(r[48 + sw0])] = G[TL_SZ(r[48 + sw0])] || []).push(r);
    const rows = BK.filter(k => G[k]).map(k => { const xs = G[k], sd = xs.filter(r => r[28]); return [k === 'овер' ? 'овербет (больше банка)' : k + ' банка', { v: String(xs.length), n: 0 }, { v: pctS(xs.length, X0.length) + ' (' + (sd.length ? pctS(sd.filter(r => r[29]).length, sd.length) : '—') + ')', n: X0.length }]; }); /* в скобках — выиграл на вскрытии после ставки этого размера (владелец 27.11.2026: везде, где спрашивают самый частый размер) */
    const top = BK.filter(k => G[k]).sort((a, b) => G[b].length - G[a].length)[0], lt0 = L.map(a => ON[a]).join(' · ');
    const st0 = bands.length < BANDS.length ? ' · стек ' + grpLabel('', bands) : '';
    return [{ type: 'table', title: title(P) + ' — размер моей ставки на ' + ['флопе', 'тёрне', 'ривере'][sw0] + ' · линия ' + lt0 + ' · рейзер против BB, хедс-ап' + st0 + (top ? ' — чаще всего ' + (top === 'овер' ? 'овербет' : top + ' банка') + ' — ' + pctS(G[top].length, X0.length) + ' (выиграл на вскрытии ' + (() => { const sd = G[top].filter(r => r[28]); return sd.length ? pctS(sd.filter(r => r[29]).length, sd.length) : '—'; })() + ')' : ''), note: 'раздач с этой линией: ' + X0.length + '; размер — % банка перед моей ставкой на этой улице, корзины: до 29% → ~25, 29–39 → ~33, 40–57 → ~50, 58–69 → ~66, 70–87 → ~75, 88–100 → ~100, больше банка — овербет; доля — среди моих ставок на этой улице в линии, в скобках — выиграл на вскрытии после ставки этого размера (из дошедших до вскрытия); я открылся, заколлировал только большой блайнд, я в позиции', table: { head: ['размер', 'раз', 'доля (выиграл на вскрытии)'], rows, grid: true } }];
  }  const SF = sizeFilters(ql), FS = [SF.f, SF.t, SF.r];
  /* олл-ин: улица — слово рядом с «олл-ин»; без улицы — последняя улица линии со ставкой */
  const AIQ = [], aiRe = /олл?\s*-?\s*ин[а-яё]*|all\s*-?\s*in|ол+ин[а-яё]*|пуш[а-яё]*/g; let am;
  while ((am = aiRe.exec(ql))) { if (/без\s*$/.test(ql.slice(Math.max(0, am.index - 6), am.index))) continue; const w = ql.slice(Math.max(0, am.index - 30), am.index + am[0].length + 25); const sm = [...w.matchAll(/флоп|т[её]рн|терн|ривер/g)]; let s = -1; if (sm.length) { const mid = am.index - Math.max(0, am.index - 30); let best = 1e9; for (const x of sm) { const d = Math.abs(x.index - mid); if (d < best) { best = d; s = /флоп/.test(x[0]) ? 0 : /ривер/.test(x[0]) ? 2 : 1; } } } if (s < 0) s = L.lastIndexOf('B'); if (s >= 0) AIQ.push(s); }
  const ok = (r) => L.every((a, s) => (r[42 + s] || '')[0] === a) && FS.every((f, s) => !f || (r[48 + s] && r[48 + s] >= f[0] && r[48 + s] < f[1])) && AIQ.every(s => r[45 + s] === 1);
  const X = R.filter(ok), sd = X.filter(r => r[28]), wsd = sd.filter(r => r[29]), won = X.filter(r => r[30]);
  const wantPot = !/шоу?\s*-?\s*даун|вскрыт|w\s*\$?\s*sd|wsd/.test(ql) && /банк|пот(?![а-яё])|выигр/.test(ql);
  const lt = L.map(a => ON[a]).join(' · '), cond = [...FS.map((f, s) => f ? SN[s] + ' ' + fltTxt({ [['f', 't', 'r'][s]]: f }).replace(/^\S+\s/, '') : null), ...[...new Set(AIQ)].map(s => 'олл-ин на ' + SN[s] + 'е')].filter(Boolean).join(', ');
  const st = bands.length < BANDS.length ? ' · стек ' + grpLabel('', bands) : '';
  const big = wantPot ? (X.length ? pctS(won.length, X.length) : 'нет данных') : (sd.length ? pctS(wsd.length, sd.length) : 'нет данных');
  return [{ type: 'big', title: title(P) + ' — ' + (wantPot ? 'выиграл банк' : 'выигрыш на шоудауне') + ' · линия ' + lt + (cond ? ' (' + cond + ')' : '') + ' · рейзер против BB, хедс-ап' + st, big, n: wantPot ? X.length : sd.length,
    note: 'раздач с этой линией: ' + X.length + '; дошло до вскрытия: ' + (X.length ? pctS(sd.length, X.length) : '—') + ' (' + sd.length + '); выиграл на вскрытии: ' + (sd.length ? pctS(wsd.length, sd.length) : '—') + '; выиграл банк (вскрытием или все сбросили): ' + (X.length ? pctS(won.length, X.length) : '—') + '. Линия — мой первый ход на каждой улице (бет / чек); размер — % банка перед моей ставкой на этой улице; я открылся, заколлировал только большой блайнд, я в позиции' }];
}function cbbbBlocks(P, ql, o) {
  /* только в позиции (владелец 26.11.2026): раздачи, где я на SB, не берём */
  const { bands } = o, bs = new Set(bands), R = ((P.ext.rec && P.ext.rec.bb) || []).filter(r => bs.has(r[0]) && r[34] === 1);
  if (!P.ext.rec || !P.ext.rec.bb) return [{ type: 'text', text: 'Конбеты против большого блайнда пока посчитаны только по вашей базе.' }];
  const pc = (a, b) => (b ? { v: pctS(a, b), n: b } : { v: '—', n: 0 });
  if (TLN_RE.test(ql) || TLN_SEQ.test(ql)) return tlnBlocks(P, ql, R, bands);  const row = (lab, ok) => { const fl = R.filter(r => r[2]), cb = fl.filter(r => r[3] && ok(r[4])), tu = cb.filter(r => r[7]), rv = tu.filter(r => r[8] && r[10]);
    return [lab, pc(cb.length, fl.length), pc(tu.filter(r => r[8]).length, tu.length), pc(rv.filter(r => r[11]).length, rv.length)]; };
  const pos = /без\s*позиц|вне\s*позиц|не\s*в\s*позиц|без\s*поз[ыу](?![а-яё])/.test(ql) ? ', в позиции (без позиции — с моего SB — не считаем)' : ', в позиции', st = bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '';
  const rows = [row('CB', () => true), row('CB до 35% банка', (p) => p < 35), row('CB больше 50% банка', (p) => p > 50), row('CB больше 80% банка', (p) => p > 80), ...[['CB-Fold', 1], ['CB-Call', 2], ['CB-3Bet', 3]].map(([lab, k]) => [lab, ...[[5, 6], [35, 37], [36, 38]].map(([i, ai]) => { const xs = R.filter(r => r[i] >= 1 && r[i] <= 3 && (k !== 3 || !r[ai])); return pc(xs.filter(r => r[i] === k).length, xs.length); })])] /* CB-3Bet — только против чек-рейза не олл-ином (владелец 26.11.2026: есть возможность перерейзить) */
  /* CB · XX · B (владелец 26.11.2026): конбет на флопе заколлирован, тёрн прочекан обоими, на ривере до меня чек — ставлю [39..41] */
  { const o = R.filter(r => r[39]); rows.push(['CB · XX · B', '', '', pc(o.filter(r => r[40]).length, o.length)]); } /* ответ на чек-рейз после моей ставки на улице: фолд / колл / перерейз или олл-ин (владелец 26.11.2026) */;
  /* одна цифра из таблицы (владелец 27.11.2026: любой стат таблицы — голосом): назван ход (CB-Fold / CB-Call / CB-3Bet / CB · XX · B) или улица — клетка этой строки и улицы;
     «таблица», «мои конбеты» без хода и улицы — вся таблица. Улица — по словам вопроса без размера («фолд по тёрну после мелкой по флопу» — тёрн) */
  const pick = (T, SFT) => { const qw = noSize(ql), RZ = '(\\s*((на|против|после)\\s*)?(мо[йиеё][а-яё]*\\s*)?(чек\\s*-?\\s*)?рейз[а-яё]*)', CBW = '(c\\s*-?\\s*bet|cb|си\\s*-?\\s*б[еэ]т|ц\\s*б[еэ]т|цбет|конбет|контбет|комбет|б[еэ]т|ставк)[а-яё]*\\s*-?\\s*';
    const mv = new RegExp(CBW + '(3|три)\\s*-?\\s*(б[еэ]т|bet|b)(?![а-яё])|(3|три)\\s*-?\\s*б[еэ]т[а-яё]*' + RZ + '|3\\s*-?\\s*bet' + RZ + '|(пере|ре)\\s*-?\\s*рейз|перекру|олл?\\s*-?\\s*ин[а-яё]*' + RZ).test(qw) ? 'CB-3Bet'
      : new RegExp(CBW + '(фолд|fold)|(фолд|fold|сброс|сбрас)[а-яё]*' + RZ).test(qw) ? 'CB-Fold'
      : new RegExp(CBW + '(колл?|call)(?![а-яё]*ер)|(колл?|call|заколл[а-яё]*|коллир[а-яё]*)(?![а-яё]*ер)[а-яё]*' + RZ).test(qw) ? 'CB-Call'
      : /xx\s*-?\s*b|чек\s*-?\s*чек|т[её]рн[а-яё]*\s*прочек|прочек[а-яё]*\s*т[её]рн/.test(qw) ? 'CB · XX · B' : null;
    const sw = /ривер/.test(qw) ? 3 : /т[её]рн|терн/.test(qw) ? 2 : /флоп/.test(qw) ? 1 : 0, col = mv === 'CB · XX · B' ? 3 : sw || 1;
    if (TBL_W.test(ql) || /таблиц|по\s*улиц|все\s*улиц/.test(ql) || (!mv && !sw && (/(^|[^а-яё])(total|тотал)/.test(ql) || !/(^|[^а-яё])(мой|мою|моя|моё|мое)(?![а-яё])/.test(ql)))) return T;
    const row = T[0].table.rows.find(r => r[0] === (mv || 'CB')), c = row && row[col];
    const lab = (mv || 'CB') + ' ' + ['', 'флоп', 'тёрн', 'ривер'][col];
    return [{ type: 'big', title: title(P) + ' — ' + lab + ' · Total CBET против BB, хедс-ап' + SFT + (bands.length < BANDS.length ? ' · стек ' + grpLabel('', bands) : ''), big: c && c.n ? c.v : 'нет данных', n: c ? c.n : 0, note: (mv && mv !== 'CB · XX · B' ? 'из всех раз, когда на мою ставку на ' + ['', 'флопе', 'тёрне', 'ривере'][col] + ' сделали чек-рейз' + (mv === 'CB-3Bet' ? ' не олл-ином' : '') + '; ' : '') + T[0].note }]; };  const note = 'я открылся (один рейз, без лимпов), заколлировал только большой блайнд, на флопе вдвоём, я в позиции (раздачи с моего SB не берём); флоп — как часто ставлю конбет этого размера, когда до меня чек (размер — % банка перед ставкой); тёрн — после заколлированного конбета этого размера, до меня чек, ставлю снова; ривер — после заколлированной ставки на тёрне ставлю ещё раз; CB · XX · B — конбет заколлирован, тёрн прочекан обоими, на ривере ставлю; CB-Fold / CB-Call / CB-3Bet — на мою ставку на этой улице сделали чек-рейз, и я сбросил / заколлировал (из всех чек-рейзов) / перерейзил, в том числе олл-ином (CB-3Bet — только из чек-рейзов не олл-ином)' + st;
  /* назван размер ставки (владелец 26.11.2026, как во всех постфлоп-таблицах): клетки — только раздачи с этим размером на этой улице, дальше — что было после неё;
     улицы до неё — «—»; строки размеров (до 35% / больше 50% / 80%) не показываем — их заменяет названный размер */
  const SF = sizeFilters(ql), FS = [SF.f, SF.t, SF.r];
  if (FS.some(Boolean)) { const s0 = FS.findIndex(Boolean), OI = [2, 7, 10], BI = [3, 8, 11], ZI = [4, 9, 12], RI = [[5, 6], [35, 37], [36, 38]];
    const inS = (r, s) => !FS[s] || (r[BI[s]] && r[ZI[s]] >= FS[s][0] && r[ZI[s]] < FS[s][1]);
    const upTo = (r, s) => { for (let i = 0; i < s; i++) if (!inS(r, i)) return false; return true; }; /* прошли фильтры улиц до s */
    const cbC = (s) => { if (s < s0) return { v: '—', n: 0 }; const b = R.filter(r => upTo(r, s) && r[OI[s]]); return pc(b.filter(r => r[BI[s]] && inS(r, s)).length, b.length); };
    const rsC = (s, k) => { if (s < s0) return { v: '—', n: 0 }; const [i, ai] = RI[s], b = R.filter(r => upTo(r, s + 1) && r[i] >= 1 && r[i] <= 3 && (k !== 3 || !r[ai])); return pc(b.filter(r => r[i] === k).length, b.length); };
    const SFT = ' · размер: ' + fltTxt(SF), rowsF = [['CB', cbC(0), cbC(1), cbC(2)], ['CB-Fold', rsC(0, 1), rsC(1, 1), rsC(2, 1)], ['CB-Call', rsC(0, 2), rsC(1, 2), rsC(2, 2)], ['CB-3Bet', rsC(0, 3), rsC(1, 3), rsC(2, 3)]]; { /* CB · XX · B с размером: флоп — конбет этого размера; тёрн — в линии ставки нет, «—»; ривер — ставка этого размера */ const b = FS[1] ? [] : R.filter(r => r[39] && (!FS[0] || (r[3] && r[4] >= FS[0][0] && r[4] < FS[0][1]))); rowsF.push(['CB · XX · B', '', '', FS[1] ? { v: '—', n: 0 } : pc(b.filter(r => r[40] && (!FS[2] || (r[41] >= FS[2][0] && r[41] < FS[2][1]))).length, b.length)]); }
    return pick([{ type: 'table', title: title(P) + ' — Total CBET: я рейзер против большого блайнда, хедс-ап банк' + pos + SFT + (bands.length < BANDS.length ? ' · стек ' + grpLabel('', bands) : ''), note: 'все клетки — только раздачи с этим размером ставки на этой улице; CB на этой улице — как часто ставлю этот размер, дальше — следующие ставки после него; «—» — улица до названной; ' + note, table: { head: ['против BB', 'Flop', 'Turn', 'River'], rows: rowsF, grid: true } }], SFT); }
  return pick([{ type: 'table', title: title(P) + ' — Total CBET: я рейзер против большого блайнда, хедс-ап банк' + pos + (bands.length < BANDS.length ? ' · стек ' + grpLabel('', bands) : ''), note, table: { head: ['против BB', 'Flop', 'Turn', 'River'], rows, grid: true } }], '');
}
function cbBlocks(P, ql, o) {
  /* без позиции в мультивее (26.11.2026): после меня на флопе ходит кто-то ещё */
  const { bands } = o, mode = aiMode(ql), st = bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '';
  /* только мультивей (владелец 26.11.2026): на флопе трое и больше, я открылся первым, меня заколлировали, на флопе хожу последним — банки один на один не подмешиваем */
  /* владелец 26.11.2026: ответ только если в вопросе есть И «мультивей», И «в позиции»; «мои конбеты» без них — другие споты, пока не посчитаны */
  const OOP_RE = /без\s*позиц[а-яё]*|вне\s*позиц[а-яё]*|не\s*в\s*позиц[а-яё]*|без\s*поз[ыу](?![а-яё])|вне\s*поз[ыу](?![а-яё])|не\s*в\s*поз[еу](?![а-яё])|(^|[^a-z])oop([^a-z]|$)|out\s*of\s*position|аут\s*оф\s*поз[а-яё]*/g, qi = ql.replace(OOP_RE, ' ');
  const isMW = /мульти|мульт[иы]\s*-?\s*пот|мультик|multi/.test(ql), isOOP = OOP_RE.test(ql), isIP0 = /(^|[^а-яё])в\s*позици|(^|[^а-яё])в\s*поз[еу](?![а-яё])|(^|[^a-z])ip([^a-z]|$)|in\s*position/.test(qi);
  OOP_RE.lastIndex = 0;
  /* «в позиции и без позиции» — обе таблицы подряд (владелец 26.11.2026) */
  if (isMW && isOOP && isIP0) return [...cbBlocks(P, qi.replace(/(^|[^а-яё])в\s*позици[а-яё]*/g, ' ') + ' в позиции', o), ...cbBlocks(P, qi.replace(/(^|[^а-яё])в\s*позици[а-яё]*/g, ' ') + ' без позиции', o)];
  const isIP = !isOOP && isIP0;
  if (!isMW && (HU_BB.test(ql) || HU_W.test(ql))) return cbbbBlocks(P, ql, o);
  if (!isMW && TOT_CB.test(ql)) return [{ type: 'text', text: 'Total CBET посчитан для хедс-ап банка, когда я рейзер против большого блайнда. Спросите так: «Total CBET рейзер против BB, хедс-ап» или «мои конбеты против большого блайнда».' }];
  if (!isMW || (!isIP && !isOOP)) return [{ type: 'text', text: 'Сейчас посчитаны мои конбеты в мультивее как рейзер (я открылся первым, меня заколлировали) — в позиции и без позиции. Спросите со словами «в мультивее» и «в позиции» / «без позиции», например: «мои конбеты в мультивее в позиции», «мой цбет-фолд в мультивее без позиции», «сайзинги конбета в мультивее вне позиции». Один на один — Total CBET против большого блайнда: скажите «против BB» или «в хедс-апе», например: «мой цбет-фолд на тёрне против BB», «мой бет на ривере после чек-чека по тёрну и конбета флопа против BB».' }];
  const kd = isOOP ? 'mwo' : 'mw', KD = { mw: ' в мультивее, в позиции, как рейзер', mwo: ' в мультивее, без позиции, как рейзер' };
  /* размеры конбета на флопе (26.11.2026): % банка, частота среди всех конбетов и фолд на рейз после этого размера */
  if (/сайз|разм[еи]р|sizing|size/.test(ql) && !Object.keys(sizeFilters(ql)).length) { const G = (P.ext.cbs && P.ext.cbs[kd]) || {}, agg = (g) => { const x = [0, 0, 0, 0, 0, 0]; for (const b of bands) { const r = G[g] && G[g][b]; if (r) for (let j = 0; j < 6; j++) x[j] += r[j]; } return x; };
    const keys = Object.keys(G).sort(), tot = keys.reduce((s, g) => s + agg(g)[0], 0), LBL = { '1:25': '~25%', '2:33': '~33%', '3:50': '~50%', '4:66': '~66%', '5:75': '~75%', '6:100': '~100%', '7:120+': 'овербет (больше банка)' };
    const rows = keys.map(g => { const x = agg(g); if (!x[0]) return null; const bk0 = { '1:25': [0, 29], '2:33': [29, 40], '3:50': [40, 58], '4:66': [58, 70], '5:75': [70, 88], '6:100': [88, 100.5], '7:120+': [100.5, 1e9] }[g], bs0 = new Set(bands), sd0 = ((P.ext.rec && P.ext.rec[kd]) || []).filter(r => bs0.has(r[0]) && r[3] && bk0 && r[4] >= bk0[0] && r[4] < bk0[1] && r[28]); /* выиграл на вскрытии после конбета этого размера (владелец 27.11.2026) */
      return [LBL[g] || g, { v: pctS(x[0], tot) + ' (' + (sd0.length ? pctS(sd0.filter(r => r[29]).length, sd0.length) : '—') + ')', n: x[0], hm: HMref(P, 'cbs|' + kd, 'sz:' + g, bands, 'any') }, x[1] ? { v: pctS(x[2], x[1]), n: x[1], hm: HMref(P, 'cbs|' + kd, 'f:' + g, bands) } : { v: '—', n: 0 }, (() => { const bk = { '1:25': [0, 29], '2:33': [29, 40], '3:50': [40, 58], '4:66': [58, 70], '5:75': [70, 88], '6:100': [88, 100.5], '7:120+': [100.5, 1e9] }[g], bs = new Set(bands), rr = ((P.ext.rec && P.ext.rec[kd]) || []).filter(r => bs.has(r[0]) && r[3] && bk && r[4] >= bk[0] && r[4] < bk[1]); return rr.length ? { v: pctS(rr.filter(r => r[31] === 1).length, rr.length), n: rr.length } : { v: '—', n: 0 }; })()]; }).filter(Boolean); /* успешность — все сбросили на конбет этого размера */
    return [{ type: 'table', title: title(P) + ' — сайзинги конбета на флопе' + KD[kd], note: 'размер — % банка перед ставкой (корзины: до 29% → ~25%, 29–39 → ~33%, 40–57 → ~50%, 58–69 → ~66%, 70–87 → ~75%, 88–100 → ~100%, больше банка — овербет); частота — доля среди всех моих конбетов в мультивее, в скобках — выиграл на вскрытии после конбета этого размера (из дошедших до вскрытия); Fold vs raise — сбросил на рейз после этого размера; успешность — все сбросили сразу на мой конбет этого размера' + '; мультивей — на флопе трое и больше, я открылся первым, меня заколлировали, ' + (kd === 'mwo' ? 'после меня ходит кто-то ещё' : 'я хожу последним') + (bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : ''), table: { head: ['размер', 'частота (выиграл на вскрытии)', 'Fold vs raise', 'успешность (все сбросили)'], rows, grid: true, heatCol: true } }]; }
  const x = new Array(22).fill(0); for (const b of bands) { const r = P.ext.cb[kd] && P.ext.cb[kd][b]; if (r) for (let j = 0; j < 22; j++) x[j] += r[j] || 0; }
  const c = (num, den, m) => (den ? { v: pctS(num, den), n: den, hm: HMref(P, 'cb|' + kd, m, bands) } : { v: '—', n: 0 });
  const fd = mode === 'ai' ? x[11] : mode === 'nai' ? x[9] : x[6], ffv = mode === 'ai' ? x[12] : mode === 'nai' ? x[7] - x[12] : x[7], fcv = mode === 'ai' ? x[13] : mode === 'nai' ? x[8] - x[13] : x[8], sfx = mode === 'all' ? '' : mode;
  const C = { f: ['CB флоп', c(x[1], x[0], 'f')], t: ['CB тёрн', c(x[3], x[2], 't')], r: ['CB ривер', c(x[5], x[4], 'r')], ff: ['CB-Fold', c(ffv, fd, 'ff' + sfx)], fc: ['CB-Call', c(fcv, fd, 'fc' + sfx)], fr: ['CB-Raise', c(x[10], x[9], 'frnai')], dt: ['Delay CB тёрн', c(x[15], x[14], 'dt')], dr: ['Delay CB ривер', c(x[17], x[16], 'dr')], pb: ['+Bet ривер', c(x[19], x[18], 'pb')], fsx: ['успешность CB флоп', { v: '—', n: 0 }], tsx: ['успешность CB тёрн', { v: '—', n: 0 }], rsx: ['успешность CB ривер', { v: '—', n: 0 }], dtsx: ['успешность Delay CB тёрн', { v: '—', n: 0 }], drsx: ['успешность Delay CB ривер', { v: '—', n: 0 }], pbsx: ['успешность +Bet ривер', { v: '—', n: 0 }] };
  const SF = sizeFilters(ql), SFT = Object.keys(SF).length ? ' · размер: ' + fltTxt(SF) : ''; if (P.ext.rec && P.ext.rec[kd]) for (const k of Object.keys(C)) C[k][1] = recCell(P, kd, k, SF, bands, mode); /* по записям раздач: с фильтром размера или без */
  if (Object.keys(SF).length && SQ_W.test(ql) && P.ext.rec && P.ext.rec[kd] && !/таблиц/.test(ql)) return sizeAnswer(P, ql, kd, SF, bands, mode, KD[kd]);
  const note = 'мультивей: на флопе трое и больше, я открылся первым, меня заколлировали, на флопе ' + (kd === 'mwo' ? 'после меня ходит кто-то ещё (без позиции)' : 'хожу последним') + '; CB — ставка, когда до меня все чекнули; тёрн / ривер — следующая ставка после заколлированной; CB-Fold / Call / Raise — мой ответ на рейз после ставки на флопе (Raise — против рейза не олл-ином); Delay CB — флоп прочекали, ставка на тёрне (ривер — флоп и тёрн прочекали); +Bet — ставка на ривере после заколлированной отложенной' + '; тёрн / ривер — только если на улице ещё трое и больше' + st;
  const ai = mode === 'nai' ? 'рейз на мою ставку — не олл-ин' : mode === 'ai' ? 'рейз на мою ставку — олл-ин' : 'любой рейз; CB-Raise — против рейза не олл-ином';
  const qw = noSize(ql), want = /(c-?bet|cb|бет|ставк)[а-яё]*[\s-]*(фолд|fold)|фолд[а-яё]*\s*(на\s*)?рейз/.test(qw) ? 'ff' : /(c-?bet|cb|бет|ставк)[а-яё]*[\s-]*(колл?|кол|call)|колл?[а-яё]*\s*(на\s*)?рейз/.test(qw) ? 'fc' : /(c-?bet|cb|бет|ставк)[а-яё]*[\s-]*(рейз|raise|ререйз)|ререйз/.test(qw) ? 'fr' : /(\+|плюс)\s*б[еэ]т/.test(qw) && /отлож|дил[еэ]й|delay/.test(qw) ? 'pb' : /отлож|delay|дил[еэ]й|д[еэ]л[еэ]й/.test(qw) ? (/ривер/.test(qw) ? 'dr' : 'dt') : /(\+|плюс)\s*б[еэ]т/.test(qw) && !/флоп|т[её]рн/.test(qw) ? 'pb' : /ривер/.test(qw) ? 'r' : /т[её]рн/.test(qw) ? 't' : 'f', SUCC = /успешн|успех|все\s*сбрас|фолд(ов|ы)?\s*на\s*(мо|ставк|конбет|цбет)/.test(qw), want2 = SUCC && C[want + 'sx'] ? want + 'sx' : want;
  if (((want !== 'f' || SUCC) && !TBL_W.test(ql) && !/(^|[^а-яё])мои(?![а-яё])/.test(ql)) || (!WANT_TABLE.test(ql) && !TBL_W.test(ql) && !/таблиц|все\s*(мои|улиц)|по\s*улиц|б[еэ]т(ы|ов)|ставки|ставок|bets/.test(ql) && !(/(^|[^а-яё])мои(?![а-яё])/.test(ql) && want === 'f'))) { const k = C[want2]; /* назван конкретный ход — одна цифра; «успешность …» — все сбросили после ставки */ /* «мои c-bet …» — вся таблица */ return [{ type: 'big', hm: k[1].hm, title: title(P) + ' — ' + k[0] + KD[kd] + SFT, big: k[1].na ? 'не зависит от названного размера' : k[1].n ? k[1].v : 'нет данных', n: k[1].n, ai: ['ff', 'fc', 'fr'].includes(want) ? ai : undefined, note: (want === 'f' && x[0] ? 'тёрн ' + C.t[1].v + ' · ривер ' + C.r[1].v + ' · ' : '') + note }]; }
  return [{ type: 'table', title: title(P) + ' — мои конбеты' + KD[kd] + SFT, note: (SFT ? 'все клетки — только раздачи с этим размером ставки; «—» — клетка до этой улицы или на другой линии; ' : '') + note, ai, table: { head: [kd === 'mwo' ? 'OOP' : 'IP', 'Flop', 'Turn', 'River'], rows: [['CB', C.f[1], C.t[1], C.r[1]], ['CB-Fold', C.ff[1], '', ''], ['CB-Call', C.fc[1], '', ''], ['CB-Raise', C.fr[1], '', ''], ['Delay CB', '', C.dt[1], C.dr[1]], ['+Bet', '', '', C.pb[1]], ['CB успешность', C.fsx[1], C.tsx[1], C.rsx[1]], ['Delay CB успешность', '', C.dtsx[1], C.drsx[1]], ['+Bet успешность', '', '', C.pbsx[1]]], grid: true } }];
}// ---------- ставка на пропуск (алиас — ext.bsk; 26.11.2026): мультивей, я коллер до флопа, все до меня чекнули — ставлю ----------
const BSK_RE = /б[еэ]т[а-яё]*\s*-?\s*(фолд[а-яё]*\s*)?(в\s*|на\s*)?(скип|пропуск)|(ставк|ставок)[а-яё]*\s*(в|на)\s*пропуск|(bet|b)\s*vs\s*skip|bet\s*-?\s*skip|пропущенн[а-яё]*\s*(бет|ставк)/;
function bskBlocks(P, ql, o) {
  const OOP = /без\s*позиц|вне\s*позиц|не\s*в\s*позиц|без\s*поз[ыу](?![а-яё])|вне\s*поз[ыу](?![а-яё])|не\s*в\s*поз[еу](?![а-яё])|(^|[^a-z])oop([^a-z]|$)|out\s*of\s*position|аут\s*оф\s*поз/, qi = ql.replace(new RegExp(OOP.source, 'g'), ' '), isMW = /мульти|мульт[иы]\s*-?\s*пот|мультик|multi/.test(ql), isOOP = OOP.test(ql), isIP = /(^|[^а-яё])в\s*позици|(^|[^а-яё])в\s*поз[еу](?![а-яё])|(^|[^a-z])ip([^a-z]|$)|in\s*position/.test(qi);
  if (!isMW || (!isIP && !isOOP)) return [{ type: 'text', text: 'Ставка на пропуск посчитана в мультивее, когда я коллер до флопа и хожу последним. Спросите со словами «в мультивее» и «в позиции», например: «мои беты в пропуск в мультивее в позиции».' }];
  /* без позиции пока не показываем (владелец 26.11.2026) — только в позиции */
  if (isOOP && !isIP) return [{ type: 'text', text: 'Ставка на пропуск без позиции пока не показывается — есть только в позиции: «мои беты в пропуск в мультивее в позиции».' }];
  if (isIP && isOOP) return bskBlocks(P, qi + ' в позиции', o);
  const kd = isOOP ? 'oop' : 'ip', { bands } = o, x = new Array(12).fill(0); for (const b of bands) { const r = P.ext.bsk[kd] && P.ext.bsk[kd][b]; if (r) for (let j = 0; j < 12; j++) x[j] += r[j] || 0; }
  const c = (num, den, m) => (den ? { v: pctS(num, den), n: den, hm: HMref(P, 'bsk|' + kd, m, bands) } : { v: '—', n: 0 });
  const C = { f: ['B vs Skip флоп', c(x[1], x[0], 'f')], t: ['B vs Skip тёрн', c(x[3], x[2], 't')], r: ['B vs Skip ривер', c(x[5], x[4], 'r')], ff: ['B-Fold', c(x[7], x[6], 'ff')], bt: ['бет флоп + бет тёрн', c(x[11], x[10], 'bt')], fsx: ['успешность B vs Skip флоп', { v: '—', n: 0 }], tsx: ['успешность B vs Skip тёрн', { v: '—', n: 0 }], rsx: ['успешность B vs Skip ривер', { v: '—', n: 0 }], btsx: ['успешность бет флоп + бет тёрн', { v: '—', n: 0 }] }, KD = { ip: ' в мультивее, в позиции, как коллер', oop: ' в мультивее, без позиции, как коллер' };
  const SF = sizeFilters(ql), SFT = Object.keys(SF).length ? ' · размер: ' + fltTxt(SF) : ''; if (P.ext.rec && P.ext.rec.bsk && kd === 'ip') for (const k of Object.keys(C)) C[k][1] = recCell(P, 'bsk', k, SF, bands, aiMode(ql));
  if (Object.keys(SF).length && SQ_W.test(ql) && P.ext.rec && P.ext.rec.bsk && kd === 'ip' && !/таблиц/.test(ql)) return sizeAnswer(P, ql, 'bsk', SF, bands, aiMode(ql), KD[kd]);
  const note = 'мультивей: до флопа был один рейз (не мой), я его заколлировал, на флопе трое и больше; ' + (kd === 'ip' ? 'на флопе хожу последним' : 'после меня на флопе ходит кто-то ещё') + '; B vs Skip — все до меня чекнули, я ставлю (тёрн — до меня прочекали, любой флоп; ривер — на ривере ещё трое и больше); B флоп + B тёрн — моя ставка на флопе заколлирована, на тёрне до меня прочекали, я снова ставлю; B-Fold — сбросил на рейз после своей ставки на флопе' + (bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '');
  const qw = noSize(ql), SUCC = /успешн|успех|все\s*сбрас/.test(qw), want0 = /фолд|fold/.test(qw.replace(/все\s*сбрас[а-яё]*/g, ' ')) ? 'ff' : /ривер/.test(qw) ? 'r' : /флоп/.test(qw) && /т[её]рн/.test(qw) ? 'bt' : /т[её]рн/.test(qw) ? 't' : 'f', want = SUCC && C[want0 + 'sx'] ? want0 + 'sx' : want0;
  if ((want !== 'f' && !TBL_W.test(ql) && !/(^|[^а-яё])мои(?![а-яё])/.test(ql)) || (!WANT_TABLE.test(ql) && !TBL_W.test(ql) && !/таблиц|все|по\s*улиц|ставки|ставок|б[еэ]т(ы|ов)/.test(ql) && !(/(^|[^а-яё])мои(?![а-яё])/.test(ql) && want === 'f'))) { const k = C[want]; return [{ type: 'big', hm: k[1].hm, title: title(P) + ' — ' + k[0] + KD[kd] + SFT, big: k[1].na ? 'не зависит от названного размера' : k[1].n ? k[1].v : 'нет данных', n: k[1].n, note }]; }
  return [{ type: 'table', title: title(P) + ' — ставка на пропуск' + KD[kd] + SFT, note: (SFT ? 'все клетки — только раздачи с этим размером ставки; «—» — клетка до этой улицы или на другой линии; ' : '') + note, table: { head: [kd === 'ip' ? 'IP' : 'OOP', 'Flop', 'Turn', 'River'], rows: [['B vs Skip', C.f[1], C.t[1], C.r[1]], ['B флоп + B тёрн', '', C.bt[1], ''], ['B-Fold', C.ff[1], '', ''], ['B vs Skip успешность', C.fsx[1], C.tsx[1], C.rsx[1]], ['B флоп + B тёрн успешность', '', C.btsx[1], '']], grid: true } }];
}// ---------- таблицы постфлопа по записям раздач с фильтром размера ставки (26.11.2026) ----------
// размер в вопросе («сайзингом до 33%», «тёрн 50%», «отложка от 40 до 60%», «флоп треть») — все клетки считаются только по раздачам с этим размером на этой улице;
// клетки другой улицы (без шага на ней) — «—». Без размера — общие цифры.
const SZB = [[0, 29], [29, 40], [40, 58], [58, 70], [70, 88], [88, 100.5], [100.5, 100000]]; /* овербет — больше банка (владелец 26.11.2026) */
/* «маленькая ставка», «мелкий конбет», «мелкую по флопу» — до трети банка (27.11.2026: и без слова «ставка»; «маленькие стеки» — не размер) */
const SMALL_RE = /(маленьк|мелк)[а-яё]*(?![а-яё])(?!\s*(стек|блайнд|позиц|лимит|бай))(\s*(ставк|б[еэ]т|бэт|конбет|цбет|комбет|контбет|c-?bet|сайз)[а-яё]*)?/;
function sizeFilters(ql) {
  const out = {}, put = (pos, lo, hi, after, end) => { if (end != null) { const w3 = ql.slice(end, end + 14); for (const [re, k] of [[/^\s*(на|по)\s*флоп/, 'f'], [/^\s*(на|по)\s*т[её]рн/, 't'], [/^\s*(на|по)\s*ривер/, 'r']]) if (re.test(w3)) { out[k] = [lo, hi]; return; } } /* «больше 60% на флопе» — улица сразу после размера (27.11.2026) */ if (after) { const w2 = ql.slice(pos, pos + 18); for (const [re, k] of [[/^\s*((на|по)\s*)?флоп/, 'f'], [/^\s*((на|по)\s*)?т[её]рн/, 't'], [/^\s*((на|по)\s*)?ривер/, 'r']]) if (re.test(w2)) { out[k] = [lo, hi]; return; } } const w = ql.slice(Math.max(0, pos - 45), pos); let st = 'f', best = -1; for (const [re, k] of [[/отлож|дил[еэ]й|delay/g, 'dt'], [/ривер/g, 'r'], [/т[её]рн/g, 't'], [/флоп/g, 'f']]) { let mm; while ((mm = re.exec(w))) if (mm.index > best) { best = mm.index; st = k; } } if (best >= 0 && st !== 'dt' && w.lastIndexOf('после') > best) { out.f = [lo, hi]; return; } /* «на тёрне после конбета больше 60%» — размер более ранней ставки: флоп (27.11.2026) */ if (best < 0) { const w2 = ql.slice(pos, pos + 30); let b2 = 1e9; for (const [re, k] of [[/отлож|дил[еэ]й|delay/g, 'dt'], [/ривер/g, 'r'], [/т[её]рн/g, 't'], [/флоп/g, 'f']]) { const mm = re.exec(w2); if (mm && mm.index < b2) { b2 = mm.index; st = k; } } } out[st] = [lo, hi]; }; /* слово улицы — перед размером, иначе сразу после (« овербет ривера», «33% на тёрне») */ /* улица — ближайшее слово перед размером */
  let m; const re = /(?:(от|больше|выше|свыше|более)\s*(\d{1,3})\s*%?\s*(?:до\s*(\d{1,3}))?|(до|меньше|ниже|менее)\s*(\d{1,3})|(\d{1,3}))\s*(?:%|процент[а-яё]*|прц)/g;
  while ((m = re.exec(ql))) { const e = m.index + m[0].length; if (m[2]) put(m.index, +m[2], m[3] ? +m[3] + 0.5 : 100000, 0, e); else if (m[5]) put(m.index, 0, +m[5] + 0.5, 0, e); else if (m[6]) { const v = +m[6], b = SZB.find(([lo, hi]) => v >= lo && v < hi) || SZB[0]; put(m.index, b[0], b[1], 0, e); } }
  { const ob = /овер\s*-?\s*б[еэ]т[а-яё]*|overbet/.exec(ql); if (ob) put(ob.index + ob[0].length, 100.5, 100000, 1); } { const gp = /(больше|выше|свыше|более|крупнее)\s*(пота|банка|пот|банк)(?![а-яё])/.exec(ql); if (gp) put(gp.index + gp[0].length, 100.5, 100000, 1); } /* «больше пота / банка» — овербет (27.11.2026) */ /* овербет — всё, что больше банка (владелец 26.11.2026) */
  { const sm = SMALL_RE.exec(ql); if (sm) put(sm.index + sm[0].length, 0, 33.5, 1); } /* маленькая ставка — до трети банка (владелец 26.11.2026) */
  { const pb = /(под|пот)\s*-?\s*б[еэ]т[а-яё]*|pot\s*-?\s*bet/.exec(ql); if (pb) put(pb.index + pb[0].length, 88, 100.5, 1); } /* подбет (пот-бет) — ставка в банк, корзина ~100%: 88–100% (владелец 26.11.2026) */ /* овербет — больше банка (как в таблице сайзингов: 115%+); улица — слово рядом */
  const W = [[/четверт[а-яё]*\s*(банка|пота)?/, 25], [/(?<!две\s)трет[а-яё]*\s*(банка|пота)?/, 33], [/половин[а-яё]*\s*(банка|пота)?|пол\s*банка|пол\s*пота/, 50], [/две\s*трет[а-яё]*/, 66], [/(в|на)\s*(весь\s*)?(банк|пот)(?![а-яё])|размер[а-яё]*\s*(в\s*)?(банк|пот)[а-яё]*|(в|на)\s*(весь\s*)?пот(?![а-яё])|пот\s*-?\s*сайз[а-яё]*/, 100]];
  for (const [r, v] of W) { const mm = new RegExp(r.source).exec(ql); if (mm && /сайз|разм[еи]р|ставк|ставок|ставл|б[еэ]т|bet|cb|конбет|цбет|отлож|пропуск|skip/.test(ql)) { const pre = ql.slice(Math.max(0, mm.index - 14), mm.index); if (/(больше|от|свыше|более|выше)\s*$/.test(pre)) put(mm.index, v, 100000); else if (/(меньше|до|менее|ниже)\s*$/.test(pre)) put(mm.index, 0, v + 0.5); else { const b = SZB.find(([lo, hi]) => v >= lo && v < hi); put(mm.index, b[0], b[1]); } } } /* «больше половины пота» — от 50%, «до трети» — до 33% (26.11.2026) */
  return out;
}
/* текст вопроса без размеров: слова улиц внутри размера («ривер от 50%») не выбирают клетку */
const noSize = (ql) => ql.replace(/размер[а-яё]*\s*(в\s*)?(банк|пот)[а-яё]*|(в|на)\s*(весь\s*)?пот(?![а-яё])|пот\s*-?\s*сайз[а-яё]*/g, ' ').replace(/((овер|под|пот)\s*-?\s*б[еэ]т[а-яё]*|(маленьк|мелк)[а-яё]*(?![а-яё])(?!\s*(стек|блайнд|позиц|лимит|бай))(\s*(ставк|б[еэ]т|бэт|конбет|цбет|комбет|контбет|c-?bet|сайз)[а-яё]*)?)\s*((на|по)\s*)?(флоп[а-яё]*|т[её]рн[а-яё]*|ривер[а-яё]*)?|overbet|pot\s*-?\s*bet/g, ' ').replace(/(\d{1,3}\s*(%|процент[а-яё]*|прц))\s*(на\s*)?(флоп[а-яё]*|т[её]рн[а-яё]*|ривер[а-яё]*)/g, '$1').replace(/(флоп[а-яё]*|т[её]рн[а-яё]*|ривер[а-яё]*|отлож[а-яё]*|дил[еэ]й)?\s*(сайзинг[а-яё]*\s*|размер[а-яё]*\s*)?((от|больше|выше|свыше|более)\s*\d{1,3}\s*%?\s*(до\s*\d{1,3})?|(до|меньше|ниже|менее)\s*\d{1,3}|\d{1,3})\s*(%|процент[а-яё]*|прц)/g, ' ').replace(/(флоп[а-яё]*|т[её]рн[а-яё]*|ривер[а-яё]*|отлож[а-яё]*)?\s*(четверт[а-яё]*|половин[а-яё]*|две\s*трет[а-яё]*|трет[а-яё]*)\s*(банка|пота)?/g, ' ');
const fltTxt = (F) => Object.entries(F).map(([k, [lo, hi]]) => ({ f: 'флоп', t: 'тёрн', r: 'ривер', dt: 'отложка на тёрне' })[k] + ' ' + (hi >= 100000 ? (lo === 100.5 ? 'больше банка' : 'от ' + lo + '%') : lo <= 0 ? 'до ' + Math.floor(hi) + '%' : lo + '–' + Math.floor(hi) + '%')).join(', ');
/* шаги: o — возможность, d — ставка, s — размер, st — улица фильтра */
const RS = { F: { o: 2, d: 3, s: 4, st: 'f' }, T: { o: 7, d: 8, s: 9, st: 't' }, R: { o: 10, d: 11, s: 12, st: 'r' }, DT: { o: 13, d: 14, s: 15, st: 'dt' }, DR: { o: 16, d: 17, s: 18, st: 'r' }, PB: { o: 19, d: 20, s: 21, st: 'r' }, BT: { o: 13, d: 14, s: 15, st: 't' }, AT: { o: 22, d: 23, s: 24, st: 't' }, AR: { o: 25, d: 26, s: 27, st: 'r' }, BAR: { o: 16, d: 17, s: 18, st: 'r' } };
/* …sx — успешность ставки: все сбросили сразу после моей ставки на этой улице (владелец 26.11.2026) */
const RCH = { cb: { f: ['F'], t: ['F', 'T'], r: ['F', 'T', 'R'], dt: ['DT'], dr: ['DR'], pb: ['DT', 'PB'], ff: ['F'], fc: ['F'], fr: ['F'], at: ['AT'], ar: ['AR'], fsx: ['F'], tsx: ['F', 'T'], rsx: ['F', 'T', 'R'], dtsx: ['DT'], drsx: ['DR'], pbsx: ['DT', 'PB'] }, bsk: { f: ['F'], t: ['T'], r: ['R'], bt: ['F', 'BT'], ff: ['F'], at: ['T'], ar: ['BAR'], fsx: ['F'], tsx: ['T'], rsx: ['R'], btsx: ['F', 'BT'] } };
const SX_OUT = { cb: 31, bsk: 22 }, ST_I = { f: 0, t: 1, dt: 1, r: 2 };
function recSel(P, kind, cell, F, bands, mode) {
  const R = (P.ext.rec && P.ext.rec[kind]) || [], ch = RCH[kind === 'bsk' ? 'bsk' : 'cb'][cell], sts = ch.map(k => RS[k].st);
  /* фильтр на улице, которой нет в цепочке клетки, — клетка «—» (у «тёрн» фильтр и отложка, и обычная ставка на тёрне) */
  for (const k of Object.keys(F)) { const ok = sts.includes(k) || (k === 't' && sts.includes('dt')); if (!ok) return null; }
  const inS = (step, r) => { const f = F[step.st] || (step.st === 'dt' ? F.t : null); return !f || (r[step.s] >= f[0] && r[step.s] < f[1]); };
  const bs = new Set(bands), den = [], num = [];
  for (const r of R) { if (!bs.has(r[0])) continue; let ok = true; for (let i = 0; i < ch.length - 1; i++) { const st = RS[ch[i]]; if (!(r[st.d] && inS(st, r))) { ok = false; break; } } if (!ok) continue; const last = RS[ch[ch.length - 1]];
    if (/sx$/.test(cell)) { if (!(r[last.d] && inS(last, r))) continue; den.push(r); if (r[SX_OUT[kind === 'bsk' ? 'bsk' : 'cb'] + ST_I[last.st]] === 1) num.push(r); continue; }
    if (['ff', 'fc', 'fr'].includes(cell)) { if (!(r[last.d] && inS(last, r) && r[5])) continue; if (cell === 'fr' ? r[6] : mode === 'ai' ? !r[6] : mode === 'nai' ? r[6] : false) continue; den.push(r); if (r[5] === { ff: 1, fc: 2, fr: 3 }[cell]) num.push(r); continue; }
    if (!r[last.o]) continue; den.push(r); if (r[last.d] && inS(last, r)) num.push(r); }
  return { den, num };
}
/* ---------- линии и успешность ставок в мультивее (ext.ml; 26.11.2026) ----------
   ml[rIP|rOOP|cIP|cOOP] = [стек, рука, линия флоп, тёрн, ривер, ставка % банка флоп, тёрн, ривер, после ставки/рейза (1 все сбросили, 2 колл, 3 рейз) флоп, тёрн, ривер, вскрытие, выиграл на вскрытии, выиграл банк, соперников, сила (0 ничего … 4 сильная), рейз ×10 флоп, тёрн, ривер] */
const MWL_W = /успешн|успех|эффективн|сработ|(по\s*)?лини(и|ям|я|ю|ей)(?![а-яё])/;
const ML_KD = { rIP: 'рейзер в позиции', rOOP: 'рейзер без позиции', cIP: 'коллер в позиции', cOOP: 'коллер без позиции' };
const RXB = [[0, 25, 'рейз до ×2,5'], [25, 30, 'рейз ×2,5–3'], [30, 35, 'рейз ×3–3,5'], [35, 40, 'рейз ×3,5–4'], [40, 50, 'рейз ×4–5'], [50, 1e9, 'рейз ×5 и больше']];
const SZL = ['ставка до 29%', 'ставка ~33%', 'ставка ~50%', 'ставка ~66%', 'ставка ~75%', 'ставка ~100% (потбет)', 'овербет (больше банка)'];
const LINES_OFF = true, LINES_OFF_TXT = 'Линии в мультивее пока не показываю — они считаются, покажу их позже в новом виде.';
const ACT_RU = { X: 'чек', B: 'бет', C: 'колл', R: 'рейз', F: 'фолд' };
const lineRu = (r) => [r[2], r[3], r[4]].filter(Boolean).map(a => ({ X: 'чек', B: 'бет', C: 'колл', R: 'рейз', F: 'фолд', XC: 'чек-колл', XF: 'чек-фолд', XR: 'чек-рейз', BC: 'бет-колл', BF: 'бет-фолд', BR: 'бет-рейз', XRC: 'чек-рейз-колл', XRF: 'чек-рейз-фолд', BRC: 'бет-3бет-колл' })[a] || a.split('').map(c => ACT_RU[c]).join('-')).join(' · ');
function mlKind(ql) { const OOP = /без\s*позиц|вне\s*позиц|не\s*в\s*позиц|без\s*поз[ыу](?![а-яё])|вне\s*поз[ыу](?![а-яё])|(^|[^a-z])oop([^a-z]|$)|out\s*of\s*position/, oop = OOP.test(ql), ip = !oop && /(^|[^а-яё])в\s*позиц|(^|[^а-яё])в\s*поз[еу](?![а-яё])|(^|[^a-z])ip([^a-z]|$)|in\s*position/.test(ql), r = ROLE_R.test(ql), c = ROLE_C.test(ql); if ((!r && !c) || (!ip && !oop)) return null; return (c && !r ? 'c' : 'r') + (oop ? 'OOP' : 'IP'); }
function mwlBlocks(P, ql, o) {
  const kd = mlKind(ql); if (!kd) return [{ type: 'text', text: 'Успешность ставок в мультивее храню для четырёх случаев: как рейзер / как коллер, в позиции / без позиции. Скажите, например: «успешность моих ставок в мультивее как рейзер в позиции», «успешность чек-рейза на флопе в мультивее как коллер без позиции».' }];
  const { bands } = o, R = ((P.ext.ml && P.ext.ml[kd]) || []).filter(r => bands.includes(r[0])), st = bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '';
  const head = ' в мультивее, ' + ML_KD[kd], qw = noSize(ql), SF = sizeFilters(ql);
  const pc = (a, b) => (b ? { v: pctS(a, b), n: b } : { v: '—', n: 0 });
  /* названная линия: «чек бет бет», «бет-чек-бет» — первое действие на каждой улице */
  /* названная линия: «чек бет бет» — по улицам; через дефис («чек-рейз», «бет-фолд») — ходы на одной улице (26.11.2026) */
  const CODE = { бет: 'B', чек: 'X', кол: 'C', колл: 'C', рейз: 'R', фолд: 'F' };
  const lw = [...qw.matchAll(/(^|[^а-яё])(чек|бет)\s*-\s*(рейз|колл?|фолд)[а-яё]?(?![а-яё])|(^|[^а-яё])(бет|чек|колл?|рейз|фолд)(?![а-яё])/g)].map(m => (m[2] ? CODE[m[2]] + CODE[m[3]] : CODE[m[5]]));
  const namedLine = !/по\s*лини/.test(ql) && (lw.length >= 2 || (lw.length === 1 && lw[0].length === 2)) ? lw : null;
  const onlyR = /(^|[^а-яё])(рейз(ов|ы|ами|ах|ом)|рейзы)(?![а-яё])/.test(qw) && !/ставк|ставок|бет(ов|ы)/.test(qw); /* «мои рейзы» — только рейзы */
  const sfK = Object.keys(SF).map(k => ({ f: 0, t: 1, dt: 1, r: 2 })[k]); /* назван размер — улица из него */
  const streets = sfK.length ? [...new Set(sfK)].sort() : /флоп/.test(qw) && !/т[её]рн|ривер/.test(qw) ? [0] : /т[её]рн/.test(qw) && !/флоп|ривер/.test(qw) ? [1] : /ривер/.test(qw) && !/флоп|т[её]рн/.test(qw) ? [2] : [0, 1, 2];
  const SN = ['флоп', 'тёрн', 'ривер'];
  /* успешность ставок по размерам на улице */
  /* успешность по размерам на улице (владелец 26.11.2026): «ставки» — только ставки, «рейзы» — только рейзы; колонки — раз, все сбросили, колл, рейз на меня */
  const sizeTable = (rows, s, ttl, what) => { const T = [], w = what || (onlyR ? 'r' : 'b'), ag = rows.filter(r => (w !== 'r' && r[5 + s]) || (w !== 'b' && r[16 + s]));
    const add = (lab, xs) => { if (!xs.length) return; T.push([lab, { v: String(xs.length), n: 0 }, pc(xs.filter(r => r[8 + s] === 1).length, xs.length), pc(xs.filter(r => r[8 + s] === 2).length, xs.length), pc(xs.filter(r => r[8 + s] === 3).length, xs.length)]); };
    const fs = SF[['f', 't', 'r'][s]];
    /* соседние размеры с одинаковыми цифрами — одной строкой (владелец 26.11.2026): «ставка до 29%» + «~33%» → «ставка до 40%»; размеры без ставок не показываем */
    const sig = (xs) => [xs.length, ...[1, 2, 3].map(o => xs.filter(r => r[8 + s] === o).length)].join(',');
    const addMerged = (groups, labOf) => { const out = []; for (const g of groups) { if (!g.xs.length) continue; const p = out[out.length - 1]; if (p && p.hi === g.lo && sig(p.xs) === sig(g.xs)) { p.hi = g.hi; p.xs = p.xs.concat(g.xs); p.merged = true; } else out.push({ ...g }); } out.forEach(g => add(g.merged ? labOf(g.lo, g.hi) : g.lab, g.xs)); };
    if (w !== 'r') addMerged(SZB.map(([lo, hi], i) => ({ lo, hi, lab: SZL[i], xs: ag.filter(r => r[5 + s] && r[5 + s] >= lo && r[5 + s] < hi && (!fs || (r[5 + s] >= fs[0] && r[5 + s] < fs[1]))) })), (lo, hi) => (hi >= 1e5 ? 'ставка от ' + lo + '%' : lo <= 0 ? 'ставка до ' + Math.floor(hi) + '%' : 'ставка ' + lo + '–' + Math.floor(hi) + '%'));
    if (w !== 'b' && !fs) addMerged(RXB.map(([lo, hi, lab]) => ({ lo, hi, lab, xs: ag.filter(r => r[16 + s] && r[16 + s] >= lo && r[16 + s] < hi) })), (lo, hi) => (hi >= 1e5 ? 'рейз от ×' + String(lo / 10).replace('.', ',') : lo <= 0 ? 'рейз до ×' + String(hi / 10).replace('.', ',') : 'рейз ×' + String(lo / 10).replace('.', ',') + '–' + String(hi / 10).replace('.', ',')));
    if (!fs && ag.length) add(w === 'r' ? 'все мои рейзы' : w === 'b' ? 'все мои ставки' : 'все мои ставки и рейзы', ag);
    return { type: 'table', title: title(P) + ' — ' + ttl, note: (w === 'r' ? 'по каждому моему рейзу (во сколько раз больше ставки, на которую рейзю)' : 'по каждой моей ставке (размер — % банка перед ставкой)') + ' на ' + SN[s] + 'е: все сбросили — забрал банк сразу; колл — меня заколлировали; рейз на меня — меня порейзили' + st,
      table: { head: ['размер', 'раз', 'успешность (все сбросили)', 'колл', 'рейз на меня'], rows: T, grid: true } }; };







  /* линии из нескольких улиц и таблица линий пока скрыты (владелец 26.11.2026): считаются в ext.ml, покажем по-новому позже */
  if (LINES_OFF && (TLN_SEQ.test(ql) || (namedLine && namedLine.length >= 2) || (!namedLine && (/лини/.test(ql) && !/успешн|успех|эффективн|сработ/.test(ql) || /по\s*лини/.test(ql))))) return [{ type: 'text', text: LINES_OFF_TXT }];
  if (namedLine) {
    const one = namedLine.length === 1, s1 = one ? (streets.length === 1 ? streets[0] : 0) : -1; /* одна связка ходов («чек-рейз») — на названной улице, иначе на флопе */
    const mine = one ? R.filter(r => (r[2 + s1] || '').startsWith(namedLine[0])) : R.filter(r => namedLine.every((a, i) => (r[2 + i] || '').startsWith(a)));
    const lt = one ? namedLine[0].split('').map(a => ACT_RU[a]).join('-') + ' на ' + SN[s1] + 'е' : namedLine.map(a => a.split('').map(c => ACT_RU[c]).join('-')).join(' · '), sd = mine.filter(r => r[11]);
    const card = { type: 'table', title: title(P) + ' — линия ' + lt + head, note: 'линия — мои действия по улицам (через дефис — ходы на одной улице: чек-рейз, бет-фолд); велью — топ-пара и сильнее на последней моей улице, блеф — дро или ничего' + st,
      table: { head: ['', 'значение'], rows: [['Раздач с этой линией', { v: String(mine.length), n: 0 }], ['Велью', pc(mine.filter(r => r[15] >= 3).length, mine.length)], ['Блеф', pc(mine.filter(r => r[15] <= 1).length, mine.length)], (() => { const la = mine.filter(r => [r[10], r[9], r[8]].find(v => v)); return ['Успешность последней ставки — все сбросили', pc(la.filter(r => [r[10], r[9], r[8]].find(v => v) === 1).length, la.length)]; })(), ['Выиграл банк', pc(mine.filter(r => r[13]).length, mine.length)], ['Дошло до вскрытия', pc(sd.length, mine.length)], ['Выиграл на вскрытии', pc(sd.filter(r => r[12]).length, sd.length)]], grid: true } };
    if (one) return [card, ...(/[BR]/.test(namedLine[0]) ? [sizeTable(mine, s1, (/R/.test(namedLine[0]) ? 'рейзы' : 'ставки') + ' на ' + SN[s1] + 'е в линии ' + lt + head, /R/.test(namedLine[0]) ? 'r' : 'b')] : [])];
    return [card, ...namedLine.map((a, s) => /[BR]/.test(a) && streets.includes(s) ? sizeTable(mine, s, (/R/.test(a) ? 'рейзы' : 'ставки') + ' на ' + SN[s] + 'е в линии ' + lt + head, /R/.test(a) ? 'r' : 'b') : null).filter(Boolean)];
  }
  if (/лини/.test(ql) && !/успешн|успех|эффективн|сработ/.test(ql) || /по\s*лини/.test(ql)) {
    /* линии (владелец 26.11.2026): линия — моё действие на каждой улице по порядку: «бет», «бет · бет», «бет · бет · бет», «чек · бет»…;
       в «бет» входят ВСЕ раздачи, где я поставил на флопе, чем бы они ни кончились. Частота — как часто играю эту линию в споте;
       забрал банк — все сбросили на мою ставку на последней улице линии. Действие на улице: бет, чек, чек-рейз, колл, рейз, фолд */
    const act = (a) => (!a ? '' : a[0] === 'X' && a.includes('R') ? 'XR' : a[0]), AN = { B: 'бет', X: 'чек', XR: 'чек-рейз', C: 'колл ставки', R: 'рейз ставки', F: 'фолд на ставку' }; /* C / R / F первым ходом на улице — ставка была до меня (это не чек-фолд) */
    const G = {}; for (const r of R) { const ks = []; for (let s = 0; s < 3; s++) { const a = act(r[2 + s]); if (!a) break; ks.push(a); const k = ks.join('|'); (G[k] = G[k] || { s, xs: [] }).xs.push(r); } }
    /* только самые частые связки (владелец 26.11.2026): линии из 2–3 улиц, 10 самых частых, от 1% раздач спота */
    const tot = R.length, rows = Object.entries(G).filter(([k, g]) => k.includes('|') && g.xs.length >= 3 && g.xs.length >= tot * 0.01).sort((a, b) => b[1].xs.length - a[1].xs.length).slice(0, 10).map(([k, g]) => { const parts = k.split('|'), last = parts[parts.length - 1], ag = /B|R/.test(last);
      return [parts.map(p => AN[p]).join(' · '), { v: String(g.xs.length), n: 0 }, pc(g.xs.length, tot), ag ? pc(g.xs.filter(r => r[8 + g.s] === 1).length, g.xs.length) : last === 'X' ? (() => { /* линия кончается чеком: на ставку после моего чека — колл / фолд (владелец 26.11.2026) */ const fb = g.xs.filter(r => /^X[CF]/.test(r[2 + g.s] || '')); if (!fb.length) return { v: 'ставок не было', n: 0 }; const cl = fb.filter(r => /^XC/.test(r[2 + g.s])).length, fo = fb.length - cl; return { v: 'колл ' + pctS(cl, fb.length) + ' · фолд ' + pctS(fo, fb.length), n: fb.length }; })() : { v: '—', n: 0 }]; });
    return [{ type: 'table', title: title(P) + ' — мои линии' + head, note: 'линия — моё действие на каждой улице по порядку (флоп · тёрн · ривер); в линию «бет» входят все раздачи, где я поставил на флопе, в «бет · бет» — где поставил на флопе и тёрне, и т. д.; частота — доля раздач спота, где играю эту линию; забрал банк — линия кончается ставкой: все сбросили на неё; ответ на ставку — линия кончается чеком: мне поставили после чека на последней улице, я заколлировал или сбросил (из раз, когда поставили); показаны 10 самых частых связок из двух-трёх улиц (от 1% раздач)' + st,
      table: { head: ['линия', 'раздач', 'частота', 'забрал банк / ответ на ставку'], rows, grid: true } }];
  }
  return streets.map(s => sizeTable(R, s, 'успешность ' + (onlyR ? 'рейзов' : 'ставок') + ' на ' + SN[s] + 'е' + head));
}
/* вопрос про сам размер (26.11.2026): «как часто ставлю овербет ривера», «как часто конбет 33% и выигрыш на вскрытии» —
   как часто ставлю этот размер, доля среди моих ставок на этой улице, дошло до вскрытия, выиграл на вскрытии */
const SQ_W = /как\s*часто|частот|сколько\s*раз|использ|выигр|шоу?\s*-?\s*даун|вскрыт|showdown/;
function sizeAnswer(P, ql, kind, SF, bands, mode, kdTxt) {
  const bsk = kind === 'bsk', qw = noSize(ql), keys = Object.keys(SF), ord = { f: 0, t: 1, dt: 1, r: 2 }, ts = keys.sort((a, b) => ord[b] - ord[a])[0];
  let cell;
  if (bsk) cell = ts === 'f' ? 'f' : ts === 'r' ? 'ar' : 't';
  else if (/отлож|дил[еэ]й|delay/.test(ql) || ts === 'dt') cell = ts === 'r' ? 'dr' : 'dt';
  else if (/(\+|плюс)\s*б[еэ]т/.test(qw)) cell = 'pb';
  else if (/конбет|цбет|c-?bet|комбет|контбет|(^|[^a-zа-яё])(cb|си\s*бет)/.test(qw)) cell = ts === 'f' ? 'f' : ts === 'r' ? 'r' : 't';
  else cell = ts === 'f' ? 'f' : ts === 'r' ? 'ar' : 'at';
  const SFx = Object.assign({}, SF); delete SFx[ts]; if (cell === 'dt' || cell === 'pb') { delete SFx.dt; if (cell === 'dt') delete SFx.t; }
  const a = recSel(P, kind, cell, SF, bands, mode), b = recSel(P, kind, cell, SFx, bands, mode);
  if (!a || !b) return [{ type: 'text', text: 'Для этого размера и этой улицы такой ставки не бывает — уточните улицу.' }];
  const SDI = bsk ? 19 : 28, sd = a.num.filter(r => r[SDI]), won = sd.filter(r => r[SDI + 1]), wonAll = a.num.filter(r => r[SDI + 2]), SI = (bsk ? 22 : 31) + ({ f: 0, t: 1, at: 1, dt: 1 }[cell] != null ? { f: 0, t: 1, at: 1, dt: 1 }[cell] : 2), succ = a.num.filter(r => r[SI] === 1); /* выиграл банк — и без вскрытия, и на вскрытии */
  const LBL = { f: bsk ? 'ставка в пропуск на флопе' : 'конбет на флопе', t: bsk ? 'ставка в пропуск на тёрне' : 'конбет на тёрне', r: 'конбет на ривере', at: 'ставка на тёрне (любая линия)', ar: bsk ? 'ставка в пропуск на ривере (любая линия)' : 'ставка на ривере (любая линия)', dt: 'отложенная ставка на тёрне', dr: 'отложенная ставка на ривере', pb: '+Bet на ривере' }[cell];
  const c = (x, d) => (d ? { v: pctS(x, d), n: d } : { v: '—', n: 0 });
  return [{ type: 'table', title: title(P) + ' — ' + LBL + ', размер ' + fltTxt({ [ts]: SF[ts] }).replace(/^\S+\s(на\s\S+\s)?/, '') + kdTxt, note: 'как часто ставлю — из всех раз, когда до меня прочекали (была возможность поставить); доля — среди всех моих ставок на этой улице в этом споте; выиграл банк, вскрытие и выигрыш на вскрытии — в раздачах, где я поставил этот размер' + (keys.length > 1 ? '; ещё фильтр: ' + fltTxt(SFx) : '') + (bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : ''),
    table: { head: ['', 'значение'], rows: [['Как часто ставлю этот размер', c(a.num.length, a.den.length)], ['Доля среди моих ставок на этой улице', c(a.num.length, b.num.length)], ['Успешность — все сбросили сразу на эту ставку', c(succ.length, a.num.length)], ['Выиграл банк (все сбросили или на вскрытии)', c(wonAll.length, a.num.length)], ['Дошло до вскрытия', c(sd.length, a.num.length)], ['Выиграл на вскрытии', c(won.length, sd.length)]], grid: true } }];
}
function recCell(P, kind, cell, F, bands, mode) { const x = recSel(P, kind, cell, F, bands, mode); if (!x) return { v: '—', n: 0, na: 1 }; const d = x.den.length; return d ? { v: pctS(x.num.length, d), n: d, hm: /^alias:/.test(P.key || '') ? { rec: kind, cell, F, b: bands.length === BANDS.length ? 'all' : bands.join(','), mode, k: P.key } : undefined } : { v: '—', n: 0 }; }
function recHm(R) { const r = qKey.get(String(R.k)); if (!r) return null; const P = load(r), bands = R.b === 'all' ? BANDS : String(R.b).split(','), x = recSel(P, R.rec, R.cell, R.F || {}, bands, R.mode || 'all'); if (!x) return null; const out = {}; for (const z of x.den) { const c = out[z[1]] = out[z[1]] || [0, 0]; c[0]++; } for (const z of x.num) out[z[1]][1]++; return out; }
// ---------- изолейт по позициям (алиас — ext.iso; сверено с таблицей владельца 24.11.2026) ----------
// строки: против 1 лимпера / ISO Fold / против 2+ лимперов / ISO Fold; ISO Fold — изолировали, лимпер ответил рейзом (3-бет / пуш), мы сбросили
const IPOS = ['TOT', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
function isoGet(P, pos, L, bs) { const x = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (const b of bs) { const r = P.ext.iso[pos] && P.ext.iso[pos][L] && P.ext.iso[pos][L][b]; if (r) for (let j = 0; j < 9; j++) x[j] += r[j] || 0; } return x; }
function isoBlocks(P, ql, o) {
  const { bands, PL, pos } = o, mode = aiMode(ql), L1 = /(одн[а-яё]*|1)\s*(-?го\s*)?лимп/.test(ql), L2 = /(дв[а-яё]*|2\s*\+?|нескольк[а-яё]*|многих|больше)\s*(и\s*больше\s*)?лимп/.test(ql), Ls = L1 && !L2 ? [1] : L2 && !L1 ? [2] : [1, 2];
  const cols = vPosList(PL) ? ['TOT', ...vPosList(PL)].filter((p, i, a) => a.indexOf(p) === i && (PL.length > 1 ? p !== 'TOT' : true)) : (pos ? [pos === 'EP' ? 'MP' : pos] : IPOS);
  const isoV = (x) => (mode === 'nai' ? x[1] - x[2] : mode === 'ai' ? x[2] : x[1]), name = mode === 'nai' ? 'ISO NAI' : mode === 'ai' ? 'ISO AI' : 'ISO';
  const st = bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '';
  const note = 'первое решение против лимперов без рейза; BB — без лимпа одного SB (TOT — с ним); ISO Fold — изолировали, лимпер ответил 3-бетом или пушем, мы сбросили; Fold сзади — изолировали, рейз от игрока позади нас, мы сбросили' + st;
  // одна цифра: без «по позициям / таблица» и без позиции — общий изолейт (1 и 2+ лимпера вместе)
  if (!o.table && !PL && Ls.length === 2) { const PP = pos ? (pos === 'EP' ? 'MP' : pos) : 'TOT', a = isoGet(P, PP, 1, bands), b = isoGet(P, PP, 2, bands), x = a.map((v, j) => v + b[j]); return [{ type: 'big', hm: [HMref(P, 'iso|' + PP + '|1', mode === 'nai' ? 'isonai' : mode === 'ai' ? 'isoai' : 'iso', bands), HMref(P, 'iso|' + PP + '|2', mode === 'nai' ? 'isonai' : mode === 'ai' ? 'isoai' : 'iso', bands)].filter(Boolean), title: title(P) + ' — ' + name + (PP === 'TOT' ? '' : ' с ' + PP) + ' против лимперов', big: x[0] ? pctS(isoV(x), x[0]) : 'нет данных', n: x[0], ai: mode === 'nai' ? 'без олл-инов' : mode === 'ai' ? 'только олл-ины' : 'с олл-инами', note: 'vs 1 лимпер ' + pctS(isoV(a), a[0]) + ' · vs 2+ ' + pctS(isoV(b), b[0]) + (x[3] ? ' · ISO Fold ' + pctS(x[4], x[3]) + ' (' + x[3] + ' раз)' : '') + st }]; }
  const isoM = mode === 'nai' ? 'isonai' : mode === 'ai' ? 'isoai' : 'iso';
  if (cols.length === 1 && Ls.length === 1) { const x = isoGet(P, cols[0], Ls[0], bands); return [{ type: 'big', hm: HMref(P, 'iso|' + cols[0] + '|' + Ls[0], isoM, bands), title: title(P) + ' — ' + name + (cols[0] === 'TOT' ? '' : ' с ' + cols[0]) + ' против ' + (Ls[0] === 1 ? '1 лимпера' : '2+ лимперов'), big: x[0] ? pctS(isoV(x), x[0]) : 'нет данных', n: x[0], ai: mode === 'nai' ? 'без олл-инов' : mode === 'ai' ? 'только олл-ины' : 'с олл-инами', note: (x[3] ? 'ISO Fold ' + pctS(x[4], x[3]) + ' (' + x[3] + ' раз) · ' : '') + note }]; }
  const rows = [];
  for (const L of Ls) {
    rows.push([(L === 1 ? 'vs 1 лимпер' : 'vs 2+') + (mode === 'all' ? '' : ' · ' + (mode === 'nai' ? 'NAI' : 'AI')), ...cols.map(p => { const x = isoGet(P, p, L, bands); return { v: pctS(isoV(x), x[0]), n: x[0], hm: HMref(P, 'iso|' + p + '|' + L, isoM, bands) }; })]);
    rows.push(['ISO Fold', ...cols.map(p => { const x = isoGet(P, p, L, bands); return { v: pctS(x[4], x[3]), n: x[3], hm: HMref(P, 'iso|' + p + '|' + L, 'isofold', bands) }; })]);
  }
  // внизу: изолировали, рейз от игрока позади (не лимпера) — как часто сбрасываем (владелец, 24.11.2026)
  for (const L of Ls) rows.push(['Fold сзади (' + (L === 1 ? 'vs 1' : 'vs 2+') + ')', ...cols.map(p => { const x = isoGet(P, p, L, bands); return { v: pctS(x[8], x[7]), n: x[7], hm: HMref(P, 'iso|' + p + '|' + L, 'fsz', bands) }; })]);
  return [{ type: 'table', title: title(P) + ' — ' + name + ' по позициям', note, ai: mode === 'nai' ? 'без олл-инов' : mode === 'ai' ? 'только олл-ины' : 'с олл-инами', table: { head: ['', ...cols], rows, grid: true, heatRow: true } }];
}// ---------- оверколл: колл опена третьим в банк (1 коллер) и четвёртым+ (2+), по позициям (алиас — ext.oc; 24.11.2026) ----------
function ocGet(P, pos, C, bs) { const x = [0, 0, 0, 0]; for (const b of bs) { const r = P.ext.oc[pos] && P.ext.oc[pos][C] && P.ext.oc[pos][C][b]; if (r) for (let j = 0; j < 4; j++) x[j] += r[j]; } return x; }
function ocBlocks(P, ql, o) {
  const { bands, PL, pos } = o, c3 = /трет[а-яё]*|3\s*-?\s*[ийм]|кол[а-яё]*\s*3(?![\s,.]*(бб|bb|больш|блайнд|[0-9]))/.test(ql) || /(одн[а-яё]*|1)\s*колл?ер/.test(ql), c4 = /четв[её]рт[а-яё]*|4\s*-?\s*[ыйм]|кол[а-яё]*\s*4(?![\s,.]*(бб|bb|больш|блайнд|[0-9]))|дальше|(дв[а-яё]*|2\s*\+?|нескольк[а-яё]*)\s*колл?ер/.test(ql), Cs = c3 && !c4 ? [1] : c4 && !c3 ? [2] : [1, 2];
  // без «по позициям / таблица» и без позиции — одна цифра (TOT)
  const cols = vPosList(PL) ? vPosList(PL) : (pos ? [pos === 'EP' ? 'MP' : pos] : o.table ? IPOS : ['TOT']), LBL = { 1: 'Колл 3-м (1 коллер)', 2: 'Колл 4-м+ (2+ коллера)' };
  const st = bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '', note = 'колл одного опена (не олл-ин), когда до нас уже коллировали; лимпов до опена нет; TOT — без BB' + st, ai = 'колл — опен не олл-ин';
  if (cols.length === 1 && (Cs.length === 1 || !o.table)) {
    if (Cs.length === 1) { const x = ocGet(P, cols[0], Cs[0], bands); return [{ type: 'big', hm: HMref(P, 'oc|' + cols[0] + '|' + Cs[0], 'call', bands), title: title(P) + ' — ' + LBL[Cs[0]] + (cols[0] === 'TOT' ? '' : ' с ' + cols[0]), big: x[0] ? pctS(x[1], x[0]) : 'нет данных', n: x[0], ai, note }]; }
    const a = ocGet(P, cols[0], 1, bands), b = ocGet(P, cols[0], 2, bands), n = a[0] + b[0];
    return [{ type: 'big', title: title(P) + ' — колл третьим и дальше' + (cols[0] === 'TOT' ? '' : ' с ' + cols[0]), big: n ? pctS(a[1] + b[1], n) : 'нет данных', n, ai, note: '3-м ' + pctS(a[1], a[0]) + ' · 4-м+ ' + pctS(b[1], b[0]) + ' · ' + note }];
  }
  const rows = Cs.map(C => [LBL[C], ...cols.map(p => { const x = ocGet(P, p, C, bands); return { v: pctS(x[1], x[0]), n: x[0], hm: HMref(P, 'oc|' + p + '|' + C, 'call', bands) }; })]);
  return [{ type: 'table', title: title(P) + ' — колл ' + (Cs.length === 2 ? 'третьим и четвёртым' : Cs[0] === 1 ? 'третьим' : 'четвёртым и дальше') + ' в банк' + (cols.length > 1 ? ' по позициям' : ''), note, ai, table: { head: ['', ...cols], rows, grid: true, heatRow: true } }];
}// ---------- 3-бет против изолейта (алиас — ext.b3i): до меня лимп, его изолировали (не олл-ин), коллеров нет, я 3-бечу ----------
const B3I_RE = /(3\s*-?\s*бет[а-яё]*|трибет[а-яё]*|3b(et)?)\s*(против|vs\.?|на)\s*(изо|изол|iso)|против\s*изол[а-яё]*/;
function b3iBlocks(P, ql, o) {
  const { bands, PL, pos } = o, mode = aiMode(ql), k = mode === 'nai' ? [1] : mode === 'ai' ? [2] : [1, 2], name = '3bet vs ISO' + (mode === 'nai' ? ' NAI' : mode === 'ai' ? ' AI' : '');
  const get = (p) => { let n = 0, v = 0; for (const b of bands) { const r = P.ext.b3i[p] && P.ext.b3i[p][b]; if (r) { n += r[0]; for (const j of k) v += r[j]; } } return { n, v }; };
  const cols = vPosList(PL) || (pos ? [pos === 'EP' ? 'MP' : pos] : o.table ? IPOS : ['TOT']);
  const note = 'один лимпер, его изолировали (рейз не олл-ин), после изолейта никто не вошёл; мы 3-бетим' + (bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '');
  const ai = mode === 'nai' ? 'без олл-инов' : mode === 'ai' ? 'только олл-ины' : 'с олл-инами';
  const bm = mode === 'nai' ? 'nai' : mode === 'ai' ? 'ai' : 'b3all';
  if (cols.length === 1) { const r = get(cols[0]); return [{ type: 'big', hm: HMref(P, 'b3i|' + cols[0], bm, bands), title: title(P) + ' — ' + name + (cols[0] === 'TOT' ? '' : ' с ' + cols[0]), big: r.n ? pctS(r.v, r.n) : 'нет данных', n: r.n, ai, note }]; }
  return [{ type: 'table', title: title(P) + ' — ' + name + ' по позициям', note, ai, table: { head: ['', ...cols], rows: [[name, ...cols.map(p => { const r = get(p); return { v: pctS(r.v, r.n), n: r.n, hm: HMref(P, 'b3i|' + p, bm, bands) }; })]], grid: true } }];
}// ---------- размеры 3-бета (алиас — ext.s3; 24.11.2026): как часто какой размер и фолд на 4-бет, по стекам ----------
const S3_RE = /(3\s*-?\s*бет[а-яё]*|трибет[а-яё]*|3bet).{0,25}(сайз|размер)|(сайз|размер)[а-яё]*.{0,20}(3\s*-?\s*бет|трибет|3bet)/;
const S3LBL = (g) => (g === '05.0' ? 'до 5 bb' : g === '11.0' ? '11 bb и больше' : g === '09.5' ? '9,5–10,5 bb' : String(+g).replace('.', ',') + ' bb');
function s3Blocks(P, ql, o) {
  // строки — размеры сверху вниз; колонки — частота (доля среди 3-бетов) и Fold vs 4bet; стек — фильтр из вопроса (владелец, 24.11.2026)
  const pos = o.pos ? (o.pos === 'EP' ? 'MP' : o.pos) : 'TOT', S = P.ext.s3, bs = o.bands;
  const get = (g) => { const x = [0, 0, 0, 0]; for (const b of bs) { const r = S[g] && S[g][pos] && S[g][pos][b]; if (r) for (let j = 0; j < 4; j++) x[j] += r[j]; } return x; };
  const G = Object.keys(S).sort(), tot = G.reduce((a, g) => a + get(g)[0], 0);
  const rows = G.map(g => { const x = get(g); return x[0] ? [S3LBL(g), { v: pctS(x[0], tot), n: x[0], hm: HMref(P, 's3|' + pos, 'sz:' + g, bs, 'any') }, { v: pctS(x[3], x[2]), n: x[2], hm: HMref(P, 's3|' + pos, 'f4:' + g, bs) }] : null; }).filter(Boolean);
  const st = bs.length < BANDS.length ? 'стек ' + grpLabel('', bs) : 'все стеки';
  return [{ type: 'table', title: title(P) + ' — 3-беты по сайзам' + (pos === 'TOT' ? '' : ' с ' + pos), ai: 'без олл-инов',
    note: st + ' · всего 3-бетов ' + tot.toLocaleString('ru') + ' · размер — сколько всего ставим, в bb (округлено до 0,5); частота — доля этого размера среди 3-бетов; Fold vs 4bet — сбросили на 4-бет',
    table: { head: ['размер', 'частота', 'Fold vs 4bet'], rows, grid: true, heatCol: true } }];
}
// ---------- фолд на 3-бет после своего опена: общий / в позиции / без позиции, по позициям опена (алиас — ext.f3; 24.11.2026) ----------
const F3POS = ['TOT', 'EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'];
function f3Blocks(P, ql, o) {
  const { bands, PL, pos } = o, mode = aiMode(ql), vsAi = /против\s*(олл|пуш|ул[ыи]н)|на\s*(олл|пуш|ул[ыи]н)/.test(ql);
  // «в позиции» / «без позиции» / оба сразу — по словам вопроса
  const hasOop = /без\s*позиц|вне\s*позиц|не\s*в\s*позиц|(^|[^a-z])oop([^a-z]|$)/.test(ql), hasIp = /(^|[^а-яёa-z])(в\s*позиц|ip)([^a-z]|$)/.test(ql.replace(/не\s*в\s*позиц/g, ' '));
  const wSel = hasIp && hasOop ? ['ip', 'oop'] : hasOop ? ['oop'] : hasIp ? ['ip'] : ['all', 'ip', 'oop'];
  const get = (p, w) => { const x = [0, 0, 0, 0, 0, 0]; for (const b of bands) { const r = P.ext.f3[p] && P.ext.f3[p][w] && P.ext.f3[p][w][b]; if (r) for (let j = 0; j < 6; j++) x[j] += r[j]; } return x; };
  // «против олл-ина» — только 3-беты олл-ином; «без олл-ина» — только обычные 3-беты
  const val = (x) => (vsAi || mode === 'ai' ? [x[5], x[4]] : mode === 'nai' ? [x[1] - x[5], x[0] - x[4]] : [x[1], x[0]]);
  const fm = vsAi || mode === 'ai' ? 'foldai' : mode === 'nai' ? 'foldnai' : 'fold'; /* матрица фолда — по тому же фильтру олл-ина */
  const LBL = { all: 'Fold to 3bet', ip: 'в позиции (IP)', oop: 'без позиции (OOP)' }, cols = vPosList(PL) ? PL.filter(p => F3POS.includes(p)) : (pos ? [pos] : o.table ? F3POS : ['TOT']);
  const kind = vsAi || mode === 'ai' ? ' · против 3-бета олл-ином' : mode === 'nai' ? ' · против 3-бета не олл-ином' : '';
  const note = 'наш опен (не олл-ин) → ровно один 3-бет, никто не коллировал (сквиз — отдельно); IP — 3-бет с блайндов, OOP — сзади не с блайндов или мы на SB; TOT — без SB' + (bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '');
  const ai = vsAi || mode === 'ai' ? 'против олл-ина' : mode === 'nai' ? 'против 3-бета не олл-ином' : 'любой 3-бет';
  if (cols.length === 1 && wSel.length === 2 && !o.table) return wSel.map(w => { const v = val(get(cols[0], w)); return { type: 'big', hm: HMref(P, 'f3|' + cols[0] + '|' + w, fm, bands), title: title(P) + ' — фолд на 3-бет ' + LBL[w].replace(/ \(.*\)/, '') + (cols[0] === 'TOT' ? '' : ' с ' + cols[0]) + kind, big: v[1] ? pctS(v[0], v[1]) : 'нет данных', n: v[1], ai, note: w === 'ip' ? 'в позиции — 3-бет с блайндов' : 'без позиции — 3-бет сзади не с блайндов или мы на SB' }; });
  if (cols.length === 1 && wSel.length === 1) { const v = val(get(cols[0], wSel[0])); return [{ type: 'big', hm: HMref(P, 'f3|' + cols[0] + '|' + wSel[0], fm, bands), title: title(P) + ' — фолд на 3-бет' + (wSel[0] === 'all' ? '' : ' ' + LBL[wSel[0]].replace(/ \(.*\)/, '')) + (cols[0] === 'TOT' ? '' : ' с ' + cols[0]) + kind, big: v[1] ? pctS(v[0], v[1]) : 'нет данных', n: v[1], ai, note }]; }
  if (cols.length === 1 && !o.table) { const a = val(get(cols[0], 'all')), i = val(get(cols[0], 'ip')), oo = val(get(cols[0], 'oop')); return [{ type: 'big', hm: HMref(P, 'f3|' + cols[0] + '|all', fm, bands), title: title(P) + ' — фолд на 3-бет' + (cols[0] === 'TOT' ? '' : ' с ' + cols[0]) + kind, big: a[1] ? pctS(a[0], a[1]) : 'нет данных', n: a[1], ai, note: 'в позиции ' + pctS(i[0], i[1]) + ' · без позиции ' + pctS(oo[0], oo[1]) + ' · ' + note }]; }
  const rows = wSel.map(w => [LBL[w], ...cols.map(p => { const v = val(get(p, w)); return { v: pctS(v[0], v[1]), n: v[1], hm: HMref(P, 'f3|' + p + '|' + w, fm, bands) }; })]);
  return [{ type: 'table', title: title(P) + ' — фолд на 3-бет по позициям' + kind, note, ai, table: { head: ['', ...cols], rows, grid: true, heatRow: true } }];
}// ---------- колл 3-бета в холодную (ext.c3) и наши 4-беты после своего опена (ext.f3[..][6] — 4-бет олл-ином); 24.11.2026 ----------
const CC3_RE = /(колл?|кол|колд[\s-]*колл?)[а-яё]*\s*(на\s*)?(3|три|тр[её]х)\s*-?\s*бет[а-яё]*|(3|три)\s*-?\s*бет[а-яё]*\s*в\s*холодн|в\s*холодн[а-яё]*\s*(на\s*)?(3|три)\s*-?\s*бет/;
const COLD4_RE = /(4|четыр[её]х)\s*-?\s*бет[а-яё]*\s*в\s*холодн|холодн[а-яё]*\s*(4|четыр[её]х)\s*-?\s*бет|open\s*4\s*-?\s*bet|опен\s*(4|фор)\s*-?\s*бет|cold\s*4\s*-?\s*bet/;
const B4_RE = /(?<!(на|против)\s*)(^|[^а-яё0-9])(4|четыр[её]х)\s*-?\s*бет|4\s*bet|фор\s*бет/;
function cc3Blocks(P, ql, o) {
  const { bands, PL, pos } = o, cols = vPosList(PL) || (pos ? [pos === 'EP' ? 'MP' : pos] : o.table ? IPOS : ['TOT']);
  const get = (p) => { const x = [0, 0, 0]; for (const b of bands) { const r = P.ext.c3[p] && P.ext.c3[p][b]; if (r) for (let j = 0; j < 3; j++) x[j] += r[j]; } return x; };
  const note = 'кто-то открылся, другой 3-бетнул (не олл-ин), мы ещё не вкладывались и коллируем; до нас никто не коллировал' + (bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : ''), ai = 'колл — 3-бет не олл-ин';
  /* Open 4bet — 4-бет в холодную (24–25.11.2026): те же раздачи, наш ход — рейз (любой, в т.ч. олл-ин) */
  const c4 = COLD4_RE.test(ql), both = c4 && /(колл?|кол)[а-яё]*\s*(на\s*)?(3|три|тр[её]х)/.test(ql.replace(COLD4_RE, ' ')), R = { call: ['Cold call 3bet', 1, 'колл 3-бета в холодную'], b4: ['Open 4bet', 2, '4-бет в холодную (open 4bet)'] };
  const ks1 = c4 && !both ? ['b4'] : both ? ['call', 'b4'] : ['call'], ksT = c4 && !both ? ['b4'] : ['call', 'b4'];
  if (cols.length === 1 && !o.table) return ks1.map(k => { const x = get(cols[0]); return { type: 'big', hm: HMref(P, 'c3|' + cols[0], k, bands), title: title(P) + ' — ' + R[k][2] + (cols[0] === 'TOT' ? '' : ' с ' + cols[0]), big: x[0] ? pctS(x[R[k][1]], x[0]) : 'нет данных', n: x[0], ai: k === 'b4' ? '4-бет — любой, в т.ч. олл-ин' : ai, note: (k === 'call' && ks1.length === 1 && x[0] ? '4-бет в холодную ' + pctS(x[2], x[0]) + ' · ' : '') + note }; });
  return [{ type: 'table', title: title(P) + ' — ' + (ksT.length > 1 ? 'колл 3-бета в холодную и open 4bet' : '4-бет в холодную') + ' по позициям', note: note + '; Open 4bet — 4-бет в холодную (любой, в т.ч. олл-ин)', ai, table: { head: ['', ...cols], rows: ksT.map(k => [R[k][0], ...cols.map(p => { const x = get(p); return { v: pctS(x[R[k][1]], x[0]), n: x[0], hm: HMref(P, 'c3|' + p, k, bands) }; })]), grid: true, heatRow: true } }];
}
function b4Blocks(P, ql, o) {
  if (o.pos === 'BB') return [{ type: 'text', title: title(P) + ' — 4-бет с BB', text: 'С BB 4-бета после своего опена не бывает: открыться первым с BB нельзя. Можно спросить «3-бет с BB» или «колд-колл с BB».' }];
  const { bands, PL, pos } = o, mode = aiMode(ql);
  const hasOop = /без\s*позиц|вне\s*позиц|не\s*в\s*позиц|(^|[^a-z])oop([^a-z]|$)/.test(ql), hasIp = /(^|[^а-яёa-z])(в\s*позиц|ip)([^a-z]|$)/.test(ql.replace(/не\s*в\s*позиц/g, ' ')), w = hasIp && !hasOop ? 'ip' : hasOop && !hasIp ? 'oop' : 'all';
  const get = (p) => { const x = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (const b of bands) { const r = P.ext.f3[p] && P.ext.f3[p][w] && P.ext.f3[p][w][b]; if (r) for (let j = 0; j < 9; j++) x[j] += r[j] || 0; } return x; };
  // 4-беты — только из раздач, где 3-бет был не олл-ином (те же раздачи, что в знаменателе): [7] и [8]
  const K = { all: ['4bet', x => x[7]], nai: ['4bet NAI', x => x[7] - x[8]], ai: ['4bet AI', x => x[8]] }, rowsK = mode === 'all' ? ['all', 'rng', 'nai'] : [mode, 'rng'];
  /* 4bet Range — доля всех раздач с этой позиции (возможностей открыться, как RFI), которые дошли до нашего 4-бета; TOT — без SB */
  const rfiR = (p) => { let n = 0, o = 0; for (const q of p === 'TOT' ? ['EP', 'MP', 'HJ', 'CO', 'BTN'] : [p]) for (const b of bands) { const r = P.ext.rfi && P.ext.rfi[q] && P.ext.rfi[q][b]; if (r) { n += r[0]; o += r[2]; } } return n ? o / n : 0; }, rk = mode === 'all' ? 'all' : mode, MK = { all: 'b4', nai: 'b4nai', ai: 'b4ai' };
  /* Range = частота 4-бета × частота опена не олл-ином (4-бет считаем только после опена не олл-ином): какая доля всех рук с позиции открывается и 4-бетит */
  const rngCell = (p) => { const x = get(p), d = x[0] - x[4], v = d ? K[rk][1](x) / d * rfiR(p) * 100 : 0; return { v: d ? String(Math.round(v * 10) / 10).replace('.', ',') + '%' : '—', n: d, rng: 1, hm: HMref(P, 'f3|' + p + '|' + w, MK[rk], bands) }; };
  const cols = vPosList(PL) ? PL.filter(p => F3POS.includes(p)) : (pos ? [pos] : o.table ? F3POS : ['TOT']);
  const wTxt = w === 'ip' ? ' в позиции' : w === 'oop' ? ' без позиции' : '';
  const note = 'мы открылись, никто не вошёл, нас 3-бетнули (не олл-ином — на олл-ин 4-бет невозможен) — мы 4-бетим; NAI — не олл-ином, AI — олл-ином; Range — частота 4-бета × частота опена не олл-ином: какая доля всех рук с позиции открывается и 4-бетит (матрица — руки 4-бета); TOT — без SB' + (bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '');
  const ai = mode === 'nai' ? 'без олл-инов' : mode === 'ai' ? 'только олл-ины' : '4bet — с олл-инами · NAI — без';
  if (hasIp && hasOop && cols.length === 1 && !o.table) return ['ip', 'oop'].map(ww => b4Blocks(P, ql.replace(/без\s*позиц[а-яё]*|(^|[^а-яё])в\s*позиц[а-яё]*/g, ' ') + (ww === 'ip' ? ' в позиции' : ' без позиции'), o)[0]);
  if (cols.length === 1 && !o.table) { const x = get(cols[0]), k = rowsK[0]; return [{ type: 'big', hm: HMref(P, 'f3|' + cols[0] + '|' + w, { all: 'b4', nai: 'b4nai', ai: 'b4ai' }[k], bands), title: title(P) + ' — ' + K[k][0] + wTxt + (cols[0] === 'TOT' ? '' : ' с ' + cols[0]), big: x[0] - x[4] ? pctS(K[k][1](x), x[0] - x[4]) : 'нет данных', n: x[0] - x[4], ai: mode === 'all' ? 'с олл-инами' : ai, note: (mode === 'all' && x[0] - x[4] ? 'NAI ' + pctS(K.nai[1](x), x[0] - x[4]) + ' · AI ' + pctS(K.ai[1](x), x[0] - x[4]) + ' · ' : '') + note }]; }
  return [{ type: 'table', title: title(P) + ' — 4-беты по позициям' + wTxt, note, ai, table: { head: ['', ...cols], rows: rowsK.map(k => k === 'rng' ? [K[rk][0] + ' Range', ...cols.map(rngCell)] : [K[k][0], ...cols.map(p => { const x = get(p); return { v: pctS(K[k][1](x), x[0] - x[4]), n: x[0] - x[4], hm: HMref(P, 'f3|' + p + '|' + w, { all: 'b4', nai: 'b4nai', ai: 'b4ai' }[k], bands) }; })]), grid: true, heatRow: true } }];
}// ---------- фолд на 4-бет и 5-бет после своего 3-бета (алиас — ext.f4; 24.11.2026) ----------
// мой 3-бет не олл-ином (один опен, без коллеров и лимпов) → мне 4-бет (в т.ч. олл-ин) → фолд / колл / 5-бет; проценты — от всех таких 4-бетов
const F4_RE = /фолд[а-яё]*\s*(на|против)\s*(4|четыр[её]х)\s*-?\s*бет|fold\s*to\s*4/;
function f4Blocks(P, ql, o, kind) {
  const { bands, PL, pos } = o, cols = vPosList(PL) || (pos ? [pos === 'EP' ? 'MP' : pos] : o.table ? IPOS : ['TOT']);
  const get = (p) => { const x = [0, 0, 0, 0, 0]; for (const b of bands) { const r = P.ext.f4[p] && P.ext.f4[p][b]; if (r) for (let j = 0; j < 5; j++) x[j] += r[j]; } return x; };
  const K = kind === 'fold' ? ['Fold to 4bet', 2, 'фолд на 4-бет'] : ['5bet', 4, '5-бет'];
  const note = 'мы 3-бетнули (не олл-ином, против одного опена без коллеров), нам поставили 4-бет (в т.ч. олл-ин); процент — от всех таких 4-бетов' + (bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : ''), ai = '4-бет — любой, в т.ч. олл-ин';
  if (cols.length === 1) { const x = get(cols[0]); return [{ type: 'big', hm: HMref(P, 'f4|' + cols[0], 'fold', bands), title: title(P) + ' — ' + K[2] + (cols[0] === 'TOT' ? '' : ' с ' + cols[0]), big: x[0] ? pctS(x[K[1]], x[0]) : 'нет данных', n: x[0], ai, note }]; }
  return [{ type: 'table', title: title(P) + ' — ' + K[2] + ' по позициям', note, ai, table: { head: ['', ...cols], rows: [[K[0], ...cols.map(p => { const x = get(p); return { v: pctS(x[K[1]], x[0]), n: x[0], hm: HMref(P, 'f4|' + p, 'fold', bands) }; })]], grid: true } }];
}// ---------- матрицы рук (25.11.2026): по клетке стата — какими руками была ситуация и действие ----------
// алиас — tgbot/data/alias_hm.json (свои карты известны всегда); игроки базы — после перегона (только вскрытые руки, от HM_MIN рук)
const HMF = path.join(__dirname, 'data', 'alias_hm.json'); let HMD = null, HMT = 0;
function hmData() { try { const t = fs.statSync(HMF).mtimeMs; if (t !== HMT) { HMD = JSON.parse(fs.readFileSync(HMF, 'utf8')); HMT = t; } } catch (e) { HMD = null; } return HMD; }
// ссылка на матрицу для клетки: путь стата, метрика (действие), стеки; dm — метрика знаменателя (размеры 3-бета: доля среди всех 3-бетов)
const HMref = (P, p, m, bands, dm) => (P && P.key && /^alias:/.test(P.key) ? { p, m, b: bands.length === BANDS.length ? 'all' : bands.join(','), dm } : undefined);
function hmGet(p, m, b, dm) {
  const D = hmData(); if (!D || !D[p]) return null; const bands = b === 'all' ? ['all'] : b.split(','), out = {};
  const add = (metric, slot) => { let pp = p; if (/#/.test(metric)) { [pp, metric] = metric.split('#'); } const M = D[pp] && D[pp][metric]; if (!M) return; for (const bd of bands) { const o = M[bd]; if (!o) continue; for (const [c, v] of Object.entries(o)) { const x = out[c] = out[c] || [0, 0]; if (slot === 'd') x[0] += v[0]; else if (slot === 'n') x[1] += v[1]; else { x[0] += v[0]; x[1] += v[1]; } } } };
  if (dm) { add(dm, 'd'); add(m, 'n'); } else add(m, 'both');
  return out;
}// ---------- сквизы (алиас — ext.sq / ext.sqm; 25.11.2026) ----------
// один опен (не олл-ин) + коллеры, лимпов нет, наш первый ход — рейз. SQZ-Fold — сквизнули не олл-ином, на нас рейз, сбросили.
// «позиция против комбинации»: колонки MP+CC (опен EP/MP/HJ + любой колл), CO+BTN, CO+SB, BTN+SB
const SQ_RE = /сквиз|squeeze|скв[иы]з|sqz/, SQG = ['MP+CC', 'CO+BTN', 'CO+SB', 'BTN+SB'];
function sqBlocks(P, ql, o) {
  if (/фолд[а-яё]*\s*(на|против)\s*сквиз/.test(ql)) return [{ type: 'text', text: 'Фолд на сквиз (после нашего колла) пока не считаем — отложено. Есть «сквизы», «сквиз-фолд» (сквизнули и сбросили на рейз), «сквизы против комбинаций», «сквизы по стекам».' }];
  const { bands, PL, pos } = o, mode = aiMode(ql), st = bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '';
  const note = 'кто-то открылся (не олл-ин), его коллировали, лимпов не было — мы первым ходом рейзим' + st, aiT = mode === 'nai' ? 'без олл-инов' : mode === 'ai' ? 'только олл-ины' : 'SQZ — с олл-инами · NAI — без';
  const get = (p, bs) => { const x = [0, 0, 0, 0, 0]; for (const b of bs) { const r = P.ext.sq[p] && P.ext.sq[p][b]; if (r) for (let j = 0; j < 5; j++) x[j] += r[j]; } return x; };
  const V = { sqz: ['SQZ', x => x[1] + x[2], x => x[0]], nai: ['SQZ NAI', x => x[1], x => x[0]], ai: ['SQZ AI', x => x[2], x => x[0]], sqfold: ['SQZ-Fold', x => x[4], x => x[3]] };
  const cell = (p, k, bs) => { const x = get(p, bs), d = V[k][2](x); return { v: pctS(V[k][1](x), d), n: d, hm: HMref(P, 'sq|' + p, k, bs) }; };
  // таблица 4: по стекам
  if (o.byBand || /по\s*ст[еэ]к|ст[еэ]кам/.test(ql)) {
    const k = mode === 'nai' ? 'nai' : mode === 'ai' ? 'ai' : 'sqz', p = pos ? (pos === 'EP' ? 'MP' : pos) : 'TOT';
    const rows = [['TOT', cell(p, k, BANDS)], ...BANDS.map(b => [b + ' bb', cell(p, k, [b])]).filter(r => r[1].n)];
    return [{ type: 'table', title: title(P) + ' — сквизы по стекам' + (p === 'TOT' ? '' : ' с ' + p), note, ai: aiT, table: { head: ['стек', V[k][0]], rows, grid: true, heatCol: true } }];
  }
  // таблицы 2–3: позиция против комбинации «опен + колл»
  if (/комбинац|рейз[а-яё]*\s*(и|\+|плюс)\s*колл|опен[а-яё]*\s*(и|\+|плюс)\s*колл|позици[а-яё]*\s*против/.test(ql) || (o.vs && /против/.test(ql))) {
    const M = P.ext.sqm || {}, getm = (h, g, bs) => { const x = [0, 0, 0]; for (const [key, byB] of Object.entries(M[h] || {})) { const [op, cl] = key.split('+'), G = ['EP', 'MP', 'HJ'].includes(op) ? 'MP+CC' : key; if (G !== g) continue; for (const b of bs) { const r = byB[b]; if (r) for (let j = 0; j < 3; j++) x[j] += r[j]; } } return x; };
    const rowsH = ['HJ', 'CO', 'BTN', 'SB', 'BB'].filter(h => SQG.some(g => getm(h, g, bands)[0]));
    const mk = (k, name) => ({ type: 'table', title: title(P) + ' — ' + name + ': позиция против «опен + колл»', note: 'строки — наша позиция, колонки — кто открыл + кто коллировал; ровно один опен и один колл (MP+CC — опен с ранних мест и колл с любого места)' + st, ai: k === 'nai' ? 'без олл-инов' : 'с олл-инами',
      table: { head: ['', ...SQG], rows: rowsH.map(h => [h + ' vs', ...SQG.map(g => { const x = getm(h, g, bands); if (!x[0]) return ''; return { v: pctS(k === 'nai' ? x[1] : x[1] + x[2], x[0]), n: x[0], hm: HMref(P, 'sqm|' + h + '|' + g, k === 'nai' ? 'nai' : 'sqz', bands) }; })]), grid: true } });
    return mode === 'nai' ? [mk('nai', 'SQZ NAI')] : mode === 'ai' ? [mk('sqz', 'SQZ')] : [mk('sqz', 'SQZ'), mk('nai', 'SQZ NAI')];
  }
  // таблица 1: по позициям — SQZ / SQZ NAI / SQZ-Fold; одна цифра без «по позициям»
  const cols = vPosList(PL) || (pos ? [pos === 'EP' ? 'MP' : pos] : o.table ? IPOS : ['TOT']);
  const kRows = /сквиз[а-яё-]*\s*-?\s*фолд|сквиз\s*и\s*фолд/.test(ql) ? ['sqfold'] : mode === 'nai' ? ['nai'] : mode === 'ai' ? ['ai'] : ['sqz', 'nai', 'sqfold'];
  if (cols.length === 1) { const k = kRows[0], c = cell(cols[0], k, bands), x = get(cols[0], bands); return [{ type: 'big', hm: c.hm, title: title(P) + ' — ' + V[k][0] + (cols[0] === 'TOT' ? '' : ' с ' + cols[0]), big: c.n ? c.v : 'нет данных', n: c.n, ai: k === 'sqz' ? 'с олл-инами' : aiT, note: (k === 'sqz' && x[0] ? 'NAI ' + pctS(x[1], x[0]) + ' · сквиз-фолд ' + pctS(x[4], x[3]) + ' (' + x[3] + ' раз) · ' : '') + note }]; }
  return [{ type: 'table', title: title(P) + ' — сквизы по позициям', note: note + '; SQZ-Fold — сквизнули не олл-ином, на нас рейз, сбросили', ai: aiT, table: { head: ['', ...cols], rows: kRows.map(k => [V[k][0], ...cols.map(p => cell(p, k, bands))]), grid: true, heatRow: true } }];
}// ---------- ответ на сквиз (алиас — ext.fsq; 25.11.2026) ----------
// мы открылись (не олл-ин) или заколлировали один опен → за нами колл и ровно один рейз — сквиз → наш ответ (фолд / колл / 4-бет любой).
// роли: pfr — открывший, cc — коллер; ccF / ccC — коллер, когда открывший до нас сбросил / заколлировал сквиз
const FSQ_RE = /(фолд|колл?|кол|4\s*-?\s*бет|четыр[её]х\s*-?\s*бет|реакц|ответ|fold|call)[а-яё]*\s*(на|против|vs)\s*сквиз|(колл?|кол|call)[а-яё]*\s+сквиз|(f|fold)?\s*vs\s*sqz|сквиз[а-яё]*\s*(на|против)\s*(мен|нас)/;
const FSQ_POS = ['TOT', 'EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'];
function fsqBlocks(P, ql, o) {
  if (o.pos === 'BB') return [{ type: 'text', title: title(P) + ' — ответ на сквиз с BB', text: 'С BB сквиза против нас не бывает: за BB никого нет, а открыться первым с BB нельзя.' }];
  const { bands } = o, mode = aiMode(ql), st = bands.length < BANDS.length ? '; стек ' + grpLabel('', bands) : '';
  const qo = ql.replace(/сквиз.*$/, ' ') + ' ' + ql.replace(/^.*?сквиз[а-яё]*/, ' ');
  const opR = /(открывш[а-яё]*|рейзер|опен[а-яё]*|pfr)\s+(выкинул|сбросил|сфолдил|фолд)/.test(ql) ? 'ccF' : /(открывш[а-яё]*|рейзер|опен[а-яё]*|pfr)\s+(заколл|коллир|колл)/.test(ql) ? 'ccC' : null;
  const bothR = /рейзер|открывш|pfr/.test(ql) && /колл?ер|колер|(^|[^a-z])cc([^a-z]|$)/.test(ql) && !opR; /* «как рейзер и как коллер» — обе роли */
  const role = bothR ? null : opR || (/как\s*(колл?ер|колер|cc)|после\s*(своего\s*|моего\s*|нашего\s*)?колл|колл?ер|колер/.test(ql) ? 'cc' : /как\s*(рейзер|открывш|pfr)|после\s*(своего\s*|моего\s*|нашего\s*)?опен|рейзер|открывш/.test(ql) ? 'pfr' : null);
  const acts = /реакц|ответ|все\s*действ/.test(ql) ? null : /4\s*-?\s*бет|четыр[её]х\s*-?\s*бет/.test(qo) ? ['b4'] : /(^|[^а-яё])(колл?|кол|call)([^а-яё]|$)|коллир|коллы/.test(qo.replace(/колл?ер|колер|заколл[а-яё]*/g, ' ')) && !/фолд|fold/.test(qo) ? ['call'] : /фолд|fold/.test(qo) ? ['fold'] : null;
  const A = { fold: ['Fold', 1, 'фолд на сквиз'], call: ['Call', 2, 'колл сквиза'], b4: ['4bet', 3, '4-бет против сквиза'] }, RL = { pfr: 'as PFR', cc: 'as CC', ccF: 'CC · PFR Fold', ccC: 'CC · PFR Call' }, RLr = { pfr: 'мы открылись', cc: 'мы коллировали опен', ccF: 'мы коллировали, открывший сбросил на сквиз', ccC: 'мы коллировали, открывший заколлировал сквиз' };
  const get = (rl, p, bs) => { const x = [0, 0, 0, 0]; for (const b of bs) { const r = P.ext.fsq[rl] && P.ext.fsq[rl][p] && P.ext.fsq[rl][p][b]; if (!r) continue; for (let j = 0; j < 4; j++) x[j] += mode === 'ai' ? r[j + 4] : mode === 'nai' ? r[j] - r[j + 4] : r[j]; } return x; };
  const cell = (rl, p, a, bs) => { const x = get(rl, p, bs); return { v: pctS(x[A[a][1]], x[0]), n: x[0], hm: HMref(P, 'fsq|' + rl + '|' + p, a + (mode === 'all' ? '' : mode), bs) }; };
  const note = 'мы открылись (не олл-ин) или заколлировали один опен, за нами колл и рейз — сквиз; 4-бет — любой, в т.ч. олл-ин' + st, ai = mode === 'nai' ? 'сквиз не олл-ином' : mode === 'ai' ? 'сквиз олл-ином' : 'любой сквиз, в т.ч. олл-ин';
  const pos = o.pos && FSQ_POS.includes(o.pos) ? o.pos : 'TOT', pT = pos === 'TOT' ? '' : ' с ' + pos;
  /* все реакции — строки Fold / 4bet / Call, колонки — роли */
  if (!acts) { const rls = role === 'pfr' ? ['pfr'] : role === 'cc' ? ['cc', 'ccF', 'ccC'] : role ? [role] : ['pfr', 'ccF', 'ccC'];
    return [{ type: 'table', title: title(P) + ' — ответы на сквиз' + pT, note: note + '; колонки CC · PFR Fold / Call — что сделал открывший до нас', ai, table: { head: ['', ...rls.map(r => RL[r])], rows: ['fold', 'b4', 'call'].map(a => [A[a][0], ...rls.map(r => cell(r, pos, a, bands))]), grid: true } }]; }
  const a = acts[0], rls = role ? [role] : ['pfr', 'cc'];
  /* по стекам */
  if (o.byBand) return [{ type: 'table', title: title(P) + ' — ' + A[a][2] + ' по стекам' + pT, note, ai, table: { head: ['стек', ...rls.map(r => RL[r])], rows: [['TOT', ...rls.map(r => cell(r, pos, a, bands))], ...bands.map(b => [b + ' bb', ...rls.map(r => cell(r, pos, a, [b]))]).filter(r => r.slice(1).some(c => c.n))], grid: true, heatCol: true } }];
  /* по позициям */
  const cols = o.PL ? ['TOT', ...o.PL.filter(p => FSQ_POS.includes(p) && p !== 'TOT')] : null;
  if (o.table || cols) { const cs = cols || FSQ_POS; return [{ type: 'table', title: title(P) + ' — ' + A[a][2] + ' по позициям', note, ai, table: { head: ['', ...cs], rows: rls.map(r => [RL[r], ...cs.map(p => { const c = cell(r, p, a, bands); return c.n ? c : ''; })]), grid: true, heatRow: true } }]; }
  /* одна цифра (роль не названа — две: как открывший и как коллер) */
  return rls.map(r => { const c = cell(r, pos, a, bands); return { type: 'big', hm: c.hm, title: title(P) + ' — ' + A[a][2] + pT + ' (' + RLr[r] + ')', big: c.n ? c.v : 'нет данных', n: c.n, ai, note }; });
}/* постфлоп — без матриц рук (владелец 26.11.2026): матрицы только у префлоп-статов */
function noHm(bl) { for (const b of bl) { delete b.hm; if (b.table) for (const r of b.table.rows) for (const c of r) if (c && typeof c === 'object') delete c.hm; } return bl; }
function statBlocks(P, id, ql, TT) { if (id === 'MWL') return P.ext && P.ext.ml ? mwlBlocks(P, ql, { bands: TT.bands }) : [{ type: 'text', text: 'Линии в мультивее пока посчитаны только по вашей базе.' }]; if (id === 'CB' || id === 'BSK' || id === 'MWB') return noHm(statBlocks0(P, id, ql, TT)); return statBlocks0(P, id, ql, TT); }
function statBlocks0(P, id, ql, TT) {
  const f1 = (v) => (v == null ? '—' : String(v).replace('.', ','));
  const big = (name, v, n, note) => ({ type: 'big', title: title(P) + ' — ' + name, big: n ? v : 'нет данных', n, note });
  const c = (nm) => clStat(P, nm);
  if (id === 'SQ') { const k = card(P); return [{ type: 'card', title: title(P) + ' — квадрат', square: k.square }]; }
  if (id === 'VPIPPFR') { const a = c('VPIP'), b = c('PFR'); return [big('VPIP / PFR', f1(a.p) + ' / ' + f1(b.p), a.n, '')]; }
  if (id === 'VPIP' || id === 'PFR') { const a = c(id); return [big(id, f1(a.p) + '%', a.n, '')]; }
  if (id === 'LIMP' && P.ext && P.ext.lmp && TT) return lmpBlocks(P, ql, { bands: TT.bands, PL: TT.PL, pos: TT.PL ? null : posOf(ql), table: !!(WANT_TABLE.test(ql) || TT.byBand) });
  if (id === 'LIMP') { const a = c('LimpNSB'); return [big('лимп первым (кроме SB)', f1(a.p) + '%', a.n, '')]; }
  if (id === 'F3' && P.ext && P.ext.f3 && TT) return f3Blocks(P, ql, { bands: TT.bands, PL: TT.PL, pos: TT.PL ? null : posOf(ql), table: !!(WANT_TABLE.test(ql) || TT.byBand) });
  if (id === 'F3' && /в\s*позиц|без\s*позиц|oop|(^|[^a-z])ip([^a-z]|$)/.test(ql) && !(P.ext && P.ext.f3)) { const a = c('F3Bet'); return [{ type: 'big', title: title(P) + ' — фолд на 3-бет', big: f1(a.p) + '%', n: a.n, note: 'в позиции / без позиции отдельно пока посчитано только по вашей базе — здесь общий фолд на 3-бет' }]; }
  if (id === 'F3') { const a = c('F3Bet'); return [big('фолд на 3-бет', f1(a.p) + '%', a.n, '')]; }
  if (id === 'BR' || id === 'FRB') { const a = c(id === 'BR' ? 'BetRiverHU' : 'FoldRiverBetHU'); return [big(STAT_RU[id], f1(a.p) + '%', a.n, 'банки один на один')]; }
  if (id === 'SQZ') { if (!(P.ext && P.ext.sq)) { const t = famTable(P, 'sqz', TT.bands, TT.byBand, TT.G); return [{ type: 'table', title: title(P) + ' — ' + FAM_T.sqz, note: 'у игроков базы — по стекам, без позиций', table: t }]; } return sqBlocks(P, ql, { bands: TT.bands, PL: TT.PL, pos: TT.PL ? null : posOf(ql), table: !!(WANT_TABLE.test(ql)), byBand: TT.byBand, vs: true }); }
  if (id === 'MWB') { if (!(P.ext && P.ext.cb && P.ext.bsk)) return [{ type: 'text', text: 'Ставки в мультивее пока посчитаны только по вашей базе.' }]; return [{ type: 'text', title: 'Роль не названа — показываю обе', text: 'В мультивее ставки считаются отдельно как рейзер (я открылся первым — конбеты) и как коллер (я заколлировал — ставка на пропуск). В следующий раз скажите «как рейзер» или «как коллер».' }, ...cbBlocks(P, ql + ' как рейзер', { bands: TT.bands }), ...bskBlocks(P, ql, { bands: TT.bands })]; }
  if (id === 'BSK') { if (!(P.ext && P.ext.bsk)) return [{ type: 'text', text: 'Ставка на пропуск пока посчитана только по вашей базе.' }]; return bskBlocks(P, ql, { bands: TT.bands }); }
  if (id === 'CB') { if (!(P.ext && P.ext.cb)) return [{ type: 'text', text: 'Конбеты в мультивее пока посчитаны только по вашей базе; у игроков базы появятся после прохода по базе.' }]; return cbBlocks(P, ql, { bands: TT.bands }); }
  if (id === 'BVS') { if (!(P.ext && P.ext.v3m)) return [{ type: 'text', text: 'Таблица «блайнд против опенов» пока посчитана только по вашей базе.' }]; return bvsBlocks(P, ql, (TT.G && TT.G.length === 1 ? TT.G[0][1] : null) || TT.bands); }
  if (id === 'FSQ') { if (!(P.ext && P.ext.fsq)) return [{ type: 'text', text: 'Ответ на сквиз пока посчитан только по вашей базе.' }]; return fsqBlocks(P, ql, { bands: TT.bands, PL: TT.PL, pos: TT.PL ? null : posOf(ql), table: !!(WANT_TABLE.test(ql)) && !TT.byBand, byBand: TT.byBand }); }
  if (id === 'F4') { if (!(P.ext && P.ext.f4)) return [{ type: 'text', text: 'Фолд на 4-бет пока посчитан только по вашей базе.' }]; return f4Blocks(P, ql, { bands: TT.bands, PL: TT.PL, pos: TT.PL ? null : posOf(ql), table: !!(WANT_TABLE.test(ql) || TT.byBand) }, 'fold'); }
  if (id === 'CC3') { if (!(P.ext && P.ext.c3)) return [{ type: 'text', text: 'Колл 3-бета в холодную пока посчитан только по вашей базе.' }]; return cc3Blocks(P, ql, { bands: TT.bands, PL: TT.PL, pos: TT.PL ? null : posOf(ql), table: !!(WANT_TABLE.test(ql) || TT.byBand) }); }
  if (id === 'B4') { if (!(P.ext && P.ext.f3)) return [{ type: 'text', text: '4-беты пока посчитаны только по вашей базе.' }]; return b4Blocks(P, ql, { bands: TT.bands, PL: TT.PL, pos: TT.PL ? null : posOf(ql), table: !!(WANT_TABLE.test(ql) || TT.byBand) }); }
  if (id === 'S3') { if (!(P.ext && P.ext.s3)) return [{ type: 'text', text: 'Размеры 3-бета пока посчитаны только по вашей базе.' }]; return s3Blocks(P, ql, { bands: TT.bands, pos: posOf(ql) }); }
  if (id === 'B3I') { if (!(P.ext && P.ext.b3i)) return [{ type: 'text', text: '3-бет против изолейта пока посчитан только по вашей базе.' }]; return b3iBlocks(P, ql, { bands: TT.bands, PL: TT.PL, pos: TT.PL ? null : posOf(ql), table: !!(WANT_TABLE.test(ql) || TT.byBand) }); }
  // игрок базы: колд-колл — из счётчиков базы (группы BB / SB / остальные); колла третьим и таблицы «позиция против позиции» у них пока нет
  if (id === 'OC' && !(P.ext && P.ext.oc)) return [{ type: 'text', title: title(P) + ' — колл третьим в банк', text: 'Колл третьим и четвёртым в банк пока посчитан только по вашей базе; у игроков базы появится после пересчёта.' }];
  if (id === 'CC' && !(P.ext && P.ext.vso)) {
    const pos = posOf(ql), grp = pos === 'BB' ? ['BB'] : pos === 'SB' ? ['SB'] : pos ? ['CO'] : ['SB', 'CO']; // TOT — без BB, как у алиаса
    let n = 0, cl = 0; for (const b of (TT && TT.bands) || BANDS) for (const g of grp) { const o = LU.slotOf('vso', b, g); n += P.pf[o]; cl += P.pf[o + 1]; }
    return [{ type: 'big', title: title(P) + ' — Cold call' + (pos ? ' с ' + (grp[0] === 'CO' ? 'BTN/CO/HJ/EP' : pos) : ''), big: n ? pctS(cl, n) : 'нет данных', n, ai: 'колл — опен не олл-ин', note: 'колл одного опена' + (!pos ? '; TOT — без BB' : '') + (pos && grp[0] === 'CO' ? '; у игроков базы BTN, CO, HJ, EP пока одной группой' : '') + (TT && TT.bands.length < BANDS.length ? '; стек ' + grpLabel('', TT.bands) : '') }];
  }
  if (id === '3B' && !(P.ext && P.ext.v3m) && vsInfo(ql)) return [{ type: 'text', title: title(P) + ' — 3-бет позиция против позиции', text: 'Таблица «позиция против позиции» пока посчитана только по вашей базе; у игроков базы появится после пересчёта.' }];  if (id === 'OC' && P.ext && P.ext.oc && TT) return ocBlocks(P, ql, { bands: TT.bands, PL: TT.PL, pos: TT.PL ? null : posOf(ql), table: !!(WANT_TABLE.test(ql) || TT.byBand || TT.G) });
  if (id === 'CC' && P.ext && P.ext.vso && TT) {
    // колд-колл (владелец, 24.11.2026): колл ровно одного опена без коллеров, опен не олл-ин — то же правило, что 3-бет
    const vs = P.ext.v3m ? vsInfo(ql) : null; if (vs) return v3mBlocks(P, ql, vs, (TT.G && TT.G.length === 1 ? TT.G[0][1] : null) || TT.bands, 'call');
    const tbl = WANT_TABLE.test(ql) || TT.G || TT.PL || TT.byBand, pos = posOf(ql);
    const out = vsoBlocks(P, ql, { G: TT.G, PL: TT.PL, bands: TT.bands, byBand: TT.byBand, pos: tbl && !TT.PL ? null : (pos || (tbl ? null : 'TOT')), focus: 'call', totKey: P.ext.vso.TOTnb ? 'TOTnb' : null });
    for (const B of out) { B.title = String(B.title).replace(/колл против опена/, 'Cold call'); B.ai = 'колл — опен не олл-ин'; if (B.table) { B.table.rows.forEach(r => { if (r[0] === 'колл') r[0] = 'Cold call'; }); B.note = (B.note || '') + '; TOT — без BB'; } else B.note = (B.note || '') + '; без BB'; }
    return out;
  }  if (id === '3B' && P.ext && P.ext.v3m && TT) { const vs = vsInfo(ql); if (vs) return v3mBlocks(P, ql, vs, (TT.G && TT.G.length === 1 ? TT.G[0][1] : null) || TT.bands); }
  if (id === '3B' && P.ext && P.ext.vso && TT) {
    const tbl = WANT_TABLE.test(ql) || TT.G || TT.PL || TT.byBand, pos = posOf(ql);
    // без просьбы о таблице и без позиции — одна цифра (TOT)
    return vsoBlocks(P, ql, { G: TT.G, PL: TT.PL, bands: TT.bands, byBand: TT.byBand, pos: tbl && !TT.PL ? null : (pos || (tbl ? null : 'TOT')), focus: 'b3', three: true });
  }
  if (id === '3B') {
    // по позициям — как Hand2Note (у алиаса); одна позиция — одна цифра
    const H = P.ext && P.ext.h3, pos = posOf(ql), tbl = WANT_TABLE.test(ql);
    if (H && (tbl || pos)) {
      if (pos && !tbl) { const p = pos === 'EP' ? 'MP' : pos, x = H[p]; return [big('3-бет NAI с ' + p, x ? pctS(x[1], x[0]) : '—', x ? x[0] : 0, 'против одного опена без коллеров' + (pos === 'EP' ? ' · ранние места считаются как MP' : ''))]; }
      const rows = [['NAI', ...['TOT', ...H3POS].map(p => { const x = H[p]; return x ? { v: pctS(x[1], x[0]), n: x[0] } : { v: '—', n: 0 }; })]];
      return [{ type: 'table', title: title(P) + ' — 3-бет NAI по позициям', note: 'против одного опена без коллеров; BB — без раздач против SB', table: { head: ['', 'TOT', ...H3POS], rows, grid: true } }];
    }
    if (tbl) return null; // у игроков базы — прежняя таблица «против опена»
    if (H && H.TOT) return [big('3-бет NAI', pctS(H.TOT[1], H.TOT[0]), H.TOT[0], 'против одного опена без коллеров')];
    const a = c('3BetNAI'); return [big('3-бет NAI', f1(a.p) + '%', a.n, '')];
  }
  // WTSD / W$SD / WWSF: у алиаса — по всем банкам с флопом (TOTAL), иначе / по просьбе «один на один» — HU
  const WS = c('WS'), LS = c('LS'), WN = c('WN'), HU = WS.n, T = P.ext && P.ext.tot;
  const hu = /хед|heads|один\s*на\s*один|1\s*на\s*1|\bhu\b|ху\b|хью/.test(ql) || !(T && T.fl);
  const pv = (a, b) => (b ? f1(pct(a, b)) + '%' : '—');
  const val = { WTSD: hu ? [WS.h + LS.h, HU] : [T.sd, T.fl], WSD: hu ? [WS.h, WS.h + LS.h] : [T.sdw, T.sd], WWSF: hu ? [WS.h + WN.h, HU] : [T.won, T.fl] }[id];
  const other = hu && T && T.fl ? null : { WTSD: [WS.h + LS.h, HU], WSD: [WS.h, WS.h + LS.h], WWSF: [WS.h + WN.h, HU] }[id];
  return [big(id === 'WSD' && !hu ? 'выигрыш на шоудауне общий (W$SD)' : STAT_RU[id] + (hu ? ' (один на один)' : ' (TOTAL)'), pv(val[0], val[1]), val[1], hu ? 'банки, где флоп видели двое' : 'все банки с флопом' + (other && other[1] ? ' · один на один ' + pv(other[0], other[1]) : ''))];
}// ---------- похожие ники (владелец, 24.11.2026): голос не знает, как пишется ник — «Bluff Too Much» → Bluf_To_Much ----------
// нормализация: строчные, только буквы/цифры, 2/two/too → to, 4 → for, сдвоенные буквы → одна; дальше — расстояние Левенштейна
const nnorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9а-яё]+/g, ' ').replace(/(^| )(two|too|2)(?= |$)/g, '$1to').replace(/(^| )4(?= |$)/g, '$1for')
  .replace(/\s+/g, '').replace(/two|too/g, 'to').replace(/2/g, 'to').replace(/4/g, 'for').replace(/(.)\1+/g, '$1');
const NK = { keys: null, norm: null, n: null };
setTimeout(() => { const t = Date.now(); const rows = db.prepare("SELECT key, nick, n FROM p WHERE room <> 'alias'").all(); NK.keys = rows.map(r => r.key); NK.norm = rows.map(r => nnorm(r.nick)); NK.n = Int32Array.from(rows, r => r.n); console.log('похожие ники: ' + rows.length + ', ' + (Date.now() - t) + ' мс'); }, 50);
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1), cur = new Array(b.length + 1); for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) { cur[0] = i; let mn = i; for (let j = 1; j <= b.length; j++) { const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); cur[j] = v; if (v < mn) mn = v; } if (mn > max) return max + 1; [prev, cur] = [cur, prev]; }
  return prev[b.length];
}
function similarNicks(cands, lim) {
  if (!NK.norm) return [];
  const best = new Map();
  for (const c of cands) {
    const q = nnorm(c); if (q.length < 3) continue; const max = Math.max(1, Math.floor(q.length * 0.3));
    for (let i = 0; i < NK.norm.length; i++) {
      const s = NK.norm[i]; let d;
      if (s === q) d = 0; else if (Math.abs(s.length - q.length) > max && !(q.length >= 5 && s.includes(q))) continue;
      else d = s.includes(q) && q.length >= 5 ? Math.min(max, 1 + Math.floor((s.length - q.length) / 3)) : lev(q, s, max);
      if (d <= max) { const sc = d / q.length; const o = best.get(i); if (!o || sc < o) best.set(i, sc); }
    }
  }
  return [...best.entries()].sort((a, b) => a[1] - b[1] || NK.n[b[0]] - NK.n[a[0]]).slice(0, lim || 6).map(([i]) => qKey.get(NK.keys[i])).filter(Boolean);
}
// что искать как ник: ник от Claude и слова фразы без служебных
function nickParts(q, brainNick) {
  const toks = String(q || '').replace(/[.,!?«»"]+/g, ' ').split(/\s+/).filter(t => t && !STOP.has(t.toLowerCase()) && !/^(игрок[\wа-яё]*|ник[\wа-яё]*|покаж[\wа-яё]*|найд[\wа-яё]*|открой|дай|карточк[\wа-яё]*)$/i.test(t));
  const out = []; if (brainNick) out.push(brainNick); if (toks.length) out.push(toks.join(' ')); return [...new Set(out)];
}
const notFoundMsg = (q, brainNick) => {
  const rows = similarNicks(nickParts(q, brainNick), 6);
  return { nf: true, blocks: [{ type: 'text', text: rows.length ? 'Такого ника нет. Похожие в базе — нажмите нужный:' : brainNick || nickParts(q, null).length ? 'Игрока не нашёл.' : 'Про какого игрока? Наберите ник или скажите «мой …».' }],
    sugg: rows.map(r => ({ label: r.nick + ' · ' + (ROOM_RU[r.room] || r.room) + ' · ' + r.n.toLocaleString('ru') + ' рук', key: r.key })) };
};function voiceScore(o) {
  if (!o || !o.blocks) return 0; if (o.nf || o.blocks.some(b => b.text === 'Игрока не нашёл.')) return 0;
  const h = String(o.heard || '').toLowerCase(); return 4 + (o.intent && o.intent !== 'card' ? 2 : 0) + (posOf(h) ? 1 : 0) + (bandsOf(h) ? 1 : 0);
}
// как голос пишет «RFI»: «РФ», «эрфай», «эр эф ай», «р ф и», «арфи» → rfi
const normRFI = (q) => q.replace(/(^|[^a-zа-яё0-9])(?:r\s*f\s*i?|рфи|рф|рфай|эр\s*эф\s*(?:ай|и)?|эрэф(?:ай|и)?|эрфа[йи]|эрфи|р\s+ф\s+и|арфи|ар\s*фи|а\s*р\s*ф\s*и)(?=$|[^a-zа-яё0-9])/gi, '$1rfi');
// lock (владелец, 23.11.2026): голос, когда открыта карточка игрока, — всегда про этого игрока; ники в голосе не ищем
// (смена игрока — только набрав ник); на свою базу переключают лишь слова о себе (own — по исходной фразе)
function answer(q, ctx, key, lock, spec) {
  if (lock && ctx && !key) {
    q = wordsToNum(normRFI(String(q || '')).trim()); const ql = q.toLowerCase();
    const r = lock.own ? aliasRow(lock.src) : qKey.get(ctx); if (!r) return { blocks: [{ type: 'text', text: 'Игрока не нашёл.' }] };
    return Object.assign(answerFor(load(r), ql, statOf(ql) ? 'stat' : intentOf(ql), [r], spec), { heard: q, ctxUsed: !lock.own, oneOff: !!lock.own && !/^alias:/.test(ctx) }); // свой стат — разово: открытая карточка остаётся
  }
  q = normRFI(String(q || ''));
  q = wordsToNum(String(q || '').trim()); const ql = q.toLowerCase();
  if (key) { const r = qKey.get(key); if (r) { const P0 = load(r); return Object.assign(answerFor(P0, ql, 'card', [r]), { heard: q }); } }
  if (!q) return { blocks: [{ type: 'text', text: 'Напишите или скажите ник игрока. Например: «покажи FFtonny» или «мой алиас», потом «его 3-беты по позициям».' }] };
  const intent = statOf(ql) ? 'stat' : intentOf(ql);
  const f = findPlayer(q, ctx);
  if (f.none) return { nf: true, blocks: [{ type: 'text', text: 'Игрока не нашёл.' }] }; // похожие ники ищет ask() — один раз на вопрос
  return Object.assign(answerFor(load(f.rows[0]), ql, intent, f.rows, spec), { heard: q, ctxUsed: !!f.ctx });
}
// учитывается ли олл-ин — по названию / строкам / подписи блока
function aiTag(B) {
  const t = String(B.title || ''), note = String(B.note || ''), rows = B.table ? B.table.rows.map(r => String(r[0])) : [], head = B.table ? B.table.head.map(String) : [];
  if (/3bet NAI/.test(t)) return 'без олл-инов';
  if (/3bet AI/.test(t)) return 'только олл-ины';
  if (rows.includes('3bet NAI') && rows.includes('3bet AI')) return '3bet — с олл-инами · NAI — без · AI — только олл-ины';
  if (/3bet/.test(t)) return 'с олл-инами';
  if (/RFI/.test(t)) { if (rows.includes('NAI')) return 'RFI — с олл-инами · NAI — без'; if (/без олл-инов/.test(note) && B.type === 'table') return 'без олл-инов'; return 'с олл-инами'; }
  if (head.some(h => /олл-ин/.test(h)) || /олл-ин/.test(t)) return 'олл-ин — отдельно';
  return null;
}function answerFor(P, ql, intent, rows0, spec) {
  const others = rows0.slice(1).map(r => ({ label: r.nick + ' · ' + (ROOM_RU[r.room] || r.room) + ' · ' + r.n.toLocaleString('ru') + ' рук', key: r.key }));
  const blocks = [];
  spec = spec || {}; const qs = ql.replace(/(от|до|больше|меньше|выше|ниже|свыше|более|менее)?\s*\d{1,3}\s*(%|процент[а-яё]*|прц)/g, ' ').replace(/(от|до|больше|меньше|выше|ниже|свыше|более|менее)?\s*(половин[а-яё]*|две\s*трет[а-яё]*|трет[а-яё]*|четверт[а-яё]*)\s*(банка|пота)?|(овер|под|пот)\s*-?\s*б[еэ]т[а-яё]*|маленьк[а-яё]*\s*(ставк|б[еэ]т)[а-яё]*|размер[а-яё]*\s*(в\s*)?(банк|пот)[а-яё]*|(в|на)\s*(весь\s*)?пот(?![а-яё])|пот\s*-?\s*сайз[а-яё]*/g, ' '); /* размер ставки в % — не стек (26.11.2026) */ let G = spec.groups || groupsRule(qs); const PL = spec.pos || (posListRule(ql).length > 1 ? posListRule(ql) : null);
  // одна названная группа стеков — это фильтр всей таблицы, а не строка (владелец, 24.11.2026)
  const G1 = G && G.length === 1 ? G[0][1] : null; if (G1) G = null;
  const bands0 = G ? null : (G1 || bandsOf(qs)), bands = bands0 || BANDS, byBand = /по ст[еэ]к|ст[еэ]кам|ст[еэ]ков|разбив|сайз/.test(qs) && !(bands0 && bands0.num != null);
  const bnote = bands0 ? 'стек ' + grpLabel('', bands0) : 'все стеки';
  let sb = null;
  if (intent === 'stat' && (sb = statBlocks(P, statOf(ql), ql, { G, PL, bands, byBand, bands0 }))) blocks.push(...sb);
  else if (intent === 'iso' && P.ext && P.ext.iso) blocks.push(...isoBlocks(P, ql, { bands, PL, pos: PL ? null : posOf(ql), table: WANT_TABLE.test(ql) || byBand }));
  else if ((intent === 'vso' || intent === 'stat') && P.ext && P.ext.v3m && focusAct(ql, null) === 'b3' && vsInfo(ql)) blocks.push(...v3mBlocks(P, ql, vsInfo(ql), (G && G.length === 1 ? G[0][1] : null) || bands));
  else if ((intent === 'vso' || intent === 'stat') && P.ext && P.ext.vso) blocks.push(...vsoBlocks(P, ql, { G, PL, bands, byBand, pos: PL ? null : posOf(ql), focus: focusAct(ql, null) }));
  else if (intent === 'stat') { const t = famTable(P, 'vso', bands, byBand, G); blocks.push({ type: 'table', title: title(P) + ' — ' + FAM_T.vso, note: bnote, table: t }); }
  else if (intent === 'card') blocks.push(card(P));
  else if (intent === 'wr') { const c = card(P); blocks.push({ type: 'card', title: c.title, sub: c.sub, group: c.group, wr: c.wr, wrFmt: c.wrFmt, graph: c.graph }); }
  else if (intent === 'wrpos') {
    if (!P.ext || !P.ext.pos) blocks.push({ type: 'text', title: title(P), text: 'Винрейт по позициям пока посчитан только для вашего алиаса (по вашим раздачам). Для игроков базы он появится после следующего прохода по базе.' });
    else {
      const f1 = (v) => (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',');
      const rows = [], T = [0, 0, 0];
      for (const p of ['BB', 'SB', 'BTN', 'CO', 'MP', 'UTG']) { const x = P.ext.pos[p]; if (!x) continue; T[0] += x[0]; T[1] += x[1]; T[2] += x[2]; rows.push([p, String(x[0]), f1(x[1] / x[0] * 100), f1(x[2] / x[0] * 100)]); }
      rows.push(['ИТОГ', String(T[0]), f1(T[1] / T[0] * 100), f1(T[2] / T[0] * 100)]);
      blocks.push({ type: 'table', title: title(P) + ' — винрейт по позициям', note: 'UTG — только при полном столе; «реально» — фактический выигрыш; «с поправкой» — олл-ины по эквити' + (P.ext.dup ? '; дубли раздач убраны: ' + P.ext.dup : ''), table: { head: ['позиция', 'руки', 'бб/100 реально', 'бб/100 с поправкой'], rows, signed: true } });
    }
  }
  else if (intent === 'river') { const c = card(P); blocks.push({ type: 'card', title: title(P) + ' — ривер (один на один)', stats: c.stats.filter(r => r.label && /river/i.test(r.label)) }); }
  else if (intent === 'postflop') blocks.push({ type: 'text', title: title(P), text: 'Постфлоп-статы (c-bet, донк, чек-рейз, флоп / тёрн) ещё не посчитаны — это следующий этап: сначала отрабатываем на ваших раздачах, потом один проход по всей базе. Сейчас есть только ривер один на один — скажите «ривер».' });
  else if (intent === 'rfi' && (G || PL)) {
    // таблица под запрос: строки — названные группы стеков (или все диапазоны «по стекам»), колонки — названные позиции
    const S = rfiSrc(P);
    // у игроков базы MP и HJ пока одной группой — одна колонка «MP/HJ» (до пересчёта)
    let cols = PL || ['TOT', ...S.cols]; const lab = (p) => (!S.h2n && p === 'MP' && PL && (PL.includes('MP') || PL.includes('HJ')) ? 'MP/HJ' : p);
    if (!S.h2n && PL) cols = [...new Set(cols.map(p => (p === 'HJ' ? 'MP' : p)))];
    const cell = (x, k, p, bs) => ({ v: pctS(x[k], x.n), n: x.n, hm: HMref(P, 'rfi|' + p, k, bs) });
    const RS = G || (byBand ? bands.map(b => [b + ' bb', [b]]) : null);
    const rows = RS ? RS.map(([l, bs]) => [l, ...cols.map(p => cell(S.get(p, bs), 'nai', p, bs))]).filter(r => r.slice(1).some(c => c.n))
      : [['RFI', ...cols.map(p => cell(S.get(p, bands), 'tot', p, bands))], ['NAI', ...cols.map(p => cell(S.get(p, bands), 'nai', p, bands))]];
    const posNote = S.h2n ? '' : ' · EP — все ранние места, MP — HJ и место перед ним';
    blocks.push({ type: 'table', title: title(P) + ' — RFI' + (PL ? ' · ' + cols.map(lab).join(', ') : ' по позициям') + (RS ? ' по стекам' : ''), note: (RS ? 'без олл-инов; стек — свой, без анте' : 'RFI — с олл-инами, NAI — без') + posNote, table: { head: ['', ...cols.map(lab)], rows, grid: true } });
    if (!rows.length) blocks.push({ type: 'text', text: 'В этой ситуации у игрока нет раздач.' });
  }
  else if (intent === 'rfi') {
    // один стат — одна цифра; «по стекам» / «по позициям» / без позиции — таблица (владелец, 23.11.2026)
    const S = rfiSrc(P), pos = posOf(ql), total = /общ|в целом|всего|итог|tot/.test(ql);
    const stackTxt = bands0 ? (bands0.num != null ? 'стек ' + String(bands0.num).replace('.', ',') + ' bb (в диапазоне ' + bands0[0] + ' bb)' : bnote) : 'все стеки';
    const posNote = S.h2n ? '' : ' · EP — все ранние места, MP — HJ и место перед ним';
    const p1 = pos || (total || !(byBand || WANT_TABLE.test(ql)) ? 'TOT' : null); // без позиции и без просьбы о таблице — одна цифра
    if (p1 === 'BB') blocks.push({ type: 'text', title: title(P) + ' — RFI с BB', text: 'С BB RFI не бывает: когда очередь доходит до BB, открыть первым уже нельзя. Можно спросить, например, «колд-колл с BB» или «3-бет с BB».' });
    else if (p1 && !byBand) {
      const x = S.get(p1, bands);
      blocks.push({ type: 'big', hm: HMref(P, 'rfi|' + p1, 'tot', bands), title: title(P) + ' — RFI ' + (p1 === 'TOT' ? 'общий' : 'с ' + p1), big: x.n ? pctS(x.tot, x.n) : 'нет данных', n: x.n, note: stackTxt + (x.n ? ' · без олл-инов ' + pctS(x.nai, x.n) : '') + posNote });
    } else if (p1) {
      const T = { head: ['стек', 'RFI', 'NAI'], rows: [], grid: true };
      for (const b of bands) { const x = S.get(p1, [b]); if (x.n) T.rows.push([b + ' bb', { v: pctS(x.tot, x.n), n: x.n, hm: HMref(P, 'rfi|' + p1, 'tot', [b]) }, { v: pctS(x.nai, x.n), n: x.n, hm: HMref(P, 'rfi|' + p1, 'nai', [b]) }]); }
      blocks.push({ type: 'table', title: title(P) + ' — RFI ' + (p1 === 'TOT' ? 'общий' : 'с ' + p1) + ' по стекам', note: 'NAI — без олл-инов' + posNote, table: T });
    } else blocks.push({ type: 'table', title: title(P) + ' — RFI по позициям', note: stackTxt + (byBand ? ' · по стекам, без олл-инов; стек — свой, без анте' : ' · NAI — без олл-инов') + posNote, table: rfiGrid(P, bands, byBand && !(bands0 && bands0.length === 1)) });
  }  else {
    const t = famTable(P, intent, bands, byBand, G);
    blocks.push({ type: 'table', title: title(P) + ' — ' + FAM_T[intent], note: bnote + (intent === 'vso' ? ' · BTN, CO, HJ — одной группой' : ''), table: t });
    if (!t.rows.length) blocks.push({ type: 'text', text: 'В этой ситуации у игрока нет раздач' + (bands0 ? ' при таком стеке' : '') + '.' });
  }
  // плашка в шапке ответа: учитывается ли олл-ин (владелец, 24.11.2026)
  for (const B of blocks) if (!B.ai && (B.type === 'big' || B.type === 'table')) B.ai = aiTag(B);
  return { key: P.key, player: title(P), group: P.cl != null ? CLU.GROUP[P.cl] : null, intent, blocks, sugg: others };
}

// ---------- сервер ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };
// ---------- голос: Whisper (whisper.cpp, модель держится в памяти) ----------
const BRAIN0 = require('./brain.cjs'); let NOBRAIN = false; // nobrain=1 — проверка без Claude (не тратит счёт)
const BRAIN = { understand: (...a) => (NOBRAIN ? Promise.resolve(null) : BRAIN0.understand(...a)), status: () => BRAIN0.status() };
const WH = { dir: path.join(__dirname, 'whisper'), port: 8791, proc: null, ready: false };
WH.exe = path.join(WH.dir, 'bin', 'Release', 'whisper-server.exe'); WH.model = path.join(WH.dir, 'ggml-large-v3-turbo-q5_0.bin');
// подсказка Whisper: покерные слова пишем как надо (латиница), чтобы реже ошибался
/* подсказка Whisper (26.11.2026): наши слова в нужной форме — на 16 озвученных вопросах ошибок 12 вместо 29 */
const WH_PROMPT = 'Статистика игрока в покере. Мои конбеты в мультивее в позиции как рейзер, цбет-фолд, цбет-колл, ставка в пропуск как коллер, конбет на флопе, на тёрне, на ривере, отложенный цбет, подбет в пот, овербет, маленькая ставка, половина банка, выигрыш на шоудауне. Мои лимпы, лимп-фолд, лимп-рейз, 3-бет, 4-бет в холодную, сквиз, изолейт, колд-колл, фолд на 3-бет, без олл-инов. VPIP, PFR, RFI, W$SD. Баттон, катофф, хайджек, малый блайнд, большой блайнд.';
async function whisperStart() {
  // уже работает (остался от прошлого запуска) — подключаемся к нему
  try { await fetch('http://127.0.0.1:' + WH.port + '/', { signal: AbortSignal.timeout(800) }); WH.ready = true; return; } catch (e) {}
  if (!fs.existsSync(WH.exe) || !fs.existsSync(WH.model)) { console.log('Whisper не найден — голос через Edge'); return; }
  const thr = Math.max(4, Math.min(12, require('os').cpus().length - 2));
  WH.proc = require('child_process').spawn(WH.exe, ['-m', path.basename(WH.model), /* путь с кириллицей Whisper не открывает — короткое имя из своей папки */ '-l', 'ru', '-t', String(thr), '-ac', '768', /* звук до 15 с — вдвое быстрее */ '--host', '127.0.0.1', '--port', String(WH.port), '--prompt', WH_PROMPT], { cwd: WH.dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  WH.proc.stderr.on('data', (d) => { if (/listening|server is listening/i.test(String(d))) WH.ready = true; });
  WH.proc.on('exit', () => { WH.ready = false; WH.proc = null; });
  const ping = setInterval(async () => { try { await fetch('http://127.0.0.1:' + WH.port + '/'); WH.ready = true; clearInterval(ping); } catch (e) {} }, 1000);
}
for (const sig of ['exit', 'SIGINT', 'SIGTERM']) process.on(sig, () => { try { if (WH.proc) WH.proc.kill(); } catch (e) {} if (sig !== 'exit') process.exit(0); });
async function transcribe(wav) {
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'q.wav');
  fd.append('language', 'ru'); fd.append('temperature', '0'); fd.append('response_format', 'json'); fd.append('prompt', WH_PROMPT);
  const r = await fetch('http://127.0.0.1:' + WH.port + '/inference', { method: 'POST', body: fd });
  const j = await r.json(); return String(j.text || '').replace(/\s+/g, ' ').replace(/^\s*[\[(].*?[\])]\s*$/, '').trim();
}
const readBody = (req, max) => new Promise((ok, no) => { const ch = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > max) { no(new Error('слишком длинная запись')); req.destroy(); } else ch.push(c); }); req.on('end', () => ok(Buffer.concat(ch))); req.on('error', no); });

const notFound = (o) => !o || o.nf || (o.blocks || []).some(b => b.text === 'Игрока не нашёл.');
// непонятный вопрос — не карточка, а просьба уточнить (владелец, 24.11.2026). Карточка — только если её просили:
// «покажи игрока / статистику / карточку», «кто такой», или во фразе только ник и служебные слова
const CARD_WORDS = /карточк|статистик|(^|[^а-яё])стат(ы|ов)?([^а-яё]|$)|кто\s*(такой|это)|профил|всё\s*(о|про)|все\s*(о|про)|(^|[^а-яё])(покажи|найди|открой|дай)\s+(мне\s+)?(его|её|ее|игрока|ника?|алиас)|мой\s*алиас|(^|[^а-яё])алиас/;
const FILLER = new Set('покажи покажите показать найди открой дай мне его её ее игрока игрок ник ника пожалуйста ну а и так давай хочу хотел узнать посмотреть скажи это эту этого про о по'.split(' '));
function clarify(out, q0, key) {
  if (key || !out || out.intent !== 'card' || out.nf) return out;
  const ql = String(q0 || '').toLowerCase();
  if (CARD_WORDS.test(ql)) return out;
  const nk = nnorm(((qKey.get(out.key) || {}).nick) || '');
  const left = ql.replace(/[.,!?«»"]+/g, ' ').split(/\s+/).filter(t => t && !FILLER.has(t) && !STOP.has(t) && !(nk && nnorm(t).length >= 2 && nk.includes(nnorm(t))));
  if (!left.length) return out; // только ник — карточка
  return { key: out.key, player: out.player, group: out.group, intent: 'clarify', heard: out.heard, brain: out.brain, blocks: [{ type: 'text', text: (() => { const sg = suggestQs(q0, 3); return sg.length ? 'Не совсем понял' + (out.player ? ' про ' + out.player : '') + '. Может, вы имели в виду — нажмите нужное:' : 'Не понял, что показать' + (out.player ? ' по ' + out.player : '') + '. Уточните, например: «VPIP», «3-беты по позициям», «RFI по стекам», «фолд на 3-бет», «винрейт» или «карточка».'; })() }], sugg: suggestQs(q0, 3).map(t => ({ label: t, q: t })) };
}
// прошлый вопрос даём Claude только для уточнений: в новом вопросе назван стат и нет слов «эту / то же самое / а … / теперь» — это новый вопрос
const REFINE = /(^|[^а-яё])(эт[уоаиы]|то\s*же|тоже|теперь|так\s*же|ещё|еще)([^а-яё]|$)|^\s*(а|и|но|нет)[\s,]/;
/* уточнение без Claude (26.11.2026): «а без позиции?», «а как коллер?», «а на тёрне?», «а на коротких?», «то же без олл-инов», «а 50%», «а сайзинги» —
   берём прошлый вопрос (как бот его понял) и меняем только названную деталь. Если в уточнении есть слова, которых мы не поняли, — отдаём Claude. */
const R_POS = /(^|[^а-яё])в\s*позиц[а-яё]*|(^|[^а-яё])в\s*поз[еу](?![а-яё])|без\s*позиц[а-яё]*|вне\s*позиц[а-яё]*|не\s*в\s*позиц[а-яё]*|без\s*поз[ыу](?![а-яё])|вне\s*поз[ыу](?![а-яё])|(^|[^a-z])(ip|oop)(?![a-z])|out\s*of\s*position|in\s*position/g;
const R_ROLE = /как\s*(рейзер[а-яё]*|колл?ер[а-яё]*|колер[а-яё]*|префлоп\s*рейзер[а-яё]*)|(^|[^а-яё])(рейзер[а-яё]*|колл?ер[а-яё]*|колер[а-яё]*)(?![а-яё])/g;
const R_STACK = /(на|от|до|при)\s*\d+[\d\s,.-]*(до\s*\d+\s*)?(бб|bb|блайнд[а-яё]*|больших\s*блайнд[а-яё]*)|на\s*(коротк|мелк|средн|больш|глубок|супер\s*больш|очень\s*коротк)[а-яё]*(\s*стек[а-яё]*)?|по\s*ст[еэ]к[а-яё]*|ст[еэ]кам/g;
const R_AI = /без\s*(олл|ал+|ул[ыи]н|пуш|all)[а-яё-]*|только\s*(олл|ал+|ул[ыи]н|пуш|all)[а-яё-]*|с\s*(олл|ал+|ул[ыи]н|пуш)[а-яё-]*|олл-?ином|(^|[^a-z])n?ai(?![a-z])/g;
const R_SIZE = /((флоп[а-яё]*|т[её]рн[а-яё]*|терн[а-яё]*|ривер[а-яё]*|отлож[а-яё]*)\s*)?(сайзинг[а-яё]*\s*|размер[а-яё]*\s*)?((от|больше|выше|свыше|более)\s*\d{1,3}\s*%?\s*(до\s*\d{1,3})?|(до|меньше|ниже|менее)\s*\d{1,3}|\d{1,3})\s*(%|процент[а-яё]*|прц)(\s*(на\s*)?(флоп[а-яё]*|т[её]рн[а-яё]*|ривер[а-яё]*))?|((больше|меньше|от|до)\s*)?(половин[а-яё]*|две\s*трет[а-яё]*|трет[а-яё]*|четверт[а-яё]*)\s*(банка|пота)?|(овер|под|пот)\s*-?\s*б[еэ]т[а-яё]*(\s*(на\s*)?(флоп[а-яё]*|т[её]рн[а-яё]*|ривер[а-яё]*))?|маленьк[а-яё]*\s*(ставк|б[еэ]т)[а-яё]*/g;
const R_STREET = /(на\s*)?(флоп[а-яё]*|т[её]рн[а-яё]*|терн[а-яё]*|ривер[а-яё]*)/g;
const R_SEAT = /(с|из|на|для)\s*(баттон[а-яё]*|бтн|btn|кнопк[а-яё]*|катофф?[а-яё]*|кат\s*офф?[а-яё]*|co(?![a-z])|хайджек[а-яё]*|хай\s*джек[а-яё]*|hj(?![a-z])|мп(?![а-яё])|mp(?![a-z])|средн[а-яё]*\s*позиц[а-яё]*|ранн[а-яё]*\s*позиц[а-яё]*|утг|utg|ep(?![a-z])|сб(?![а-яё])|sb(?![a-z])|мал[а-яё]*\s*блайнд[а-яё]*|бб(?![а-яё])|bb(?![a-z])|больш[а-яё]*\s*блайнд[а-яё]*)/g;
const R_FILL = /(^|\s)(а|и|ну|но|теперь|то\s*же(\s*самое)?|тоже(\s*самое)?|так\s*же|ещё|еще|покажи|покажите|мне|для|давай|пожалуйста|что|если|там|это|эту|этот|эти|таблиц[а-яё]*|то|же|самое|сделай|выведи|сейчас|вместо|в|на|с|как|когда|я|мой|мои|конбет[а-яё]*|цбет[а-яё]*|ставк[а-яё]*|ставкой|б[еэ]том|сайзинг[а-яё]*|ставил[а-яё]*|ставлю|поставил[а-яё]*|ставить|банк[а-яё]*|пот[ае]?|размер[а-яё]*\s*(в\s*)?)(?=\s|$)/g; /* «я ставил конбет больше 60% банка» (26.11.2026) */
function isRefine(q, prev) { if (!prev) return false; const l = String(q).toLowerCase().trim(); if (statOf(l) && !/^(а|и|то\s*же|тоже|теперь)\s/.test(l)) return false; return /^(а|и|ну|теперь|то\s*же|тоже|так\s*же|а\s*теперь)(\s|,|$)/.test(l) || l.split(/\s+/).length <= 4; }
function refineMerge(prev, q) {
  const l = ' ' + String(q).toLowerCase().replace(/[?!.,;:]/g, ' ') + ' ';
  let rest = l, p = ' ' + String(prev).toLowerCase() + ' ';
  const take = (re) => { const m = l.match(re); if (!m) return null; rest = rest.replace(re, ' '); return m.map(x => x.trim()).join(' '); };
  const noSz = /без\s*(размер|сайзинг)[а-яё]*/.test(l); if (noSz) rest = rest.replace(/без\s*(размер|сайзинг)[а-яё]*/g, ' ');
  const pos = take(R_POS), role = take(R_ROLE), size = take(R_SIZE), stack = take(R_STACK), ai = take(R_AI), seat = take(R_SEAT);
  const szTab = /сайзинг|размер/.test(rest) && !size ? (rest = rest.replace(/сайзинг[а-яё]*|размер[а-яё]*/g, ' '), 1) : 0;
  let size2 = size; if (size) { const sw = rest.match(R_STREET); if (sw) { rest = rest.replace(R_STREET, ' '); if (!/флоп|т[её]рн|терн|ривер|отлож/.test(size)) size2 = sw.map(x => x.trim()).join(' ') + ' ' + size; } } /* «флоп больше половины банка» — улица к размеру */ if (size2 && !/флоп|т[её]рн|терн|ривер|отлож/.test(size2)) size2 = 'флоп ' + size2; /* размер без улицы — флоп, явно (чтобы следующее «а тёрн 50%» не перетянуло его) */
  const street = !size ? take(R_STREET) : null;
  const tab = /таблиц|по\s*улиц/.test(l) ? 1 : 0, one = /одн[а-яё]*\s*цифр/.test(l) ? (rest = rest.replace(/одн[а-яё]*\s*цифр[а-яё]*/g, ' '), 1) : 0;
  if (rest.replace(R_FILL, ' ').replace(/(^|\s)(в|на|с|по)(?=\s|$)/g, ' ').trim()) return null; /* остались непонятые слова — пусть разберётся Claude */
  if (!pos && !role && !size && !stack && !ai && !street && !szTab && !noSz && !tab && !one && !seat) return null;
  return String(prev).split(' · ').map(part => {
    let x = ' ' + part.toLowerCase() + ' ';
    if (pos) x = x.replace(R_POS, ' ') + ' ' + pos;
    if (role) { x = x.replace(R_ROLE, ' ') + ' ' + (/^как/.test(role) ? role : 'как ' + role); if (/колл?ер|колер/.test(role) && /конбет|цбет|c-?bet|комбет|контбет/.test(x)) x = x.replace(/мо[ийя]\s*(конбет|цбет|комбет|контбет|c-?bet)[а-яё]*/g, 'мои беты в пропуск').replace(/(конбет|цбет|комбет|контбет)[а-яё]*/g, 'бет в пропуск'); if (/рейзер/.test(role) && /пропуск|скип|skip/.test(x)) x = x.replace(/мо[ийя]\s*б[еэ]т[а-яё]*\s*в\s*пропуск/g, 'мои конбеты').replace(/(ставк[а-яё]*|б[еэ]т[а-яё]*)\s*(в|на)\s*пропуск/g, 'конбет'); }
    if (noSz) x = noSize(x); else if (size) { const nk = Object.keys(sizeFilters(size2)); x = x.replace(R_SIZE, (frag) => { const k = Object.keys(sizeFilters(frag)); return k.some(z => nk.includes(z)) ? ' ' : frag; }) + ' ' + size2; } /* меняем размер только той же улицы */
    if (stack) x = x.replace(R_STACK, ' ') + ' ' + (/(на|от|до)\s*(коротк|мелк|средн|больш|глубок|супер|очень)[а-яё\s]*$/.test(stack) && !/стек/.test(stack) ? stack + ' стеках' : stack);
    if (seat) { let done = false; x = x.replace(R_SEAT, (m0) => (done ? m0 : ((done = true), ' ' + seat + ' '))); if (!done) x += ' ' + seat; } /* позиция — на том же месте (до «против» — моя) */
    if (ai) x = x.replace(R_AI, ' ') + ' ' + ai;
    if (street) { x = x.replace(R_STREET, ' ') + ' ' + (/^на/.test(street) ? street : 'на ' + street); }
    if (szTab) x = 'сайзинги ' + x.replace(/мо[ийя]\s*(конбет|цбет)[а-яё]*\s*/, ' конбета ');
    if (tab && !/таблиц/.test(x)) x += ' таблицей'; if (one) x = x.replace(/таблиц[а-яё]*/g, ' ');
    return x.replace(/\s+/g, ' ').trim();
  });
}
/* сверка понимания (владелец 27.11.2026, tgbot/guard.cjs): условия вопроса должны быть в ответе; Claude потерял условие — берём свой разбор слов, если он точнее; не помогло — пишем «проверьте» */
const GUARD = require('./guard.cjs'); let FAKE = '';
async function ask(q0, ctx, key, alts, voice, prevQ, mem) {
  let o = await ask1(q0, ctx, key, alts, voice, prevQ, mem);
  if (key || !o || !o.blocks) return o;
  let miss = GUARD.missing(q0, o);
  if (miss.length && o.brain && !o.refined) { /* Claude понял не так — пробуем свой разбор */
    const sp = splitParts(q0), parts = sp || expandVariants(q0), own = parts ? multiAnswer(parts, ctx, null, isOwn(String(q0).toLowerCase()), !sp) : answer(q0, ctx, null);
    const m2 = own && own.blocks ? GUARD.missing(q0, own) : miss;
    if (m2.length < miss.length && !notFound(own)) { own.brain = { model: o.brain.model, phrase: o.brain.phrase, overruled: 1 }; own.heard = own.heard || q0; o = own; miss = m2; }
  }
  if (miss.length) { o.guard = miss; o.blocks = [{ type: 'text', title: 'Проверьте, так ли я понял', text: 'В вопросе есть: ' + miss.map(x => '«' + x + '»').join(', ') + ' — а в ответе этого не видно. Возможно, я понял вопрос не так: переформулируйте или уточните.' }, ...o.blocks]; }
  return o;
}
async function ask1(q0, ctx, key, alts, voice, prevQ, mem) { const ql0 = String(q0 || '').toLowerCase();
  if (!key && prevQ && isRefine(q0, prevQ)) { const m = refineMerge(prevQ, q0); if (m) { const own = isOwn(String(prevQ).toLowerCase()), o = m.length > 1 ? multiAnswer(m, ctx, voice && ctx ? { own, src: m.join(' ') } : null, own, true) : answer(m[0], ctx, null, voice && ctx ? { own, src: m[0] } : null); o.heard = m.join(' · '); o.refined = 1; return clarify(o, m[0], key); } }
  if (!key && !FAKE && (NOBRAIN || !BRAIN.status().ready)) { const sp = splitParts(q0), parts = sp || expandVariants(q0); if (parts) { const src = ql0, own = isOwn(src); return multiAnswer(parts, ctx, voice && ctx ? { own, src } : null, own, !sp); } } if (prevQ && !REFINE.test(ql0) && (statOf(ql0) || intentOf(ql0) !== 'card')) prevQ = ''; return clarify(await ask0(q0, ctx, key, alts, voice, prevQ, mem), q0, key); }// ---------- несколько просьб в одном вопросе (владелец, 24.11.2026): все ответы подряд в одном сообщении ----------
/* часть — самостоятельная просьба: в ней сам назван стат (не только позиция / стек / уточнение) */
const partOwn = (sg) => { const l = wordsToNum(normRFI(String(sg))).toLowerCase(); return !!statOf(l) && !/^\s*(с|из|на|от|по|без|только|в)\s/.test(l); };
const partId = (p) => { const l = wordsToNum(normRFI(String(p))).toLowerCase(); return statOf(l) || (intentOf(l) !== 'card' ? intentOf(l) : null); };
// запасной разбор (без Claude): делим по «и», запятым, «а также», «плюс», если в частях РАЗНЫЕ статы
function splitParts(q) { if (isTLN(String(q || '').toLowerCase())) return null; /* линия против BB — один вопрос («ставя все 3 улицы и завершая олл-ином») */
  const segs = String(q || '').split(/\s*(?:,|;|\s+и\s+|\s+а\s+также\s+|\s+плюс\s+|\s+ещё\s+|\s+еще\s+)\s*/i).filter(Boolean), parts = [];
  for (const sg of segs) { { /* «цбет фолд на флопе и на тёрне» — вторая часть только с улицей: тот же стат на другой улице (27.11.2026) */ const l0 = SHARE.reduce((x, re) => x.replace(new RegExp(re.source, 'g'), ' '), sg.toLowerCase()).trim(); if (parts.length && parts[parts.length - 1].id && /^((на|по)\s*)?(флоп|т[её]рн|терн|ривер)[а-яё]*$/.test(l0)) { const pv = parts[parts.length - 1]; parts.push({ t: pv.t.replace(/((на|по)\s*)?(флоп|т[её]рн|терн|ривер)[а-яё]*/gi, ' ').replace(/\s+/g, ' ').trim() + ' ' + sg, id: pv.id }); continue; } }
    let id = partId(sg); if (isTCB(String(q).toLowerCase()) && parts.length && !CB_RE.test(sg.toLowerCase()) && !/фолд|fold|сбрас|колл?|call|3\s*-?\s*б[еэ]т|три\s*-?\s*б[еэ]т|рейз/.test(sg.toLowerCase())) id = null; /* Total CBET: часть без своего хода («и прочеканного тёрна») — продолжение того же вопроса (27.11.2026) */ if (parts.length && /(^|[^а-яё])после(?![а-яё])/.test(parts[parts.length - 1].t.toLowerCase()) && /^(мо[её]го\s*|моей\s*)?((мелк|маленьк|больш|крупн)[а-яё]*\s*)?(конбета|цбета|контбета|комбета|c-?bet|бета|ставки|чек\s*-?\s*чека|чек\s*-?\s*рейза|рейза|колла)(?![а-яё])/.test(sg.toLowerCase().trim())) id = null; /* «бет на ривере после чек-чека по тёрну и конбета флопа» — «конбета …» в родительном после «после» — то же условие (владелец 27.11.2026) */ { const l = sg.toLowerCase().trim(); if (/^(когда|если|где|при\s|чтобы|котор|причём|причем|то\s*есть|являюсь|я\s+являюсь|после|перед|в\s*мультив|как\s+я\s|как\s+только|против\s|в\s*х[еэ]дс|один\s*на\s*один|вдво[её]м)/.test(l)) id = null; /* придаточная часть — продолжение того же вопроса (26.11.2026) */ if (id && /\d\s*(%|процент)|половин|трет|четверт|овербет|подбет|маленьк[а-яё]*\s*(ставк|б[еэ]т)/.test(l) && !partId(noSize(l).replace(/(^|\s)(флоп|т[её]рн|ривер)[а-яё]*/g, ' '))) id = null; /* только размер («и тёрн от 50%») — тот же вопрос */ } if ((id === 'WSD' || id === 'WTSD' || id === 'wsd') && /\d\s*(%|процент)|овербет|подбет|потбет|маленьк[а-яё]*\s*(ставк|б[еэ]т)|половин|трет|размер[а-яё]*\s*(в\s*)?(банк|пот)[а-яё]*|(в|на)\s*(весь\s*)?пот(?![а-яё])|пот\s*-?\s*сайз[а-яё]*/.test(String(q).toLowerCase()) && /вскрыт|шоу?\s*-?\s*даун/.test(sg.toLowerCase())) id = null; /* «… и как часто выигрываю на шоудауне» после размера — часть того же вопроса */ if (/^\s*(без|только|с|включая)\s*(олл|ал+|ул[ыи]н|пуш|all|nai|ai)/i.test(sg)) id = null; /* «… и без олл-инов» — вариант, не новый стат */ if (id === 'ai' && /без|только|олл|пуш|ул[ыи]н/.test(sg.toLowerCase()) && !/колл?[а-яё]*\s+олл|олл[а-яё-]*\s+колл/.test(sg.toLowerCase())) id = null; /* «…без олл-инов» — уточнение, а не отдельный вопрос */ if (id && parts.length && /^(колл?[а-яё]*|рейз[а-яё]*)$/i.test(sg.split(/\s+/)[0]) && /против\s+(рейз|опен)/i.test(parts[parts.length - 1].t)) id = null; if (id && (!parts.length || parts[parts.length - 1].id !== id || (id !== 'OC' && /[а-яёa-z]{3,}/.test(sg) && partOwn(sg)))) parts.push({ t: sg, id }); /* тот же стат, но своя просьба («цбет-фолд и цбет-колл», «лимп-фолд и лимп-рейз») — отдельная часть (26.11.2026) */ else if (parts.length) parts[parts.length - 1].t += ' ' + sg; else parts.push({ t: sg, id }); }
  const real = parts.filter(p => p.id); return real.length > 1 ? real.map(p => p.t) : null; // вступление без стата («покажи два…») отбрасываем
}
/* варианты одного стата в одном вопросе (владелец 26.11.2026, весь проект): «в позиции и без позиции», «без олл-инов и олл-ины», «по позициям и по стекам» — ответ на каждый подряд */
const V_OOP = /без\s*позиц[а-яё]*|вне\s*позиц[а-яё]*|не\s*в\s*позиц[а-яё]*|без\s*поз[ыу](?![а-яё])|вне\s*поз[ыу](?![а-яё])|не\s*в\s*поз[еу](?![а-яё])|(^|[^a-z])oop(?![a-z])|out\s*of\s*position|аут\s*оф\s*поз[а-яё]*/g, V_IP = /(^|[^а-яё])в\s*позиц[а-яё]*|(^|[^а-яё])в\s*поз[еу](?![а-яё])|(^|[^a-z])ip(?![a-z])|in\s*position/g;
const V_NAI = /без\s*(олл[\s-]*ин|ал+[\s-]*ин|ул[ыи]н|пуш|all[\s-]*in)[а-яё]*|(^|[^a-z])nai(?![a-z])/g, V_AI = /(только\s*|с\s*)?(олл[\s-]*ин|ал+[\s-]*ин|ул[ыи]н|пуш|all[\s-]*in)[а-яё]*|(^|[^a-z])ai(?![a-z])/g;
function expandVariants(q) {
  let out = [String(q)];
  const each = (fn) => { out = out.flatMap(x => fn(x) || [x]); };
  each((x) => { const l = x.toLowerCase(); if (!new RegExp(V_OOP.source).test(l)) return null; const rest = l.replace(V_OOP, ' '); if (!new RegExp(V_IP.source).test(rest)) return null; const base = rest.replace(V_IP, ' ').replace(/\s+и\s*(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim(); return [base + ' в позиции', base + ' без позиции']; });
  each((x) => { const l = x.toLowerCase(); if (!new RegExp(V_NAI.source).test(l)) return null; const rest = l.replace(V_NAI, ' '); const m = new RegExp(V_AI.source).exec(rest); if (!m) return null; const withAll = /(^|[^а-яё])с\s*(олл|ал+|ул|пуш|all)/.test(rest) && !/только/.test(m[0]); const base = rest.replace(V_AI, ' ').replace(/\s+и\s*(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim(); return withAll ? [base, base + ' без олл-инов'] : [base + ' без олл-инов', base + ' только олл-ины']; });
  each((x) => { const l = x.toLowerCase(); if (!(/по\s*позици/.test(l) && /по\s*ст[еэ]к|ст[еэ]кам/.test(l))) return null; const base = l.replace(/по\s*позици[а-яё]*/g, ' ').replace(/по\s*ст[еэ]к[а-яё]*|ст[еэ]кам/g, ' ').replace(/\s+и\s*(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim(); return [base + ' по позициям', base + ' по стекам']; });
  return out.length > 1 ? out : null;
}
/* части вопроса делят общие уточнения: «мой цбет-фолд и цбет-колл в мультивее в позиции» — «в мультивее в позиции» нужны обеим */
const SHARE = [/против\s*(бб|bb|би\s*би|больш[а-яё]*\s*блайнд[а-яё]*)(?![a-zа-яё])|(в\s*)?х[еэ]дс?\s*-?\s*ап[а-яё]*/, /в\s*мульти[а-яё]*|мультипот[а-яё]*/, /без\s*позиц[а-яё]*|вне\s*позиц[а-яё]*|out\s*of\s*position|(^|\s)в\s*позиц[а-яё]*/, /без\s*(олл|ул|пуш)[а-яё-]*|только\s*(олл|ул|пуш)[а-яё-]*|олл-?ином/, /(на|от)\s*\d+[^а-яё]*(до\s*\d+\s*)?(бб|bb|блайнд[а-яё]*)|на\s*(коротк|средн|больш|глубок)[а-яё]*\s*стек[а-яё]*/];
function shareMods(parts) { const ps = parts.map(String); for (const re of SHARE) { const src = ps.find(p => re.test(p.toLowerCase())); if (!src) continue; const m = re.exec(src.toLowerCase())[0].trim(); for (let i = 0; i < ps.length; i++) if (!re.test(ps[i].toLowerCase())) ps[i] += ' ' + m; } return ps; }
function multiAnswer(parts, ctx, lock, own, variants) {
  /* variants — части уже варианты одного вопроса: уточнения между ними не переносим */
  parts = variants ? parts : shareMods(parts).flatMap(p => expandVariants(p) || [p]);
  // игрок из первой части переносится на остальные: «мои 3-беты … и колд-коллы …» — оба про меня
  const outs = parts.map(p => { const pl = String(p).toLowerCase(), lk = lock ? { own: lock.own || isOwn(pl), src: lock.src } : null; return answer((own && !isOwn(pl) ? 'мой ' : '') + p, ctx, null, lk); });
  const base = outs.find(o => !notFound(o)) || outs[0];
  return Object.assign({}, base, { intent: 'multi', blocks: outs.flatMap(o => o.blocks || []), heard: outs.map(o => o.heard).filter(Boolean).join(' · ') });
}/* страховка: в самом вопросе «4-бет в холодную / open 4bet», а Claude потерял «в холодную» — вернуть (25.11.2026) */
function fixPhrase(q0, B) { if (!B || !B.phrase) return B; const src = String(q0).toLowerCase(); if (MW_Q.test(src) && MWL_W.test(src)) { B.phrase = String(q0); B.parsed = null; return B; } /* линии и успешность ставок в мультивее — свой разбор (26.11.2026) */ if (mwRoute(src) === 'MWB') { B.phrase = String(q0); B.parsed = null; return B; } if (isTLN(src) || (!MW_Q.test(src) && CB_RE.test(src) && (HU_BB.test(src) || HU_W.test(src) || TOT_CB.test(src)))) { B.phrase = String(q0); B.parsed = null; return B; } /* Total CBET / конбеты против BB — свой разбор (26.11.2026) */ /* мультивей без роли — не даём Claude выбрать роль за человека */ { const SZ = /(от|до|больше|меньше|выше|ниже)?\s*\d{1,3}\s*(%|процент[а-яё]*)/g; let mm; const add = []; while ((mm = SZ.exec(src))) { const w = src.slice(Math.max(0, mm.index - 45), mm.index); let sw = '', bi = -1; for (const re of [/отлож[а-яё]*|дил[еэ]й/g, /ривер[а-яё]*/g, /т[её]рн[а-яё]*/g, /флоп[а-яё]*/g]) { let z; while ((z = re.exec(w))) if (z.index > bi) { bi = z.index; sw = z[0]; } } add.push((sw ? sw + ' ' : '') + mm[0].trim()); } { const WS = /размер[а-яё]*\s*(в\s*)?(банк|пот)[а-яё]*|(в|на)\s*(весь\s*)?пот(?![а-яё])|пот\s*-?\s*сайз[а-яё]*|((больше|меньше|от|до|свыше|более|менее)\s*)?(половин[а-яё]*|две\s*трет[а-яё]*|трет[а-яё]*|четверт[а-яё]*)\s*(банка|пота)?|овер\s*-?\s*б[еэ]т[а-яё]*|(под|пот)\s*-?\s*б[еэ]т[а-яё]*|маленьк[а-яё]*\s*(ставк|б[еэ]т)[а-яё]*/g; let ww; while ((ww = WS.exec(src))) { const w = src.slice(Math.max(0, ww.index - 45), ww.index), w2 = src.slice(ww.index + ww[0].length, ww.index + ww[0].length + 18); let sw = (/^\s*(на\s*)?(флоп|т[её]рн|ривер)[а-яё]*/.exec(w2) || [])[0] || ''; if (!sw) { let bi = -1; for (const re of [/отлож[а-яё]*|дил[еэ]й/g, /ривер[а-яё]*/g, /т[её]рн[а-яё]*/g, /флоп[а-яё]*/g]) { let z; while ((z = re.exec(w))) if (z.index > bi) { bi = z.index; sw = z[0]; } } } add.push((ww[0] + ' ' + sw).trim()); } } if (add.length && !/\d\s*(%|процент)|половин|трет|четверт|овербет|подбет|маленьк|пот(?![а-яё])/.test(B.phrase)) B.phrase += ' ' + add.join(' '); } /* размер словами тоже (26.11.2026) */ if (MW_Q.test(src)) { const ph = B.phrase.toLowerCase(); if (ROLE_R.test(src) && !ROLE_C.test(src) && !ROLE_R.test(ph)) B.phrase += ' как рейзер'; if (ROLE_C.test(src) && !ROLE_R.test(src) && !ROLE_C.test(ph)) B.phrase += ' как коллер'; if (!/конбет|цбет|c-?bet|комбет|контбет|(^|[^a-z])cb(?![a-z])|си\s*бэт/.test(src) && /цбет|конбет/.test(ph) && /ставк|ставл|б[еэ]т/.test(src)) B.phrase = B.phrase.replace(/(мо[йия]\s*)?(цбет|конбет)[а-яё]*/i, 'ставка'); } /* мультивей: роль из вопроса; «ставка» не превращать в «цбет» (26.11.2026) */ if (/\d\s*(%|процент)|половин|трет|четверт|овербет|подбет|маленьк|размер[а-яё]*\s*(в\s*)?(банк|пот)[а-яё]*|(в|на)\s*(весь\s*)?пот(?![а-яё])|пот\s*-?\s*сайз[а-яё]*/.test(src) && SQ_W.test(src) && !SQ_W.test(B.phrase.toLowerCase())) B.phrase += ' как часто'; /* вопрос про размер — не превращать в таблицу */ /* размер ставки из вопроса — всегда в фразу (26.11.2026) */ if (COLD4_RE.test(src) && !COLD4_RE.test(B.phrase.toLowerCase())) B.phrase = /4\s*-?\s*бет[а-яё]*/i.test(B.phrase) ? B.phrase.replace(/4\s*-?\s*бет[а-яё]*/i, '4-бет в холодную') : B.phrase + ' 4-бет в холодную'; if (FSQ_RE.test(src) && !FSQ_RE.test(B.phrase.toLowerCase()) && /сквиз/i.test(B.phrase)) B.phrase = B.phrase.replace(/сквиз[а-яё]*/i, 'фолд на сквиз'); return B; }
async function ask0(q0, ctx, key, alts, voice, prevQ, mem) {
  if (key || !q0) return answer(q0, ctx, key);
  if (voice && ctx) {
    const src = String(q0).toLowerCase(), lock = { own: isOwn(src), src };
    const B = fixPhrase(q0, await BRAIN.understand(q0, (qKey.get(ctx) || {}).nick, prevQ, mem));
    // явная смена игрока голосом: «… игрока X», «ник X» (или открыта своя база и назван чужой ник) — ищем X, нет — похожие ники
    const bNick = B && B.parsed && !B.parsed.me ? String(B.parsed.nick || '').trim() : '';
    const marker = /(^|[^a-zа-яё])(игрок[а-яё]*|ник[а-яё]*)([^a-zа-яё]|$)/i.test(src);
    const ctxNick = ((qKey.get(ctx) || {}).nick || '').toLowerCase();
    if (!lock.own && (marker || /^alias:/.test(ctx)) && (bNick || (!B && marker)) && bNick.toLowerCase() !== ctxNick) {
      const spec = B ? specFromBrain(B.parsed) : null;
      let o = B ? answer(B.phrase, null, null, null, spec) : answer(q0, null, null);
      if (notFound(o)) o = notFoundMsg(q0, bNick || null);
      if (B) o.brain = { model: BRAIN.status().model, phrase: B.phrase };
      return o;
    }
    if (B && B.parsed && Array.isArray(B.parsed.parts) && B.parsed.parts.length > 1) { const o = multiAnswer(B.parsed.parts, ctx, lock, lock.own); o.brain = { model: BRAIN.status().model, phrase: o.heard }; return o; }
    let out = null, best = -1;
    // Claude понял вопрос — его ответ главный (свой разбор слов — только если Claude нет); таблицу строим по его описанию
    if (B && B.phrase && expandVariants(B.phrase)) { const o = multiAnswer(expandVariants(B.phrase), ctx, lock, lock.own, true); o.brain = { model: BRAIN.status().model, phrase: B.phrase }; return o; }
    if (B && B.phrase) { out = answer(B.phrase, ctx, null, lock, specFromBrain(B.parsed)); out.brain = { model: BRAIN.status().model, phrase: B.phrase }; return out; }
    for (const q of [q0, ...alts]) { const o = answer(q, ctx, null, lock), sc = voiceScore(o); if (sc > best) { best = sc; out = o; } }
    return out;
  }
  // мозг (Claude): понимает вопрос любыми словами → точная фраза; цифры — из базы. Нет ключа — свой разбор слов.
  const prev = ctx ? (qKey.get(ctx) || {}).nick : null;
  const B = fixPhrase(q0, FAKE ? { phrase: FAKE, parsed: null } : await BRAIN.understand(q0, prev, prevQ, mem)); /* FAKE — только для проверки: «как будто Claude понял так» (tests/tgbot_logcheck.cjs), бесплатно */
  const cands = [];
  if (B && B.parsed && Array.isArray(B.parsed.parts) && B.parsed.parts.length > 1) { const o = multiAnswer(B.parsed.parts, ctx, null, isOwn(String(q0).toLowerCase())); o.brain = { model: BRAIN.status().model, phrase: o.heard }; return o; }
  if (B && B.phrase && expandVariants(B.phrase)) { const o = multiAnswer(expandVariants(B.phrase), ctx, null, isOwn(String(q0).toLowerCase()), true); o.brain = { model: BRAIN.status().model, phrase: B.phrase }; return o; }
  if (B && B.phrase) {
    const spec = specFromBrain(B.parsed); let o = answer(B.phrase, ctx, null, null, spec);
    // ник не нашёлся как есть — берём самый «большой» ник, который так начинается
    if (notFound(o) && B.parsed && B.parsed.nick) { const lo = B.parsed.nick.toLowerCase().replace(/\s+/g, ''); const r = lo.length >= 3 ? qPrefix.all(lo, lo + '￿').filter(x => x.room !== 'alias')[0] : null; if (r) o = answer(B.phrase.replace(B.parsed.nick, r.nick), ctx, null, null, spec); }
    if (!notFound(o)) { o.brain = { model: BRAIN.status().model, phrase: B.phrase }; return o; } // Claude понял — его ответ главный
  }
  let out = cands[0] || null, best = out ? voiceScore(out) + 1 : -1; // при равенстве — понимание Claude
  for (const q of [q0, ...alts]) { const o = answer(q, ctx, key), sc = voiceScore(o); if (sc > best) { best = sc; out = o; } }
  if (notFound(out)) out = notFoundMsg(q0, B && B.parsed && !B.parsed.me ? B.parsed.nick : null); // нет такого ника — похожие из базы кнопками (владелец, 24.11.2026)
  return out;
}

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const J = (o) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/stt' && req.method === 'POST') {
    const t0 = Date.now();
    if (!WH.ready) return J({ error: 'Whisper ещё загружается — подождите несколько секунд' });
    try { const text = await transcribe(await readBody(req, 8 << 20)); return J({ text, ms: Date.now() - t0 }); } catch (e) { return J({ error: 'Не получилось распознать: ' + e.message }); }
  }
  if (u.pathname === '/api/hm') { let refs = []; try { refs = JSON.parse(u.searchParams.get('r') || '[]'); } catch (e) {} const out = {}; for (const R of [].concat(refs)) { const r = R && (R.rec ? recHm(R) : hmGet(String(R.p), String(R.m), String(R.b || 'all'), R.dm || '')); if (r) for (const [c, v] of Object.entries(r)) { const x = out[c] = out[c] || [0, 0]; x[0] += v[0]; x[1] += v[1]; } } return J(Object.keys(out).length ? { cells: out } : { none: true }); }
  if (u.pathname === '/api/status') return J({ whisper: WH.ready, brain: BRAIN.status() });
  if (u.pathname === '/api/ask') {
    const t0 = Date.now(); let out;
    const q0 = u.searchParams.get('q'), ctx = u.searchParams.get('ctx'), key = u.searchParams.get('key');
    let alts = []; try { alts = JSON.parse(u.searchParams.get('alts') || '[]').filter(x => typeof x === 'string').slice(0, 12); } catch (e) { alts = []; }
    try { NOBRAIN = !!u.searchParams.get('nobrain'); FAKE = NOBRAIN ? String(u.searchParams.get('fake') || '') : ''; let mem = []; try { mem = JSON.parse(u.searchParams.get('mem') || '[]').filter(x => x && typeof x === 'object').slice(-3); } catch (e) { mem = []; } out = await ask(dedupPhrase(fuzzyFix(voiceFix(q0))), ctx, key, alts, !!u.searchParams.get('voice'), u.searchParams.get('prev') || '', mem); } catch (e) { out = { blocks: [{ type: 'text', text: 'Ошибка: ' + e.message }] }; } finally { NOBRAIN = false; FAKE = ''; }
    try { fs.appendFileSync(path.join(__dirname, 'data', 'asks.log'), JSON.stringify({ t: new Date().toISOString(), voice: !!u.searchParams.get('voice'), q: q0, alts, brain: out.brain || null, heard: out.heard, intent: out.intent, player: out.player || null, guard: out.guard || undefined, overruled: (out.brain && out.brain.overruled) || undefined }) + '\n'); /* guard — сверка нашла условие вопроса, которого нет в ответе */ } catch (e) {}
    out.ms = Date.now() - t0;
    return J(out);
  }  if (u.pathname === '/api/suggest') {
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
srv.listen(PORT, '127.0.0.1', () => { console.log('TG-бот: http://127.0.0.1:' + PORT); whisperStart(); });
module.exports = { answer };
