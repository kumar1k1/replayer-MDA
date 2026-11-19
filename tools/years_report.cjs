'use strict';
// ОТЧЁТ 2025 vs 2026: как играли топы (T — от 8 bb/100, U — от 5) и реги (greg) в одних и тех же спотах в разные годы.
// По ячейкам модели «Y|год|когорта|спот(обобщённый)|действие|*» (pipeline/passV8.cjs). Для каждого спота:
//   частоты действий по годам (разница в п.п., z), EV действий (разница в bb, z), распределение размеров рейза.
// Выход: <OUT>/годы_отчёт.json и годы_отчёт.md — где игра заметно изменилась (там вес 2025 года снижаем).
//   OUT_DIR=… node tools/years_report.cjs
const fs = require('fs'), path = require('path'), C = require('../pipeline/common.cjs');
const OUT = C.OUT, MIN_N = +(process.env.MIN_N || 500);
const S = new Map(); // когорта|спот → {год: {всего, действия: {act: [n, m, sd]}}}
C.loadModel(C.MODEL_FILE(), (sec, k, v) => {
  if (sec !== 'EV' || k.charCodeAt(0) !== 89 || k[1] !== '|') return false;
  const p = k.split('|'); // Y | год | когорта | спот… | действие | *
  const year = p[1], coh = p[2], act = p[p.length - 2], spot = p.slice(3, p.length - 2).join('|');
  const key = coh + '|' + spot; let o = S.get(key); if (!o) { o = {}; S.set(key, o); }
  const y = o[year] = o[year] || { n: 0, a: {} };
  y.a[act] = [v[0], v.length > 1 ? v[1] : null, v[2] || 0];
  if (!act.includes('@')) y.n += v[0];
  return false;
});
const years = [...new Set([...S.values()].flatMap(o => Object.keys(o)))].sort();
const [Y0, Y1] = years.slice(-2);
const freqRows = [], evRows = [], tot = {};
for (const [key, o] of S) {
  const coh = key.split('|')[0];
  for (const y of years) if (o[y]) { const t = tot[coh] = tot[coh] || {}; t[y] = (t[y] || 0) + o[y].n; }
  const a = o[Y0], b = o[Y1]; if (!a || !b || a.n < MIN_N || b.n < MIN_N) continue;
  const acts = new Set([...Object.keys(a.a), ...Object.keys(b.a)].filter(x => !x.includes('@')));
  for (const act of acts) {
    const na = (a.a[act] || [0])[0], nb = (b.a[act] || [0])[0];
    const pa = na / a.n, pb = nb / b.n, pp = (na + nb) / (a.n + b.n), se = Math.sqrt(pp * (1 - pp) * (1 / a.n + 1 / b.n)) || 1e-9;
    const z = (pb - pa) / se;
    if (Math.abs(pb - pa) >= 0.05 && Math.abs(z) >= 3) freqRows.push({ когорта: coh, спот: key.slice(coh.length + 1), действие: act, [Y0]: +(pa * 100).toFixed(1), [Y1]: +(pb * 100).toFixed(1), разница_пп: +((pb - pa) * 100).toFixed(1), z: +z.toFixed(1), n: [a.n, b.n] });
    const ea = a.a[act], eb = b.a[act];
    if (ea && eb && ea[1] != null && eb[1] != null && ea[0] >= 200 && eb[0] >= 200) {
      const s2 = Math.sqrt(ea[2] ** 2 / ea[0] + eb[2] ** 2 / eb[0]) || 1e-9, ze = (eb[1] - ea[1]) / s2;
      if (Math.abs(ze) >= 3 && Math.abs(eb[1] - ea[1]) >= 0.3) evRows.push({ когорта: coh, спот: key.slice(coh.length + 1), действие: act, ['EV_' + Y0]: ea[1], ['EV_' + Y1]: eb[1], разница_bb: +(eb[1] - ea[1]).toFixed(2), z: +ze.toFixed(1), n: [ea[0], eb[0]] });
    }
  }
}
freqRows.sort((x, y) => Math.abs(y.z) - Math.abs(x.z)); evRows.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
const checked = [...S.values()].filter(o => o[Y0] && o[Y1] && o[Y0].n >= MIN_N && o[Y1].n >= MIN_N).length;
const rep = { годы: years, сравнивали: [Y0, Y1], решений_по_когортам: tot, спотов_сравнено: checked, частоты_изменились: freqRows.length, EV_изменился: evRows.length, частоты: freqRows.slice(0, 300), EV: evRows.slice(0, 300) };
fs.writeFileSync(path.join(OUT, 'годы_отчёт.json'), JSON.stringify(rep, null, 1));
const md = ['# Игра ' + Y0 + ' vs ' + Y1, '', 'Решений: ' + JSON.stringify(tot), 'Спотов с выборкой ≥ ' + MIN_N + ' в оба года: ' + checked,
  'Частота действия изменилась (≥ 5 п.п., z ≥ 3): ' + freqRows.length, 'EV действия изменился (≥ 0,3 bb, z ≥ 3): ' + evRows.length, '', '## Частоты — 40 самых заметных',
  ...freqRows.slice(0, 40).map(r => `- ${r.когорта} ${r.спот} «${r.действие}»: ${r[Y0]}% → ${r[Y1]}% (${r.разница_пп > 0 ? '+' : ''}${r.разница_пп} п.п., z=${r.z})`), '', '## EV — 40 самых заметных',
  ...evRows.slice(0, 40).map(r => `- ${r.когорта} ${r.спот} «${r.действие}»: ${r['EV_' + Y0]} → ${r['EV_' + Y1]} bb (z=${r.z})`)];
fs.writeFileSync(path.join(OUT, 'годы_отчёт.md'), md.join('\n'));
console.log(md.slice(0, 8).join('\n'));
