'use strict';
// Матрицы рук (25.11.2026): для каждой клетки и цифры со ссылкой на матрицу — сумма по 169 рукам = раздачи клетки, доля = процент клетки.
// node tests/tgbot_hm.cjs (бот на 8790, без Claude)
const B = 'http://127.0.0.1:8790';
const Q = ['мой RFI по позициям', 'мой RFI по стекам', 'мой RFI с баттона', 'мой RFI с баттона по стекам', 'мои 3-беты по позициям', 'мой 3-бет', 'мои 3-беты на больших стеках',
  'мои колд-коллы по позициям', 'мой колд-колл', '3-бет позиция против позиции', 'колд-колл позиция против позиции', '3-бет баттона против катоффа', 'мои изолейты по позициям',
  'мой изолейт с баттона против одного лимпера', 'мои коллы третьим и четвертым в банк по позициям', 'мой 3-бет против изолейта по позициям', 'мои 3-беты по сайзам',
  'мои фолды на 3-бет по позициям', 'мой фолд на 3-бет в позиции', 'мои 4-беты по позициям', 'мой 4-бет', 'мои коллы 3-бета в холодную по позициям', 'мои фолды на 4-бет по позициям',
  'мои 3-беты без олл-инов по позициям', 'мои сквизы по позициям', 'мой сквиз с бб', 'мои сквизы позиция против комбинации', 'мои сквизы по стекам', 'мои изолейты по позициям на 20-35 бб', 'мой RFI по позициям на 42 бб'];
const num = (v) => parseFloat(String(v).replace(',', '.').replace('%', ''));
(async () => {
  let cells = 0, ok = 0; const bad = [];
  for (const q of Q) {
    const a = await (await fetch(B + '/api/ask?nobrain=1&ctx=' + encodeURIComponent('alias:все') + '&q=' + encodeURIComponent(q))).json();
    const items = [];
    for (const b of a.blocks || []) { if (b.big && b.hm) items.push([b.title, { v: b.big, n: b.n, hm: [].concat(b.hm) }]); if (b.table) for (const r of b.table.rows) r.slice(1).forEach((c, k) => { if (c && c.hm) items.push([r[0] + ' · ' + b.table.head[k + 1], { v: c.v, n: c.n, hm: [c.hm] }]); }); }
    for (const [lab, c] of items) {
      if (!c.n) continue; cells++;
      const m = await (await fetch(B + '/api/hm?r=' + encodeURIComponent(JSON.stringify(c.hm)))).json();
      if (m.none) { bad.push(q + ' · ' + lab + ': матрицы нет'); continue; }
      let d = 0, n = 0; for (const v of Object.values(m.cells)) { d += v[0]; n += v[1]; }
      const share = c.hm[0].dm; // у размеров 3-бета клетка = доля: n размера из d всех 3-бетов
      const okN = share ? n === c.n : d === c.n, okV = Math.abs((d ? n / d * 100 : 0) - num(c.v)) < 0.06;
      if (okN && okV) ok++; else bad.push(q + ' · ' + lab + ': клетка ' + c.v + ' / ' + c.n + ', матрица ' + (d ? (n / d * 100).toFixed(1) : '-') + '% / ' + (share ? n : d));
    }
  }
  console.log('клеток с матрицей: ' + cells + ', совпало: ' + ok + ', не совпало: ' + bad.length);
  bad.slice(0, 40).forEach(x => console.log('✗ ' + x));
})();
