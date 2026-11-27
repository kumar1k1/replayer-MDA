/* Проверка Claude Haiku в боте (владелец 27.11.2026, платно, с потолком трат): вопросы — настоящие из журнала (tgbot/data/asks.log, голос / Claude) и трудные
   формулировки (tests/tgbot_haiku_set.cjs). Haiku — копия бота на порту 8792 (TGBOT_MODEL=claude-haiku-5-5 PORT=8792 TGBOT_NOWHISPER=1);
   правильный ответ — свой разбор бота без Claude (порт 8790, nobrain): для трудных — по правильной фразе, для журнала — по самому вопросу (расхождения — смотреть глазами).
   Запуск: node tests/tgbot_haiku_eval.cjs [потолок $, по умолчанию 2] → tgbot/data/haiku_отчёт.txt (не в git: вопросы владельца) */
const fs = require('fs'), path = require('path'), http = require('http');
const CAP = +(process.argv[2] || 2), OUT = path.join(__dirname, '../tgbot/data/haiku_отчёт.txt'), JS = path.join(__dirname, '../tgbot/data/haiku_отчёт.json');
const get = (port, p) => new Promise((ok, no) => http.get('http://127.0.0.1:' + port + p, (r) => { let s = ''; r.on('data', d => (s += d)); r.on('end', () => { try { ok(JSON.parse(s)); } catch (e) { no(e); } }); }).on('error', no));
const ask = (port, q, voice, nobrain) => get(port, '/api/ask?ctx=' + encodeURIComponent('alias:все') + '&q=' + encodeURIComponent(q) + (voice ? '&voice=1' : '') + (nobrain ? '&nobrain=1' : ''));
/* «что показано»: заголовки без имени игрока, шапки таблиц, крупные цифры; предупреждение сверки — отдельно */
const sig = (a) => (a.blocks || []).filter(b => b.title !== 'Проверьте, так ли я понял').map(b => [String(b.title || b.text || '').replace(/^Я \([^)]*\) — /, '').replace(/^Я \([^)]*\)/, ''), b.big != null ? b.big : '', b.table ? b.table.head.join('/') + ' ' + b.table.rows.length : ''].join(' # ')).join(' || ');
const hasNum = (a) => (a.blocks || []).some(b => b.table || b.big != null);
(async () => {
  const items = [];
  for (const [q, ref] of require('./tgbot_haiku_set.cjs')) items.push({ src: 'трудная', q, ref, voice: 1 });
  const seen = new Set();
  for (const l of fs.readFileSync(path.join(__dirname, '../tgbot/data/asks.log'), 'utf8').split('\n')) { if (!l) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; } if (!(o.voice || o.brain) || seen.has(o.q)) continue; seen.add(o.q);
    const lq = String(o.q).toLowerCase().trim(); const refine = /^(а|и|но|ну\s+а|то\s*же|тоже|теперь|эту|этот|это|сейчас\s+(эту|то\s*же))(\s|,|$)/.test(lq) || lq.split(/\s+/).length <= 2; items.push({ src: refine ? 'журнал (уточнение — без прошлого вопроса)' : 'журнал', q: o.q, ref: null, voice: o.voice ? 1 : 0, refine }); }
  const res = []; let stopped = '';
  for (const it of items) {
    const st = await get(8792, '/api/status'); const usd = st.brain.use.usd; if (usd >= CAP) { stopped = 'остановлено: потрачено $' + usd.toFixed(3) + ' из $' + CAP; break; }
    if (!st.brain.ready) { stopped = 'Claude недоступен: ' + st.brain.lastErr; break; }
    const H = await ask(8792, it.q, it.voice, 0), R = await ask(8790, it.ref || it.q, it.voice, 1);
    const r = { ...it, heard: H.heard || '', brain: H.brain || null, overruled: !!(H.brain && H.brain.overruled), guard: H.guard || null, sH: sig(H), sR: sig(R), numH: hasNum(H), numR: hasNum(R) };
    r.same = r.sH === r.sR; res.push(r);
    if (res.length % 25 === 0) console.log(res.length + ' / ' + items.length + ', $' + usd.toFixed(3));
  }
  const st = await get(8792, '/api/status'), U = st.brain.use;
  /* разбор */
  const hard = res.filter(r => r.src === 'трудная'), real = res.filter(r => r.src === 'журнал'), refi = res.filter(r => r.refine);
  const ok = (xs) => xs.filter(r => r.same && !r.guard), caught = (xs) => xs.filter(r => r.overruled), warned = (xs) => xs.filter(r => r.guard), diff = (xs) => xs.filter(r => !r.same && !r.guard);
  const line = (r) => '  • ' + r.q + '\n      Haiku понял: ' + r.heard + (r.overruled ? '  [сверка заменила на свой разбор]' : '') + (r.guard ? '  [предупреждение: нет ' + r.guard.join(', ') + ']' : '') + '\n      Haiku показал: ' + r.sH.slice(0, 220) + '\n      правильно:     ' + r.sR.slice(0, 220);
  const L = ['ПРОВЕРКА CLAUDE HAIKU 5.5 В БОТЕ — ' + new Date().toISOString().slice(0, 16).replace('T', ' '), stopped || 'все вопросы прогнаны',
    'вопросов: ' + res.length + ' (трудных ' + hard.length + ', из журнала ' + real.length + ', уточнений без прошлого вопроса ' + refi.length + ')',
    'потрачено: $' + U.usd.toFixed(3) + ' (вызовов ' + U.calls + ', токенов: вход ' + U.in + ', запись в кеш ' + U.cw + ', из кеша ' + U.cr + ', выход ' + U.out + '; в среднем $' + (U.usd / Math.max(1, U.calls)).toFixed(4) + ' за вопрос)', '',
    'ТРУДНЫЕ (правильный ответ известен): верно ' + ok(hard).length + ' из ' + hard.length + '; Haiku ошибся, но сверка заменила своим разбором — ' + caught(hard).length + '; бот предупредил «проверьте» — ' + warned(hard).length + '; ответ отличается от правильного — ' + diff(hard).length,
    ...diff(hard).map(line), ...warned(hard).map(line), '',
    'ИЗ ЖУРНАЛА (сравнение со своим разбором бота): совпало ' + ok(real).length + ' из ' + real.length + '; сверка заменила — ' + caught(real).length + '; предупредил — ' + warned(real).length + '; отличается — ' + diff(real).length + ' (ниже — смотреть, кто прав: Haiku или свой разбор)',
    ...diff(real).map(line), ...warned(real).map(line), '',
    'УТОЧНЕНИЯ БЕЗ ПРОШЛОГО ВОПРОСА (' + refi.length + ') — оценить нельзя, в журнале нет прошлого вопроса; только для сведения: отличается ' + diff(refi).length];
  fs.writeFileSync(OUT, L.join('\n'), 'utf8'); fs.writeFileSync(JS, JSON.stringify(res, null, 1), 'utf8');
  console.log(L.slice(0, 6).join('\n') + '\n' + L[L.findIndex(x => x.startsWith('ИЗ ЖУРНАЛА'))] + '\n→ ' + OUT);
})();
