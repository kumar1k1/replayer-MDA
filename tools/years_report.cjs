'use strict';
// ОТЧЁТ 2025 vs 2026: как играли топы (T — от 8 bb/100, U — от 5) и реги (greg) в одних и тех же спотах в разные годы.
// По ячейкам модели «Y|год|когорта|спот(обобщённый)|действие|*» и «Y|год@рум|…» (pipeline/passV8.cjs, с 23.11.2026).
// Состав румов по годам разный (CoinPoker и iPoker — почти только 2026, 888 — 2025), поэтому главный ответ — сравнение
// ВНУТРИ рума; общее (все румы вместе) — только для справки. Для каждого спота: частоты действий (п.п., z), EV (bb, z).
// Сравнений — десятки тысяч: сколько «изменений» дал бы чистый случай при |z| ≥ 3 (0,27% проверок) — пишется рядом.
// Выход: <OUT>/годы_отчёт.json и годы_отчёт.md.   OUT_DIR=… node tools/years_report.cjs
const fs = require('fs'), path = require('path'), C = require('../pipeline/common.cjs');
const OUT = C.OUT, MIN_N = +(process.env.MIN_N || 500), Y0 = process.env.Y0 || '2025', Y1 = process.env.Y1 || '2026';
const S = new Map(); // область|когорта|спот → {год: {n, a: {act: [n, m, sd]}}}; область — «все» или рум
C.loadModel(C.MODEL_FILE(), (sec, k, v) => {
  if (sec !== 'EV' || k.charCodeAt(0) !== 89 || k[1] !== '|') return false;
  const p = k.split('|'); // Y | год[@рум] | когорта | спот… | действие | *
  const [year, room] = p[1].split('@'), scope = room || 'все', coh = p[2], act = p[p.length - 2], spot = p.slice(3, p.length - 2).join('|');
  if (year !== Y0 && year !== Y1) return false;
  const key = scope + '|' + coh + '|' + spot; let o = S.get(key); if (!o) { o = {}; S.set(key, o); }
  const y = o[year] = o[year] || { n: 0, a: {} };
  y.a[act] = [v[0], v.length > 1 ? v[1] : null, v[2] || 0];
  if (!act.includes('@')) y.n += v[0];
  return false;
});
const sc = {}; // область → {спотов, проверок частот, проверок EV, freq: [], ev: [], решений: {когорта: {год: n}}}
for (const [key, o] of S) {
  const [scope, coh] = key.split('|'), spot = key.slice(scope.length + coh.length + 2);
  const R = sc[scope] = sc[scope] || { spots: 0, nf: 0, ne: 0, freq: [], ev: [], tot: {} };
  for (const y of [Y0, Y1]) if (o[y]) { const t = R.tot[coh] = R.tot[coh] || {}; t[y] = (t[y] || 0) + o[y].n; }
  const a = o[Y0], b = o[Y1]; if (!a || !b || a.n < MIN_N || b.n < MIN_N) continue;
  R.spots++;
  const acts = new Set([...Object.keys(a.a), ...Object.keys(b.a)].filter(x => !x.includes('@')));
  for (const act of acts) {
    const na = (a.a[act] || [0])[0], nb = (b.a[act] || [0])[0];
    const pa = na / a.n, pb = nb / b.n, pp = (na + nb) / (a.n + b.n), se = Math.sqrt(pp * (1 - pp) * (1 / a.n + 1 / b.n)) || 1e-9;
    const z = (pb - pa) / se; R.nf++;
    if (Math.abs(pb - pa) >= 0.05 && Math.abs(z) >= 3) R.freq.push({ когорта: coh, спот: spot, действие: act, [Y0]: +(pa * 100).toFixed(1), [Y1]: +(pb * 100).toFixed(1), разница_пп: +((pb - pa) * 100).toFixed(1), z: +z.toFixed(1), n: [a.n, b.n] });
    const ea = a.a[act], eb = b.a[act];
    if (ea && eb && ea[1] != null && eb[1] != null && ea[0] >= 200 && eb[0] >= 200) {
      R.ne++;
      const s2 = Math.sqrt(ea[2] ** 2 / ea[0] + eb[2] ** 2 / eb[0]) || 1e-9, ze = (eb[1] - ea[1]) / s2;
      if (Math.abs(ze) >= 3 && Math.abs(eb[1] - ea[1]) >= 0.3) R.ev.push({ когорта: coh, спот: spot, действие: act, ['EV_' + Y0]: ea[1], ['EV_' + Y1]: eb[1], разница_bb: +(eb[1] - ea[1]).toFixed(2), z: +ze.toFixed(1), n: [ea[0], eb[0]] });
    }
  }
}
const order = Object.keys(sc).sort((x, y) => (x === 'все' ? 1 : y === 'все' ? -1 : sc[y].spots - sc[x].spots));
const rep = { сравнивали: [Y0, Y1], порог_выборки: MIN_N, области: {} };
const md = ['# Игра ' + Y0 + ' vs ' + Y1 + ' — внутри каждого рума', '',
  'Случайных «изменений» при |z| ≥ 3 ожидается ~0,27% проверок (частоты — ещё и с разницей ≥ 5 п.п., EV — ≥ 0,3 bb, поэтому меньше).', ''];
for (const s of order) {
  const R = sc[s]; R.freq.sort((x, y) => Math.abs(y.z) - Math.abs(x.z)); R.ev.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
  rep.области[s] = { решений: R.tot, спотов: R.spots, проверок_частот: R.nf, проверок_EV: R.ne, частоты_изменились: R.freq.length, EV_изменился: R.ev.length, частоты: R.freq.slice(0, 200), EV: R.ev.slice(0, 200) };
  md.push('## ' + (s === 'все' ? 'Все румы вместе (справка: смешан состав румов)' : 'Рум ' + s), '',
    'Решений: ' + JSON.stringify(R.tot), `Спотов с выборкой ≥ ${MIN_N} в оба года: ${R.spots}`,
    `Частоты изменились (≥ 5 п.п., |z| ≥ 3): ${R.freq.length} из ${R.nf} проверок (случай дал бы до ~${Math.round(R.nf * 0.0027)})`,
    `EV изменился (≥ 0,3 bb, |z| ≥ 3): ${R.ev.length} из ${R.ne} проверок (случай дал бы до ~${Math.round(R.ne * 0.0027)})`, '',
    '### Частоты — самые заметные', ...R.freq.slice(0, 20).map(r => `- ${r.когорта} ${r.спот} «${r.действие}»: ${r[Y0]}% → ${r[Y1]}% (${r.разница_пп > 0 ? '+' : ''}${r.разница_пп} п.п., z=${r.z})`),
    '', '### EV — самые заметные', ...R.ev.slice(0, 15).map(r => `- ${r.когорта} ${r.спот} «${r.действие}»: ${r['EV_' + Y0]} → ${r['EV_' + Y1]} bb (z=${r.z})`), '');
}
fs.writeFileSync(path.join(OUT, 'годы_отчёт.json'), JSON.stringify(rep, null, 1));
fs.writeFileSync(path.join(OUT, 'годы_отчёт.md'), md.join('\n'));
for (const s of order) console.log(s.padEnd(8), 'спотов', sc[s].spots, '| частоты', sc[s].freq.length, '/', sc[s].nf, '| EV', sc[s].ev.length, '/', sc[s].ne);
