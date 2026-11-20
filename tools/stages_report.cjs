'use strict';
// ОТЧЁТ ПО СТАДИЯМ: из out/stages.json (pipeline/stages.cjs) — сколько рук на каждой стадии и насколько отличается игра
// на соседних стадиях (в одной и той же полосе стека, по группам игроков). Подсказка, какие стадии склеить.
//   OUT_DIR=… node tools/stages_report.cjs  →  стадии_отчёт.md, стадии_отчёт.json
const fs = require('fs'), path = require('path');
const OUT = process.env.OUT_DIR || path.join(__dirname, '..', 'pipeline', 'out');
const S = JSON.parse(fs.readFileSync(path.join(OUT, 'stages.json'), 'utf8'));
const ST = ['s1', 's2', 's3', 'bub', 'itm', 'ft'];
const ST_RU = { s1: 'вышло < 25%', s2: '25–50%', s3: '50% — до пузыря', bub: 'пузырь', itm: 'ITM до финалки', ft: 'финальный стол' };
const MET_RU = { 'open:EP': 'опен первым, ранние', 'open:MP': 'опен первым, HJ', 'open:CO': 'опен первым, CO', 'open:BTN': 'опен первым, BTN', 'open:SB': 'опен первым, SB',
  'limp:EP': 'лимп первым, ранние', 'limp:MP': 'лимп первым, HJ', 'limp:CO': 'лимп первым, CO', 'limp:BTN': 'лимп первым, BTN', 'limp:SB': 'лимп первым, SB',
  shove1: 'пуш первым', vsoFold: 'фолд против опена', vso3b: '3-бет/пуш против опена', stealFold: 'фолд блайнда на стил', vs3Fold: 'фолд на 3-бет',
  aiCall1: 'колл пуша первым', aiCall2: 'колл ре-пуша', openTo: 'размер опена, bb' };
const GR = ['reg', 'nit', 'fish', 'unk'], GR_RU = { reg: 'реги', nit: 'ниты', fish: 'фиши', unk: 'без кластера' };
const BANDS = ['<12', '12-20', '20-30', '30-50', '50+'];
const MIN_N = +(process.env.MIN_N || 1000);
const get = (st, m, g, b) => S.M[st + '|' + m + '|' + g + '|' + b] || null;
const metrics = [...new Set(Object.keys(S.M).map(k => k.split('|')[1]))].sort();
// значение и его погрешность
const val = (a) => { const n = a[0], mu = a[1] / n, v = Math.max(1e-9, a[2] / n - mu * mu); return { n, mu, se: Math.sqrt(v / n) }; };
const isMean = (m) => m === 'openTo';
const fmt = (m, x) => isMean(m) ? x.mu.toFixed(2) : (x.mu * 100).toFixed(1) + '%';

const lines = [], J = { hands: S.H, pairs: [], exactVsEst: [] };
const tot = Object.values(S.H).reduce((s, x) => s + x, 0);
lines.push('# Стадии турнира: насколько по-разному играют', '', 'Собрано ' + S.built + '. Раздач с известной стадией: ' + (S.hands || 0).toLocaleString('ru') + '.', '');
lines.push('## Сколько рук на каждой стадии', '', '| Стадия | точно (по местам вылета) | по оценке (средний стек) | доля |', '|---|---|---|---|');
for (const s of ST) { const a = S.H[s] || 0, e = S.H['e:' + s] || 0; lines.push('| ' + ST_RU[s] + ' | ' + a.toLocaleString('ru') + ' | ' + e.toLocaleString('ru') + ' | ' + ((a + e) / Math.max(1, tot - (S.H.none || 0)) * 100).toFixed(1) + '% |'); }
lines.push('', 'Без стадии (турнира нет в ходе турниров или стадию не определить): ' + (S.H.none || 0).toLocaleString('ru') + '.', '');

