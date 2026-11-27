/* Разбор журнала вопросов (владелец 27.11.2026): настоящие вопросы владельца (голос или через Claude) из tgbot/data/asks.log —
   1) как их понял Claude тогда: условия вопроса, потерянные во фразе Claude (tgbot/guard.cjs conds);
   2) как бот отвечает сейчас своим разбором (без Claude, бесплатно): условия, которых нет в ответе (o.guard).
   Запуск: node tests/tgbot_logcheck.cjs (бот на 8790). Итог — tgbot/data/разбор_журнала.txt (не в git: там вопросы владельца) */
const fs = require('fs'), path = require('path'), http = require('http'), G = require('../tgbot/guard.cjs');
const LOG = path.join(__dirname, '../tgbot/data/asks.log'), OUT = path.join(__dirname, '../tgbot/data/разбор_журнала.txt');
const ask = (q, fake) => new Promise((ok, no) => http.get('http://127.0.0.1:8790/api/ask?nobrain=1&ctx=' + encodeURIComponent('alias:все') + '&q=' + encodeURIComponent(q) + (fake ? '&fake=' + encodeURIComponent(fake) : ''), (r) => { let s = ''; r.on('data', d => (s += d)); r.on('end', () => { try { ok(JSON.parse(s)); } catch (e) { no(e); } }); }).on('error', no));
(async () => {
  const seen = new Map();
  for (const l of fs.readFileSync(LOG, 'utf8').split('\n')) { if (!l) continue; let o; try { o = JSON.parse(l); } catch (e) { continue; } if (!(o.voice || o.brain)) continue; if (!seen.has(o.q)) seen.set(o.q, o); }
  const lostByClaude = [], nowMiss = []; let post = 0;
  for (const [q, o] of seen) {
    const C = G.conds(q); if (!C.length) continue; post++;
    if (o.brain && o.heard && o.heard !== q) { const hc = new Set(G.conds(o.heard).map(c => c.name)); const hl = o.heard.toLowerCase(), lost = C.map(c => c.name).filter(n => !hc.has(n) && !(n.includes('/') && [...hc].some(h => n.includes(h))) && !(n === 'рейзер' && /цбет|конбет|отлож|рейзер/.test(hl)) && !(n === 'коллер' && /пропуск/.test(hl)) && !(n === 'флоп' && /wwsf/.test(hl))); /* роль подразумевается словами фразы Claude (цбет — рейзер, пропуск — коллер) */ if (lost.length) lostByClaude.push({ q, heard: o.heard, lost }); }
    const a = await ask(q); if (a.guard && a.guard.length) nowMiss.push({ q, miss: a.guard, got: (a.blocks || []).filter(b => b.title !== 'Проверьте, так ли я понял').map(b => b.title || b.text || '').join(' | ').slice(0, 160) });
  }
  /* 3) подстраховка: та же ошибка Claude сегодня (фраза Claude из журнала подставлена как его ответ) — бот должен взять свой разбор или предупредить */
  const fixed = [], warned = [], still = [];
  for (const x of lostByClaude) { const a = await ask(x.q, x.heard); const own = a.brain && a.brain.overruled; if (a.guard && a.guard.length) warned.push({ ...x, miss: a.guard }); else if (own) fixed.push(x); else still.push({ ...x, got: (a.blocks || []).map(b => b.title || b.text || '').join(' | ').slice(0, 160) }); }  const L = ['Разбор журнала: настоящих вопросов ' + seen.size + ', постфлоп-вопросов ' + post, '', '1) Claude тогда потерял условие (' + lostByClaude.length + '):', ...lostByClaude.map(x => '  • ' + x.q + '\n      понял: ' + x.heard + '\n      потерял: ' + x.lost.join(', ')), '', '2) Сейчас (свой разбор, без Claude) в ответе нет условия (' + nowMiss.length + '):', ...nowMiss.map(x => '  • ' + x.q + '\n      нет: ' + x.miss.join(', ') + '\n      ответ: ' + x.got), '', '3) Если Claude ошибётся так же снова: сверка заменила его понимание своим разбором — ' + fixed.length + ', предупредил «проверьте» — ' + warned.length + ', ошибку Claude поправил разбор фразы раньше (ответ ниже — проверить глазами) — ' + still.length, ...warned.map(x => '  ! предупредил: ' + x.q + ' — нет: ' + x.miss.join(', ')), ...still.map(x => '  • ' + x.q + '\n      ответ: ' + x.got)];
  fs.writeFileSync(OUT, L.join('\n'), 'utf8');
  console.log('вопросов: ' + seen.size + ', постфлоп: ' + post + ', Claude терял условие: ' + lostByClaude.length + ', сейчас без условия в ответе: ' + nowMiss.length + '; та же ошибка Claude снова: свой разбор ' + fixed.length + ', «проверьте» ' + warned.length + ', поправлено разбором фразы ' + still.length + ' → ' + OUT);
})();
