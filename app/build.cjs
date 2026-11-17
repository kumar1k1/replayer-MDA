'use strict';
// ============================================================================
// П.9 СБОРКА РЕПЛЕЕРА: одна папка app/dist, открывается двойным щелчком по index.html (без сервера).
//  • стол, кнопки и стили — файлы реплеера MDA Lab как есть (только читаем MDA Lab): replay.js, replayer.js, styles.css.
//    В копию replayer.js добавлена одна строка-крючок (RV_HOOK) — через неё панель «Сейчас ход» узнаёт шаг раздачи.
//    При переносе в MDA Lab эта строка — единственная правка в его реплеере.
//  • разбор истории — парсер Backing (тот же, что в конвейере), извлекается из его replayer.html.
//  • подсказки — engine/engine_v8.js + lib/*.js; данные (модель, сайзинги, лайнап, игроки) — как data/*.js.
// Запуск: MDA_LAB_DIR=… BACKING_DIR=… MODEL=… PLAYERS=… PLAYERS_CL=… node app/build.cjs
// ============================================================================
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const MDA0 = [process.env.MDA_LAB_DIR || '', path.join(ROOT, '..', 'kumar1k1', 'mda-lab'), path.join(ROOT, '..', 'mda-lab')].find(d => fs.existsSync(path.join(d, 'app', 'renderer', 'replayer.js')));
// нет исходников MDA Lab рядом — берём копию из app/vendor/mda-lab (коммит указан в ОТКУДА.md)
const MDA = MDA0 || path.join(__dirname, 'vendor', 'mda-lab-root');
const BK = process.env.BACKING_DIR || ['D:/маининг/реплеер', path.join(ROOT, '..', 'backing')].find(d => fs.existsSync(path.join(d, 'replayer.html')));
if (!BK) throw new Error('Не найден Backing (BACKING_DIR)');
const OUT = path.join(__dirname, 'dist'); fs.mkdirSync(path.join(OUT, 'js'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
const R = (p) => fs.readFileSync(p, 'utf8');
const W = (p, s) => fs.writeFileSync(path.join(OUT, p), s);
const OUTD = process.env.OUT_DIR || path.join(ROOT, 'pipeline', 'out');

// 1. реплеер MDA Lab
const rv = MDA0 ? path.join(MDA, 'app', 'renderer') : path.join(__dirname, 'vendor', 'mda-lab');
let rjs = R(path.join(rv, 'replayer.js'));
const HOOK_AT = '      if (k >= fr.length - 1) stop();\n    }\n    function stop()';
if (!rjs.includes(HOOK_AT)) throw new Error('replayer.js MDA Lab изменился: не найдено место для крючка RV_HOOK');
rjs = rjs.replace(HOOK_AT, '      if (window.RV_HOOK) window.RV_HOOK(k, fr, rp); // replayer-MDA: панель «Сейчас ход» (единственная правка)\n' + HOOK_AT);
W('js/replay.js', R(path.join(rv, 'replay.js')));
W('js/replayer.js', rjs);
W('styles.css', R(path.join(rv, 'styles.css')));
fs.copyFileSync(path.join(rv, 'icon.png'), path.join(OUT, 'icon.png'));
let mdaCommit = MDA0 ? '' : '4f88636 (копия)'; if (MDA0) try { mdaCommit = require('child_process').execSync('git -C "' + MDA + '" log -1 --format=%h').toString().trim(); } catch (e) { /* не git */ }

// 2. парсер Backing — тот же фрагмент replayer.html, что в pipeline/parser.cjs; нормализация — как в pipeline/common.cjs
const html = R(path.join(BK, 'replayer.html'));
const s1 = html.indexOf('var POS_NAMES'), s2 = html.indexOf('// ================= SVG-СТИЛИ');
if (s1 < 0 || s2 < 0) throw new Error('replayer.html Backing изменился: не найден парсер');
const posClassSrc = "function posClass(p){return /^(UTG|EP)/.test(p)?'p-ep':/^(MP|LJ)/.test(p)?'p-mp':p==='HJ'?'p-hj':p==='CO'?'p-co':p==='BTN'||p==='BTN/SB'?'p-bt':p==='SB'?'p-sb':p==='BB'?'p-bb':'';}";
const common = R(path.join(ROOT, 'pipeline', 'common.cjs'));
const nh = common.slice(common.indexOf('function normalizeHand'), common.indexOf('\n}\n', common.indexOf('function normalizeHand')) + 3);
W('js/parser.js', "'use strict';\n// Парсер Backing (из replayer.html) + нормализация текста (pipeline/common.cjs)\nwindow.BKP = (function () {\n" +
  'const P = (function (window, document) {\n' + html.slice(s1, s2) + posClassSrc + '\nreturn { parseHand: parseHand };\n})({}, {});\n' + nh +
  'return { parse: (t) => P.parseHand(normalizeHand(t) + "\\n") };\n})();\n');

// 3. библиотеки и движок
for (const f of ['lib/cards.js', 'lib/spots.js', 'lib/sizing.js', 'lib/lineup.js', 'lib/stage.js', 'lib/clusters.js', 'engine/engine_v8.js']) W('js/' + path.basename(f), R(path.join(ROOT, f)));
for (const f of ['shim.js', 'advisor.js', 'app.js']) W('js/' + f, R(path.join(__dirname, 'src', f)));

// 4. данные (как скрипты: index.html открывается без сервера, fetch локальных файлов браузер запрещает)
const asJs = (name, file, varName) => { const s = R(file); W('data/' + name, 'window.' + varName + '=' + s + ';\n'); return s.length; };
const sz = {};
// модель: на полной базе — больше гигабайта; для браузера отсекаются редкие ячейки (вскрытия HC с n < HC_MIN, EV с n < EV_MIN).
// Пороги подбираются сами, чтобы model.js был не больше APP_MODEL_MB (по умолчанию 200 МБ); HC_MIN / EV_MIN можно задать явно.
{
  const C8 = require(path.join(ROOT, 'pipeline', 'common.cjs'));
  const mf = process.env.MODEL || (fs.existsSync(path.join(OUTD, 'model_v8.ndjson')) ? path.join(OUTD, 'model_v8.ndjson') : path.join(OUTD, 'model_v8.json'));
  const LIM = (+(process.env.APP_MODEL_MB || 200)) * 1048576;
  const HCG = [5, 10, 15, 20, 30, 50, 80, 120, 200, 400], EVG = [1, 2, 3, 5, 10, 20, 50];
  let hcMin = +(process.env.HC_MIN || 0), evMin = +(process.env.EV_MIN || 0);
  if (!hcMin || !evMin) { // 1-й проход: сколько байт дают ячейки с n не меньше порога
    const hcB = new Array(HCG.length).fill(0), evB = new Array(EVG.length).fill(0); let other = 0;
    C8.loadModel(mf, (sec, k, v) => {
      const b = k.length + JSON.stringify(v).length + 4;
      if (sec === 'HC') { for (let i = 0; i < HCG.length; i++) if (v[0] >= HCG[i]) hcB[i] += b; }
      else if (sec === 'EV') { for (let i = 0; i < EVG.length; i++) if (v[0] >= EVG[i]) evB[i] += b; }
      else other += b;
      return false;
    });
    let pick = null;
    outer: for (let j = 0; j < EVG.length; j++) for (let i = 0; i < HCG.length; i++) { if (hcB[i] + evB[j] + other <= LIM) { pick = [i, j]; break outer; } }
    if (!pick) pick = [HCG.length - 1, EVG.length - 1];
    if (!hcMin) hcMin = HCG[pick[0]]; if (!evMin) evMin = EVG[pick[1]];
    console.log('модель для реплеера: пороги HC ≥', hcMin, 'EV ≥', evMin, '| ожидаемый размер', ((hcB[HCG.indexOf(hcMin)] || 0) / 1048576 + (evB[EVG.indexOf(evMin)] || 0) / 1048576 + other / 1048576).toFixed(0), 'МБ');
  }
  let cut = 0;
  // диапазоны по вскрытиям для матрицы в панели: «обобщённый спот | действие(@размер)» → сколько раз каждую из 169 рук показали
  const RG = { T: {}, F: {} }; const reH = /^([TF])\|(~.*)\|([^|]+)\|h(\d+)$/;
  const M = C8.loadModel(mf, (sec, k, v) => {
    if (sec === 'HC') { const m = reH.exec(k); if (m) { const o = RG[m[1]], key = m[2] + '|' + m[3]; (o[key] || (o[key] = {}))[m[4]] = v[0]; } }
    if ((sec === 'HC' && v[0] < hcMin) || (sec === 'EV' && v[0] < evMin)) { cut++; return false; } return true;
  });
  { const pack = (o) => { const r = {}; for (const k in o) { const e = Object.entries(o[k]); if (e.reduce((s, x) => s + x[1], 0) >= 20) r[k] = e.map(([h, n]) => h + ':' + n).join(','); } return r; };
    const rs = JSON.stringify({ T: pack(RG.T), F: pack(RG.F) }); W('data/ranges.js', 'window.RM_RANGES=' + rs + ';\n'); sz.ranges = rs.length; }
  M.meta = Object.assign({}, M.meta, { appHcMin: hcMin, appEvMin: evMin });
  // запись по частям: целиком одной строкой не помещается
  const fd = fs.openSync(path.join(OUT, 'data', 'model.js'), 'w'); let total = 0, buf = '';
  const put = (x) => { buf += x; if (buf.length > 8e6) { fs.writeSync(fd, buf); total += buf.length; buf = ''; } };
  put('window.RM_MODEL={"v":' + JSON.stringify(M.v) + ',"meta":' + JSON.stringify(M.meta));
  for (const sec of ['EV', 'HC', 'RS', 'RC']) { put(',"' + sec + '":{'); let first = true; for (const k in M[sec]) { put((first ? '' : ',') + JSON.stringify(k) + ':' + JSON.stringify(M[sec][k])); first = false; } put('}'); }
  put('};\n'); fs.writeSync(fd, buf); total += buf.length; fs.closeSync(fd);
  sz.model = total; sz.modelCut = cut;
}
sz.eq = asJs('eq169.js', path.join(ROOT, 'data', 'eq169.json'), 'RM_EQ');
sz.sizes = asJs('sizes.js', path.join(ROOT, 'data', 'sizes_v8.json'), 'RM_SIZES');
sz.lineup = asJs('lineup.js', path.join(ROOT, 'data', 'lineup_v8.json'), 'RM_LINEUP');
sz.clusters = asJs('clusters.js', path.join(ROOT, 'data', 'clusters_v2.json'), 'RM_CLMODEL');
if (fs.existsSync(path.join(ROOT, 'data', 'gto_profile.json'))) sz.gto = asJs('gto_profile.js', path.join(ROOT, 'data', 'gto_profile.json'), 'RM_GTO'); else W('data/gto_profile.js', '');
if (fs.existsSync(path.join(ROOT, 'data', 'stage_calib.json'))) asJs('stage_calib.js', path.join(ROOT, 'data', 'stage_calib.json'), 'RM_STAGE_CALIB'); else W('data/stage_calib.js', '');
// игроки: «рум:ник» → [кластер, расстояние, второй кластер, рук, надёжен, префлоп-счётчики (разреженно «слот:число»)]
const APP_MIN = +(process.env.APP_MIN_HANDS || 100); // в реплеер — игроки с ≥ 100 рук: у остальных кластер почти пуловый
const pl = {}, CL = JSON.parse(R(process.env.PLAYERS_CL || path.join(OUTD, 'players_cl_v8.json')));
for (const ln of R(process.env.PLAYERS || path.join(OUTD, 'players_v8.ndjson')).split('\n')) {
  if (!ln) continue; const p = JSON.parse(ln), c = CL[p.k]; if (!c || p.n < APP_MIN) continue;
  const sp = []; p.pf.forEach((v, o) => { if (v) sp.push(o + ':' + v); });
  pl[p.k] = [c[0], c[1], c[2], c[4], c[5], sp.join(',')];
}
W('data/players.js', 'window.RM_PLAYERS=' + JSON.stringify(pl) + ';\n'); sz.players = Object.keys(pl).length;

// пример раздач (необязательно): DEMO=<файл .txt> — откроется сразу при запуске
W('js/demo.js', process.env.DEMO ? 'window.RM_DEMO=' + JSON.stringify(R(process.env.DEMO)) + ';\n' : '');

// 5. страница
let page = R(path.join(__dirname, 'src', 'index.html'));
page = page.replace('{{BUILD}}', new Date().toISOString().slice(0, 16).replace('T', ' ') + (mdaCommit ? ' · реплеер MDA Lab ' + mdaCommit : ''));
W('index.html', page);
console.log('app/dist готов:', JSON.stringify({ mdaLab: MDA, mdaCommit, modelMB: +(sz.model / 1048576).toFixed(1), players: sz.players }));