// данные стадии: точные + оценка (оценку подмешиваем, только если отчёт ниже покажет, что она не искажает) — здесь точные
const pick = (s, m, g, b, withEst) => { const a = get(s, m, g, b), e = withEst ? get('e:' + s, m, g, b) : null; if (!a && !e) return null; const r = [0, 0, 0]; for (const x of [a, e]) if (x) for (let i = 0; i < 3; i++) r[i] += x[i]; return r; };
const WITH_EST = process.env.WITH_EST === '1';

lines.push('## Соседние стадии: где игра отличается', '', 'Сравниваются одинаковые ячейки (метрика × группа × полоса стека), где на обеих стадиях не меньше ' + MIN_N + ' решений.',
  '«Заметно» — разница не меньше 2 п.п. (у размера опена — 0,05 bb) и не меньше трёх погрешностей.', '',
  '| Пара стадий | ячеек | заметно отличаются | средняя разница | самые большие отличия |', '|---|---|---|---|---|');
for (let i = 0; i + 1 < ST.length; i++) {
  const s1 = ST[i], s2 = ST[i + 1]; let n = 0, sig = 0, sumD = 0; const top = [];
  for (const m of metrics) for (const g of GR) for (const b of BANDS) {
    const A = pick(s1, m, g, b, WITH_EST), B = pick(s2, m, g, b, WITH_EST); if (!A || !B || A[0] < MIN_N || B[0] < MIN_N) continue;
    const a = val(A), c = val(B), d = c.mu - a.mu, z = Math.abs(d) / Math.sqrt(a.se ** 2 + c.se ** 2), thr = isMean(m) ? 0.05 : 0.02;
    n++; sumD += Math.abs(isMean(m) ? d / 10 : d); // размер опена в «процентах» не меряется — для средней берём d/10 (условно)
    if (Math.abs(d) >= thr && z >= 3) { sig++; top.push({ m, g, b, d, a: fmt(m, a), c: fmt(m, c), n1: A[0], n2: B[0] }); }
  }
  top.sort((x, y) => Math.abs(y.d) * (isMean(y.m) ? 10 : 100) - Math.abs(x.d) * (isMean(x.m) ? 10 : 100));
  const desc = top.slice(0, 3).map(t => (MET_RU[t.m] || t.m) + ', ' + GR_RU[t.g] + ', ' + t.b + ' bb: ' + t.a + ' → ' + t.c).join('; ');
  lines.push('| ' + ST_RU[s1] + ' → ' + ST_RU[s2] + ' | ' + n + ' | ' + sig + (n ? ' (' + Math.round(sig / n * 100) + '%)' : '') + ' | ' + (n ? (sumD / n * 100).toFixed(1) + ' п.п.' : '—') + ' | ' + (desc || '—') + ' |');
  J.pairs.push({ from: s1, to: s2, cells: n, significant: sig, meanAbsPP: n ? +(sumD / n * 100).toFixed(2) : null, top: top.slice(0, 20) });
}
lines.push('', 'Подсказка: пару, где заметных отличий меньше ~15% ячеек и средняя разница меньше ~1,5 п.п., можно склеить в одну стадию.', '');

lines.push('## Оценка стадии по среднему стеку — не искажает ли', '', 'Те же ячейки: стадия по местам вылета против стадии по оценке.', '', '| Стадия | ячеек | заметно отличаются | средняя разница |', '|---|---|---|---|');
for (const s of ST) {
  let n = 0, sig = 0, sumD = 0;
  for (const m of metrics) { if (isMean(m)) continue; for (const g of GR) for (const b of BANDS) {
    const A = get(s, m, g, b), B = get('e:' + s, m, g, b); if (!A || !B || A[0] < MIN_N || B[0] < MIN_N) continue;
    const a = val(A), c = val(B), d = c.mu - a.mu, z = Math.abs(d) / Math.sqrt(a.se ** 2 + c.se ** 2); n++; sumD += Math.abs(d); if (Math.abs(d) >= 0.02 && z >= 3) sig++;
  } }
  lines.push('| ' + ST_RU[s] + ' | ' + n + ' | ' + sig + (n ? ' (' + Math.round(sig / n * 100) + '%)' : '') + ' | ' + (n ? (sumD / n * 100).toFixed(1) + ' п.п.' : '—') + ' |');
  J.exactVsEst.push({ stage: s, cells: n, significant: sig });
}
lines.push('');

