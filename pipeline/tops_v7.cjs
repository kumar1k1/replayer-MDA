'use strict';
// Топы v7 по половине A: то же правило, что make_tops v6 (кластеры 0,4,5,8,10 ∪ bb100 ≥ 5 при ≥3000 рук),
// но статы взяты только из половины A. → out/tops_A.json { tops: {ник: {...}}, half: 'A' }
//   node pipeline/tops_v7.cjs [MIN_HANDS_TOP=3000] [BB100_TOP=5]
const fs = require('fs'), path = require('path');
const C = require('./common.cjs');
const HALF = process.env.HALF || 'A';
const MINH = +(process.argv[2] || 3000), BB = +(process.argv[3] || 5);
const atlas = require(path.join(C.BACKING, 'clusters', 'bublik_atlas.json'));
const { classify } = require(path.join(C.BACKING, 'clusters', 'classify.js'));
const players = JSON.parse(fs.readFileSync(path.join(C.OUT, 'players_' + HALF + '.json'), 'utf8'));
const TOP = new Set([0, 4, 5, 8, 10]);
const tops = {};
for (const [nick, r] of Object.entries(players)) {
  const p = r.pool; if (p.n < 200) continue;
  const cl = classify({ vpip: p.vpip, pfr: p.pfr, ws: p.ws, wn: p.wn, ls: p.ls, ln: p.ln, bb100: p.bb100 }, atlas);
  if (!cl) continue;
  if (TOP.has(cl.id) || (p.bb100 >= BB && p.n >= MINH)) tops[nick] = { cluster: cl.id, bb100: p.bb100, hands: p.n };
}
fs.writeFileSync(path.join(C.OUT, 'tops_' + HALF + '.json'), JSON.stringify({ tops, half: HALF, count: Object.keys(tops).length }));
console.log('топов по половине', HALF + ':', Object.keys(tops).length);
