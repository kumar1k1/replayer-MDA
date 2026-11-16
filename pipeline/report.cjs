'use strict';
// П.10 ИТОГ ПРОГОНА: сводка по всем шагам конвейера в одном файле — out/ИТОГ_ПРОГОНА.md.
// Его присылают обратно для проверки (п.11): по нему видно, сошлось ли всё на полной базе.
const fs = require('fs'), path = require('path');
const OUT = process.env.OUT_DIR || path.join(__dirname, 'out');
const J = (f) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch (e) { return null; } };
const L = [];
const pool = J('pool_v8.json'), cl = J('clusters_report.json'), tops = J('tops_report.json'), sz = J('sizes_report.json'), lu = J('lineup_report.json');
let meta = null; try { const s = fs.readFileSync(path.join(OUT, 'model_v8.json'), 'utf8'); const i = s.indexOf('"meta":'); meta = JSON.parse(s.slice(i + 7, s.indexOf('}', i) + 1)); } catch (e) { /* нет модели */ }
L.push('# Итог прогона replayer-MDA — ' + new Date().toISOString().slice(0, 16).replace('T', ' '), '');
L.push('## 1. Статы игроков');
if (pool) L.push('- раздач: ' + pool.stats.hands + ', повторов отсеяно: ' + pool.stats.dups + ', повреждённых: ' + pool.stats.broken + ', ошибок разбора: ' + pool.stats.errs, '- игроков всего: ' + pool.players + ', выгружено (≥ 50 рук): ' + pool.kept);
else L.push('- НЕТ pool_v8.json — шаг 1 не завершён');
L.push('', '## 2. Кластеры');
if (cl) {
  L.push('- игроков: ' + cl.players + ', надёжных (≥ ' + cl.reliableHands + ' рук): ' + cl.reliablePlayers + (cl.merges != null ? ', объединено ников: ' + cl.merges + ' (не объединено: ' + cl.notMerged + ')' : ''));
  if (cl.prior) L.push('- средние пула: ' + cl.prior.map(p => p.stat + ' ' + p.mean).join(', '));
  if (cl.agreement) for (const a of cl.agreement) L.push('- рук в половине ' + a.hands_each_half + ': игроков ' + a.players + ', тот же кластер ' + a.same + '%, тот же или соседний ' + a.sameOrNeighbor + '%, та же группа ' + a.sameGroup + '%');
  if (cl.sixmax) L.push('- 6-max: игроков full ' + cl.sixmax.full.n + ', short ' + cl.sixmax.shortRaw.n);
  if (cl.distributionReliable) L.push('- доли кластеров (надёжные): ' + cl.distributionReliable.map(x => x.cl + ':' + x.share + '%').join(' '));
} else L.push('- НЕТ clusters_report.json');
L.push('', '## 3. Топы');
if (tops) L.push('- регов: ' + tops.regs + ', с ≥ ' + tops.minHands + ' рук: ' + tops.regsEnoughHands + ', топов A/B: ' + tops.topsA + ' / ' + tops.topsB + ', подтвердились на другой половине: ' + tops.confirmedOnB, '- корреляция винрейта A↔B: ' + tops.winrateCorrAB_all + ' (пар ' + tops.pairs + '), типичный ДИ на 1500 руках: ±' + tops.typicalCI_bb100_at_1500_hands + ' bb/100');
else L.push('- НЕТ tops_report.json');
L.push('', '## 4. Сайзинги');
if (sz) { L.push('- решений: ' + sz.decisions + ', рейзов: ' + sz.raises + ', эффективных олл-инов: ' + sz.aiEffRaises + ', ключей пул/топы: ' + sz.keysPool + ' / ' + sz.keysTops);
  if (sz.commit && sz.commit.tops) L.push('- пуш вместо рейза у топов (размер/эфф. стек → доля пушей): ' + Object.entries(sz.commit.tops).filter(([k]) => k.startsWith('3bet')).map(([k, v]) => k.split('|')[1] + '→' + v.shove + '%').join(', ')); }
else L.push('- НЕТ sizes_report.json');
L.push('', '## 5. Лайнап');
if (lu) {
  for (const f in lu.fit) L.push('- ' + f + ': log-loss пул ' + lu.fit[f].logloss_pool + ' → кластер ' + lu.fit[f].logloss_cluster + ' → игрок ' + lu.fit[f].logloss_player + ' (Kc ' + lu.fit[f].Kc + ', Kp ' + lu.fit[f].Kp + ')');
  for (const f in lu.test) { const t = lu.test[f]; L.push('- P(все сфолдят) после ' + (f === 'vso' ? 'опена' : 'пуша') + ', половина B: log-loss ' + t.pool.logloss + ' → ' + t.player_adj.logloss + '; калибровка ' + t.player_adj.calib.map(c => c.pred + '→' + c.fact).join(', ')); }
} else L.push('- НЕТ lineup_report.json');
L.push('', '## 6. Модель v8');
if (meta) L.push('- ' + JSON.stringify(meta)); else L.push('- НЕТ model_v8.json');
const out = path.join(OUT, 'ИТОГ_ПРОГОНА.md');
fs.writeFileSync(out, L.join('\n') + '\n');
console.log(L.join('\n'));
