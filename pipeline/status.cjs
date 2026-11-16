// Короткая сводка прогона для ЗАПУСК.cmd / СТАТУС.cmd: сколько архивов пройдено по каждому тяжёлому шагу и сколько осталось.
const fs = require('fs'), path = require('path');
const OUT = process.env.OUT_DIR || path.join(__dirname, 'out');
let p = {}; try { p = JSON.parse(fs.readFileSync(path.join(OUT, 'progress.json'), 'utf8')); } catch (e) {}
let total = 0; for (const k in p) total = Math.max(total, p[k].total || 0);
if (!total) { try { total = require('./common.cjs').sourceFiles().length; } catch (e) {} }
if (!total) total = 34;
// если progress.json ещё нет (старый запуск) — считаем пройденные архивы по логу
const RX = { stats: /статы: пройден (\S+)/, sizes: /sizes: пройден (\S+)/, lineup: /лайнап: пройден (\S+)/, model: /v8: источник пройден (\S+)/ };
let logTxt = ''; try { logTxt = fs.readFileSync(path.join(OUT, 'progress_v7.log'), 'utf8'); } catch (e) {}
const fromLog = (k) => { const s = new Set(); for (const ln of logTxt.split('\n')) { const m = RX[k].exec(ln); if (m) s.add(m[1]); } return s.size; };
const steps = [['stats', 'statsdone', '1. Статы игроков'], ['sizes', 'sizesdone', '4. Сайзинги'], ['lineup', 'lineupdone', '5. Лайнап'], ['model', 'modeldone', '6. Модель v8']];
let left = 0, cur = null;
console.log('Пройдено архивов по шагам (всего архивов: ' + total + '):');
for (const [k, flag, name] of steps) {
  const fin = fs.existsSync(path.join(OUT, flag + '.flag'));
  const d = fin ? total : (p[k] ? p[k].done : fromLog(k));
  if (!fin && !cur) cur = name;
  left += total - d;
  console.log('  ' + name + ': ' + d + ' из ' + total + (fin ? ' - готово' : ''));
}
console.log(cur ? 'Сейчас идёт шаг "' + cur + '". Всего осталось пройти архивов (по всем шагам): ' + left : 'Все тяжёлые шаги пройдены.');
