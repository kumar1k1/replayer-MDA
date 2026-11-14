'use strict';
// Дым-тест движка: модель с синтетики, несколько раздач с известными картами героя (Dealt to).
const fs = require('fs'), path = require('path');
const C = require('../pipeline/common.cjs'), K = require('../lib/cards.js'), E = require('../engine/engine_v7.js');
const { parseHand } = C.loadParser();
const model = JSON.parse(fs.readFileSync(process.env.MODEL || '/tmp/v7out/model_v7.json', 'utf8'));
const eng = E.create(model, require('../data/eq169.json'));
const dir = process.argv[2] || '/tmp/synth/PS';
const files = fs.readdirSync(dir).slice(0, 3);
let shown = 0;
for (const f of files) for (const x of C.splitHands(fs.readFileSync(path.join(dir, f), 'utf8'), f)) {
  const rp = parseHand(x.hand + '\n'); if (!rp || !rp.n) continue;
  const m = /Dealt to (\S+) \[(\w\w \w\w)\]/.exec(x.hand); if (!m) continue;
  const hi = rp.nm.indexOf(m[1]); const cards = K.parseCards(m[2]);
  for (const d of E.decisionsBacking(rp, () => 'unk', x.fp)) {
    if (d.i !== hi) continue;
    const a = eng.advise(d, cards), v = eng.verdict(a, d.act);
    if (shown < 12 && (d.tbl !== 'RFI' || shown < 6)) {
      shown++;
      console.log(`${d.tbl} ${d.pos} ${d.sB} ${a.hand}: факт «${d.act}» → ${v.text} | совет: ${a.rec.act} (${a.rec.why})`);
      console.log('   ' + a.rows.map(r => `${r.ru} ${r.ev === null ? '—' : (r.ev >= 0 ? '+' : '') + r.ev.toFixed(2)} [${r.src}]`).join(' | '));
    }
  }
}
