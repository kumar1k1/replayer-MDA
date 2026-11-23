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
  const row = (lab, bs, k) => [lab, ...['TOT', ...S.cols].map(p => { const x = S.get(p, bs); return { v: pctS(x[k], x.n), n: x.n }; })];
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
  ['MP', /мидл|middle|средн\w*\s*позиц|позиц\w*\s*средн/, W('mp|мп|эм пи')],
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
// ---------- таблица под запрос (владелец, 24.11.2026): строки — названные группы стеков, колонки — названные позиции ----------
// стеки в базе копятся диапазонами BANDS; группа «от … до …» берёт диапазоны, чья середина внутри неё, подпись — реальные границы
const BANDR = { '<12': [0, 12], '12-19': [12, 20], '20-35': [20, 36], '36-59': [36, 60], '60-99': [60, 100], '100-149': [100, 150], '150+': [150, Infinity] };
const bandsIn = (lo, hi) => BANDS.filter(b => { const [a, z] = BANDR[b], m = z === Infinity ? 175 : (a + z) / 2; return m >= (lo == null ? 0 : lo) && m < (hi == null ? Infinity : hi); });
const grpLabel = (name, bs) => { const a = BANDR[bs[0]][0], z = BANDR[bs[bs.length - 1]][1]; const r = a === 0 ? 'до ' + z + ' bb' : z === Infinity ? a + '+ bb' : a + '–' + (z - 1) + ' bb'; return name ? name + ' (' + r + ')' : r; };
const SG = { short: ['короткие', 0, 20], mid: ['средние', 20, 60], deep: ['большие', 60, null] };
function groupsRule(ql) {
  const q = ql.replace(/больш\w*\s*блайнд\w*|\d+\s*больш\w*/g, ' ');
  const sup = /(супер|очень|сверх)\s*-?\s*(больш|глубок)/.test(q), q2 = q.replace(/(супер|очень|сверх)\s*-?\s*(больш|глубок)\w*/g, ' ');
  const k = /коротк|мелк/.test(q), m = /средн\w*(?!\s*позиц)/.test(q) && /ст[еэ]к|коротк|мелк|больш|глубок|сайз/.test(q), d = /больш|глубок|длинн/.test(q2);
  if (sup && (k + m + d) >= 1) return [k && SG.short, m && SG.mid, d && ['большие', 60, 100], ['супер большие', 100, null]].filter(Boolean).map(([n, lo, hi]) => { const bs = bandsIn(lo, hi); return [grpLabel(n, bs), bs]; });
  if ((k + m + d) < 2 && !((k || m || d) && /тип\w*|групп\w*/.test(q))) return null;
  return [k && SG.short, m && SG.mid, d && SG.deep].filter(Boolean).map(([n, lo, hi]) => { const bs = bandsIn(lo, hi); return [grpLabel(n, bs), bs]; });
}
// позиции, названные во фразе (несколько)
// группы позиций: ранние — EP; средние — MP, HJ; поздние — CO, BTN; блайнды — SB (владелец, 24.11.2026)
function posListRule(ql) { const out = []; for (const [p, a, b] of POS_RE) if (a.test(ql) || b.test(ql)) out.push(p);
  if (/средн\w*\s*позиц|позиц\w*\s*средн/.test(ql)) out.push('MP', 'HJ'); if (/поздн\w*\s*позиц|позиц\w*\s*поздн|поздн\w*\s*мест/.test(ql)) out.push('CO', 'BTN'); if (/ранн\w*\s*позиц|позиц\w*\s*ранн/.test(ql)) out.push('EP'); if (/блайнд\w*\s*позиц|из\s*блайнд/.test(ql)) out.push('SB'); return ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'].filter(p => out.includes(p)); }
// описание таблицы от Claude: { stack_groups: [{name, from, to}], positions: [...] }
function specFromBrain(o) {
  if (!o) return null; const sp = {};
  if (Array.isArray(o.stack_groups) && o.stack_groups.length) sp.groups = o.stack_groups.map(g => { const bs = bandsIn(g.from, g.to); return bs.length ? [grpLabel(g.name || '', bs), bs] : null; }).filter(Boolean);
  if (Array.isArray(o.positions) && o.positions.length > 1) sp.pos = ['EP', 'MP', 'HJ', 'CO', 'BTN', 'SB'].filter(p => o.positions.includes(p));
  return sp.groups || sp.pos ? sp : null;
}function intentOf(q) {
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
  ['FRB', /фолд\w*\s*(на|против)\s*(бет\w*|ставк\w*)\s*(на\s*)?ривер|fold\s*to\s*(bet\s*)?river|сброс\w*\s*на\s*ривер/],
  ['BR', /бет\s*ривер|бет\w*\s*на\s*ривер|bet\s*river|став\w*\s*на\s*ривер/],
  ['F3', /фолд\w*\s*(на|против)\s*(3|три|тр[её]х)\s*-?\s*бет|fold\s*to\s*3|ф3б/],
  ['WWSF', /wwsf|ввсф|в\s*в\s*с\s*ф|вэ\s*вэ\s*эс\s*эф|ввсэф|дабл\w*\s*дабл\w*|выигр\w*\s*(когда|после|если)\s*(увид\w*\s*)?флоп|won\s*when\s*saw/],
  ['WSD', /w\s*\$\s*sd|wssd|w\$sd|в\s*\$\s*сд|в\s*доллар\w*\s*с\s*д|вссд|в\s*с\s*с\s*д|вдсд|вин\s*доллар|w\s*money|выигр\w*\s*на\s*(шоу\s*даун\w*|вскрыти\w*)|won\s*at\s*showdown/],
  ['WTSD', /wtsd|втсд|в\s*т\s*с\s*д|вэ\s*тэ\s*эс\s*дэ|went\s*to\s*show|доход\w*\s*до\s*(шоу\s*даун\w*|вскрыти\w*)|ход\w*\s*на\s*(шоу\s*даун|вскрыти)|шоу\s*даун|шоудаун|вскрыти/],
  ['VPIPPFR', /(vpip|впип|в\s*п\s*и\s*п|випип).{0,12}(pfr|пфр|п\s*ф\s*р)/],
  ['VPIP', /vpip|впип|в\s*п\s*и\s*п|вэ\s*пэ\s*ай\s*пи|ви\s*пи\s*ай\s*пи|випиай|випип|вип\b/],
  ['PFR', /pfr|пфр|п\s*ф\s*р|пэ\s*эф\s*эр|пи\s*эф\s*ар|префлоп\w*\s*рейз/],
  ['3B', /(3|три|тр[её]х)\s*-?\s*бет|трибет|3bet|три\s*бэт/],
  ['LIMP', /лимп|limp/],
  ['SQ', /квадрат|фиат/],
];
const NO_STAT = /rfi|опен|открыт|первым|стил|сквиз|изо(?![а-яё])|против\s*(опен|лимп|олл)|колл\s*опен|на\s*опен|винрейт|winrate|выигрыш|профит|bb\/100|бб\/100/;
function statOf(ql) { if (NO_STAT.test(ql)) return null; for (const [id, re] of STATS) if (re.test(ql)) return id; return null; }
const WANT_TABLE = /таблиц|по\s*позици|по\s*ст[еэ]к|ст[еэ]кам|разбив/;
const STAT_RU = { VPIP: 'VPIP', PFR: 'PFR', VPIPPFR: 'VPIP / PFR', '3B': '3-бет NAI', F3: 'Фолд на 3-бет', LIMP: 'Лимп (не SB)', WTSD: 'WTSD', WSD: 'W$SD', WWSF: 'WWSF', BR: 'Bet River', FRB: 'Fold to Bet River' };
const H3POS = ['MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
function statBlocks(P, id, ql) {
  const f1 = (v) => (v == null ? '—' : String(v).replace('.', ','));
  const big = (name, v, n, note) => ({ type: 'big', title: title(P) + ' — ' + name, big: n ? v : 'нет данных', n, note });
  const c = (nm) => clStat(P, nm);
  if (id === 'SQ') { const k = card(P); return [{ type: 'card', title: title(P) + ' — квадрат', square: k.square }]; }
  if (id === 'VPIPPFR') { const a = c('VPIP'), b = c('PFR'); return [big('VPIP / PFR', f1(a.p) + ' / ' + f1(b.p), a.n, '')]; }
  if (id === 'VPIP' || id === 'PFR') { const a = c(id); return [big(id, f1(a.p) + '%', a.n, '')]; }
  if (id === 'LIMP') { const a = c('LimpNSB'); return [big('лимп первым (кроме SB)', f1(a.p) + '%', a.n, '')]; }
  if (id === 'F3') { const a = c('F3Bet'); return [big('фолд на 3-бет', f1(a.p) + '%', a.n, '')]; }
  if (id === 'BR' || id === 'FRB') { const a = c(id === 'BR' ? 'BetRiverHU' : 'FoldRiverBetHU'); return [big(STAT_RU[id], f1(a.p) + '%', a.n, 'банки один на один')]; }
  if (id === '3B') {
    // по позициям — как Hand2Note (у алиаса); одна позиция — одна цифра
    const H = P.ext && P.ext.h3, pos = posOf(ql), tbl = WANT_TABLE.test(ql);
    if (H && (tbl || pos)) {
      if (pos && !tbl) { const p = pos === 'EP' ? 'MP' : pos, x = H[p]; return [big('3-бет NAI с ' + p, x ? pctS(x[1], x[0]) : '—', x ? x[0] : 0, 'как в Hand2Note: против одного опена без коллеров' + (pos === 'EP' ? ' · ранние места у Hand2Note — MP' : ''))]; }
      const rows = [['NAI', ...['TOT', ...H3POS].map(p => { const x = H[p]; return x ? { v: pctS(x[1], x[0]), n: x[0] } : { v: '—', n: 0 }; })]];
      return [{ type: 'table', title: title(P) + ' — 3-бет NAI по позициям', note: 'как в Hand2Note: против одного опена без коллеров, BB — без защиты против SB', table: { head: ['', 'TOT', ...H3POS], rows, grid: true } }];
    }
    if (tbl) return null; // у игроков базы — прежняя таблица «против опена»
    if (H && H.TOT) return [big('3-бет NAI', pctS(H.TOT[1], H.TOT[0]), H.TOT[0], 'как в Hand2Note: против одного опена без коллеров')];
    const a = c('3BetNAI'); return [big('3-бет NAI', f1(a.p) + '%', a.n, '')];
  }
  // WTSD / W$SD / WWSF: у алиаса — по всем банкам с флопом (TOTAL), иначе / по просьбе «один на один» — HU
  const WS = c('WS'), LS = c('LS'), WN = c('WN'), HU = WS.n, T = P.ext && P.ext.tot;
  const hu = /хед|heads|один\s*на\s*один|1\s*на\s*1|\bhu\b|ху\b|хью/.test(ql) || !(T && T.fl);
  const pv = (a, b) => (b ? f1(pct(a, b)) + '%' : '—');
  const val = { WTSD: hu ? [WS.h + LS.h, HU] : [T.sd, T.fl], WSD: hu ? [WS.h, WS.h + LS.h] : [T.sdw, T.sd], WWSF: hu ? [WS.h + WN.h, HU] : [T.won, T.fl] }[id];
  const other = hu && T && T.fl ? null : { WTSD: [WS.h + LS.h, HU], WSD: [WS.h, WS.h + LS.h], WWSF: [WS.h + WN.h, HU] }[id];
  return [big(STAT_RU[id] + (hu ? ' (один на один)' : ' (TOTAL)'), pv(val[0], val[1]), val[1], hu ? 'банки, где флоп видели двое' : 'все банки с флопом' + (other && other[1] ? ' · один на один ' + pv(other[0], other[1]) : ''))];
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
  const toks = String(q || '').replace(/[.,!?«»"]+/g, ' ').split(/\s+/).filter(t => t && !STOP.has(t.toLowerCase()) && !/^(игрок\w*|ник\w*|покаж\w*|найд\w*|открой|дай|карточк\w*)$/i.test(t));
  const out = []; if (brainNick) out.push(brainNick); if (toks.length) out.push(toks.join(' ')); return [...new Set(out)];
}
const notFoundMsg = (q, brainNick) => {
  const rows = similarNicks(nickParts(q, brainNick), 6);
  return { nf: true, blocks: [{ type: 'text', text: rows.length ? 'Такого ника нет. Похожие в базе — нажмите нужный:' : 'Игрока не нашёл.' }],
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
function answerFor(P, ql, intent, rows0, spec) {
  const others = rows0.slice(1).map(r => ({ label: r.nick + ' · ' + (ROOM_RU[r.room] || r.room) + ' · ' + r.n.toLocaleString('ru') + ' рук', key: r.key }));
  const blocks = [];
  spec = spec || {}; const G = spec.groups || groupsRule(ql), PL = spec.pos || (posListRule(ql).length > 1 ? posListRule(ql) : null);
  const bands0 = G ? null : bandsOf(ql), bands = bands0 || BANDS, byBand = /по ст[еэ]к|ст[еэ]кам|ст[еэ]ков|разбив|сайз/.test(ql) && !(bands0 && bands0.num != null);
  const bnote = bands0 ? 'стек ' + (bands0.length > 1 ? bands0[0] + ' … ' + bands0[bands0.length - 1] : bands0[0]) + ' bb' : 'все стеки';
  let sb = null;
  if (intent === 'stat' && (sb = statBlocks(P, statOf(ql), ql))) blocks.push(...sb);
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
      blocks.push({ type: 'table', title: title(P) + ' — винрейт по позициям', note: 'позиции как в Hand2Note (UTG — только при полном столе); «реально» — как «бб/100» в Hand2Note; «с поправкой» — олл-ины по эквити (у Hand2Note своя формула EV, цифры могут отличаться)' + (P.ext.dup ? '; дубли раздач убраны: ' + P.ext.dup : ''), table: { head: ['позиция', 'руки', 'бб/100 реально', 'бб/100 с поправкой'], rows, signed: true } });
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
    const cell = (x, k) => ({ v: pctS(x[k], x.n), n: x.n });
    const RS = G || (byBand ? BANDS.map(b => [b + ' bb', [b]]) : null);
    const rows = RS ? RS.map(([l, bs]) => [l, ...cols.map(p => cell(S.get(p, bs), 'nai'))]).filter(r => r.slice(1).some(c => c.n))
      : [['RFI', ...cols.map(p => cell(S.get(p, bands), 'tot'))], ['NAI', ...cols.map(p => cell(S.get(p, bands), 'nai'))]];
    const posNote = S.h2n ? '' : ' · у игроков базы позиции пока крупнее (EP — все ранние, MP — HJ и место перед ним)';
    blocks.push({ type: 'table', title: title(P) + ' — RFI' + (PL ? ' · ' + cols.map(lab).join(', ') : ' по позициям') + (RS ? ' по стекам' : ''), note: (RS ? 'без олл-инов, как в Hand2Note; стек — свой, без анте' : 'RFI — с олл-инами, NAI — без') + posNote, table: { head: ['', ...cols.map(lab)], rows, grid: true } });
    if (!rows.length) blocks.push({ type: 'text', text: 'В этой ситуации у игрока нет раздач.' });
  }
  else if (intent === 'rfi') {
    // один стат — одна цифра; «по стекам» / «по позициям» / без позиции — таблица (владелец, 23.11.2026)
    const S = rfiSrc(P), pos = posOf(ql), total = /общ|в целом|всего|итог|tot/.test(ql);
    const stackTxt = bands0 ? (bands0.num != null ? 'стек ' + String(bands0.num).replace('.', ',') + ' bb (в диапазоне ' + bands0[0] + ' bb)' : bnote) : 'все стеки';
    const posNote = S.h2n ? '' : ' · у игроков базы позиции пока крупнее (EP — все ранние, MP — HJ и место перед ним); как в Hand2Note — после пересчёта';
    const p1 = pos || (total || !(byBand || WANT_TABLE.test(ql)) ? 'TOT' : null); // без позиции и без просьбы о таблице — одна цифра
    if (p1 && !byBand) {
      const x = S.get(p1, bands);
      blocks.push({ type: 'big', title: title(P) + ' — RFI ' + (p1 === 'TOT' ? 'общий' : 'с ' + p1), big: x.n ? pctS(x.tot, x.n) : 'нет данных', n: x.n, note: stackTxt + (x.n ? ' · без олл-инов ' + pctS(x.nai, x.n) : '') + posNote });
    } else if (p1) {
      const T = { head: ['стек', 'RFI', 'NAI'], rows: [], grid: true };
      for (const b of bands) { const x = S.get(p1, [b]); if (x.n) T.rows.push([b + ' bb', { v: pctS(x.tot, x.n), n: x.n }, { v: pctS(x.nai, x.n), n: x.n }]); }
      blocks.push({ type: 'table', title: title(P) + ' — RFI ' + (p1 === 'TOT' ? 'общий' : 'с ' + p1) + ' по стекам', note: 'NAI — без олл-инов' + posNote, table: T });
    } else blocks.push({ type: 'table', title: title(P) + ' — RFI по позициям', note: stackTxt + (byBand ? ' · по стекам, без олл-инов (как в Hand2Note); стек — свой, без анте' : ' · NAI — без олл-инов') + posNote, table: rfiGrid(P, bands, byBand && !(bands0 && bands0.length === 1)) });
  }  else {
    const t = famTable(P, intent, bands, byBand, G);
    blocks.push({ type: 'table', title: title(P) + ' — ' + FAM_T[intent], note: bnote + (intent === 'vso' ? ' · BTN, CO, HJ пока одной группой (разделим при следующем пересчёте)' : ''), table: t });
    if (!t.rows.length) blocks.push({ type: 'text', text: 'В этой ситуации у игрока нет раздач' + (bands0 ? ' при таком стеке' : '') + '.' });
  }
  return { key: P.key, player: title(P), group: P.cl != null ? CLU.GROUP[P.cl] : null, intent, blocks, sugg: others };
}

// ---------- сервер ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };
// ---------- голос: Whisper (whisper.cpp, модель держится в памяти) ----------
const BRAIN = require('./brain.cjs');
const WH = { dir: path.join(__dirname, 'whisper'), port: 8791, proc: null, ready: false };
WH.exe = path.join(WH.dir, 'bin', 'Release', 'whisper-server.exe'); WH.model = path.join(WH.dir, 'ggml-large-v3-turbo-q5_0.bin');
// подсказка Whisper: покерные слова пишем как надо (латиница), чтобы реже ошибался
const WH_PROMPT = 'Покерная статистика: VPIP, PFR, 3-бет, RFI, WTSD, W$SD, WWSF, фолд на 3-бет, баттон, катофф, хайджек, блайнды, бб, мой алиас, FFtonny.';
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
async function ask(q0, ctx, key, alts, voice) {
  if (key || !q0) return answer(q0, ctx, key);
  if (voice && ctx) {
    const src = String(q0).toLowerCase(), lock = { own: isOwn(src), src };
    const B = await BRAIN.understand(q0, (qKey.get(ctx) || {}).nick);
    let out = null, best = -1;
    // Claude понял вопрос — его ответ главный (свой разбор слов — только если Claude нет); таблицу строим по его описанию
    if (B && B.phrase) { out = answer(B.phrase, ctx, null, lock, specFromBrain(B.parsed)); out.brain = { model: BRAIN.status().model, phrase: B.phrase }; return out; }
    for (const q of [q0, ...alts]) { const o = answer(q, ctx, null, lock), sc = voiceScore(o); if (sc > best) { best = sc; out = o; } }
    return out;
  }
  // мозг (Claude): понимает вопрос любыми словами → точная фраза; цифры — из базы. Нет ключа — свой разбор слов.
  const prev = ctx ? (qKey.get(ctx) || {}).nick : null;
  const B = await BRAIN.understand(q0, prev);
  const cands = [];
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
  if (u.pathname === '/api/status') return J({ whisper: WH.ready, brain: BRAIN.status() });
  if (u.pathname === '/api/ask') {
    const t0 = Date.now(); let out;
    const q0 = u.searchParams.get('q'), ctx = u.searchParams.get('ctx'), key = u.searchParams.get('key');
    let alts = []; try { alts = JSON.parse(u.searchParams.get('alts') || '[]').filter(x => typeof x === 'string').slice(0, 12); } catch (e) { alts = []; }
    try { out = await ask(q0, ctx, key, alts, !!u.searchParams.get('voice')); } catch (e) { out = { blocks: [{ type: 'text', text: 'Ошибка: ' + e.message }] }; }
    try { fs.appendFileSync(path.join(__dirname, 'data', 'asks.log'), JSON.stringify({ t: new Date().toISOString(), voice: !!u.searchParams.get('voice'), q: q0, alts, brain: out.brain || null, heard: out.heard, intent: out.intent, player: out.player || null }) + '\n'); } catch (e) {}
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