// ---- хватает ли данных для подсказок: последние столы (владелец, 20.11.2026) ----
const LT = ['T4-6', 'T3', 'T2', 'T1'], LT_RU = { 'T4-6': '4–6 столов', T3: '3 стола', T2: '2 стола', T1: 'финальный стол' };
const MINS = +(process.env.MIN_SPOT || 300);
lines.push('## Хватит ли данных для подсказок: последние столы', '', 'Только турниры с местами вылета. «Ячеек с данными» — сколько пар «метрика × полоса стека», где у регов не меньше ' + MINS + ' решений (это грубая метка: в реальном споте ещё делится по позициям, размерам и классу соперника — нужно больше).', '',
  '| Сколько осталось | раздач | решений регов | ячеек с данными (из ' + metrics.length * BANDS.length + ') |', '|---|---|---|---|');
const covRow = (lb, ru) => { let dec = 0, cells = 0; for (const m of metrics) for (const b of BANDS) { const A = get(lb, m, 'reg', b); const n = A ? A[0] : 0; dec += n; if (n >= MINS) cells++; } lines.push('| ' + ru + ' | ' + (S.H[lb] || 0).toLocaleString('ru') + ' | ' + dec.toLocaleString('ru') + ' | ' + cells + ' |'); J.coverage = J.coverage || []; J.coverage.push({ stage: lb, hands: S.H[lb] || 0, regDecisions: dec, cells }); };
for (const s of ST) covRow(s, ST_RU[s]);
for (const t of LT) covRow(t, LT_RU[t]);
lines.push('', '### Последние столы против пузыря: насколько отличается игра', '', '| Метрика | группа | стек | ' + ['bub'].concat(LT).map(x => x === 'bub' ? 'пузырь' : LT_RU[x]).join(' | ') + ' |', '|---|---|---|' + ['bub'].concat(LT).map(() => '---').join('|') + '|');
for (const m of ['open:BTN', 'open:CO', 'shove1', 'stealFold', 'vso3b', 'aiCall1']) for (const g of ['reg', 'fish']) for (const b of ['<12', '12-20', '20-30']) {
  const cells = ['bub'].concat(LT).map(s => { const A = get(s, m, g, b); if (!A || A[0] < 50) return A ? '(' + A[0] + ')' : '—'; return fmt(m, val(A)) + ' (' + A[0] + ')'; });
  lines.push('| ' + (MET_RU[m] || m) + ' | ' + GR_RU[g] + ' | ' + b + ' | ' + cells.join(' | ') + ' |');
}
lines.push('');

lines.push('## Подробно: реги и фиши, стеки 12–50 bb', '');
for (const g of ['reg', 'fish']) for (const b of ['12-20', '20-30', '30-50']) {
  lines.push('### ' + GR_RU[g] + ', ' + b + ' bb', '', '| Метрика | ' + ST.map(s => ST_RU[s]).join(' | ') + ' |', '|---|' + ST.map(() => '---').join('|') + '|');
  for (const m of metrics) {
    const cells = ST.map(s => { const A = pick(s, m, g, b, WITH_EST); if (!A || A[0] < 100) return A ? '(' + A[0] + ')' : '—'; return fmt(m, val(A)) + ' (' + (A[0] >= 10000 ? Math.round(A[0] / 1000) + 'k' : A[0]) + ')'; });
    lines.push('| ' + (MET_RU[m] || m) + ' | ' + cells.join(' | ') + ' |');
  }
  lines.push('');
}
fs.writeFileSync(path.join(OUT, 'стадии_отчёт.md'), lines.join('\n'));
fs.writeFileSync(path.join(OUT, 'стадии_отчёт.json'), JSON.stringify(J, null, 1));
console.log('отчёт: ' + path.join(OUT, 'стадии_отчёт.md'));
