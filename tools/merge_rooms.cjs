'use strict';
// Слияние итогов основной базы (pipeline/out) и новых румов (pipeline/out_new): кластеры игроков, топы, ход турниров.
// Ключи игроков и турниров начинаются с рума («wpn:ник», «ipoker:123»), поэтому пересечений нет — просто объединение.
// Выход: pipeline/out/players_cl_all.json, tops_all.json, tourn_all.json (их берёт passV8 через PLAYERS_CL / TOPS / TOURN).
const fs = require('fs'), path = require('path');
const A = process.env.MAIN_OUT || path.join(__dirname, '..', 'pipeline', 'out'), B = process.env.NEW_OUT || path.join(__dirname, '..', 'pipeline', 'out_new');
const rd = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
const cl = Object.assign({}, rd(A, 'players_cl_v8.json'), rd(B, 'players_cl_v8.json'));
fs.writeFileSync(path.join(A, 'players_cl_all.json'), JSON.stringify(cl));
const ta = rd(A, 'tops_v8.json'), tb = rd(B, 'tops_v8.json');
const tops = { A: Object.assign({}, ta.A, tb.A), B: Object.assign({}, ta.B, tb.B), byFmt: {} };
for (const f of ['n', 'k', 'm']) { const x = (ta.byFmt || {})[f] || { A: {}, B: {} }, y = (tb.byFmt || {})[f] || { A: {}, B: {} }; tops.byFmt[f] = { A: Object.assign({}, x.A, y.A), B: Object.assign({}, x.B, y.B) }; }
// топы по четвертям (pipeline/tops_q.cjs, правило 8 / 5 bb/100) не затирать старым отбором
const TA = path.join(A, 'tops_all.json'); let keepQ = false; try { keepQ = fs.existsSync(TA) && /^\{"rule"/.test(fs.readFileSync(TA, 'utf8').slice(0, 10)); } catch (e) {}
if (!keepQ) fs.writeFileSync(TA, JSON.stringify(tops)); else console.log('tops_all.json — отбор по четвертям (8 / 5), оставляю');
const tr = Object.assign({}, rd(A, 'tourn_v8.json'), rd(B, 'tourn_v8.json'));
fs.writeFileSync(path.join(A, 'tourn_all.json'), JSON.stringify(tr));
const cnt = (o) => Object.keys(o).length, byRoom = (o) => { const r = {}; for (const k in o) { const m = k.split(':')[0]; r[m] = (r[m] || 0) + 1; } return r; };
const rep = { игроков_с_кластером: byRoom(cl), топов_A: byRoom(tops.A), топов_B: byRoom(tops.B), по_формату: Object.fromEntries(['n', 'k', 'm'].map(f => [f, { A: cnt(tops.byFmt[f].A), B: cnt(tops.byFmt[f].B) }])), турниров: byRoom(tr) };
fs.writeFileSync(path.join(A, 'новые_румы_итог.json'), JSON.stringify(rep, null, 1));
console.log(JSON.stringify(rep, null, 1));
