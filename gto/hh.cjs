// Разбор раздачи PokerStars-формата (селфплей HRC): места, стеки в BB, позиции, карты всех, префлоп и постфлоп действия.
const POS = { 2: ['BU', 'BB'], 3: ['BU', 'SB', 'BB'], 4: ['CO', 'BU', 'SB', 'BB'], 5: ['HJ', 'CO', 'BU', 'SB', 'BB'], 6: ['UTG', 'HJ', 'CO', 'BU', 'SB', 'BB'], 7: ['UTG', 'MP', 'HJ', 'CO', 'BU', 'SB', 'BB'], 8: ['UTG', 'EP', 'MP', 'HJ', 'CO', 'BU', 'SB', 'BB'], 9: ['UTG', 'UTG1', 'EP', 'MP', 'HJ', 'CO', 'BU', 'SB', 'BB'], 10: ['UTG', 'UTG1', 'UTG2', 'EP', 'MP', 'HJ', 'CO', 'BU', 'SB', 'BB'] };
const R = '23456789TJQKA';
function h169(c) { // 'Ah Kd' → индекс 0..168 и имя
  const [a, b] = c.trim().split(/\s+/); let r1 = R.indexOf(a[0]), r2 = R.indexOf(b[0]); const s = a[1] === b[1];
  if (r1 < r2) [r1, r2] = [r2, r1];
  const name = r1 === r2 ? R[r1] + R[r2] : R[r1] + R[r2] + (s ? 's' : 'o');
  return name;
}
const num = (s) => +String(s).replace(/,/g, '');
function parse(t) {
  const hd = /Level [^(]*\(([\d.,]+)\/([\d.,]+)\)/.exec(t); if (!hd) return null;
  const sb = num(hd[1]), bb = num(hd[2]);
  const btn = +(/Seat #(\d+) is the button/.exec(t) || [])[1];
  const maxm = +(/ (\d+)-max/.exec(t) || [])[1] || null;
  const seats = []; const re = /^Seat (\d+): (.+?) \(([\d.,]+) in chips/mg; let m;
  const head = t.split('*** HOLE CARDS ***')[0];
  while ((m = re.exec(head))) seats.push({ seat: +m[1], name: m[2], stack: num(m[3]) });
  if (seats.length < 2) return null;
  const ante = num((/posts the ante ([\d.,]+)/.exec(t) || [])[1] || 0);
  // порядок от первого после баттона
  seats.sort((a, b) => a.seat - b.seat);
  let bi = seats.findIndex(s => s.seat === btn); if (bi < 0) bi = 0;
  const n = seats.length, P = POS[n] || POS[8];
  const order = []; for (let k = 1; k <= n; k++) order.push(seats[(bi + k) % n]); // SB, BB, UTG...
  // позиция: order[0]=SB, order[1]=BB (для n>2), дальше UTG...
  const byName = {};
  if (n === 2) { byName[seats[bi].name] = 'BU'; byName[order[0].name] = 'BB'; }
  else { byName[order[0].name] = 'SB'; byName[order[1].name] = 'BB'; for (let k = 2; k < n; k++) byName[order[k].name] = P[k - 2]; }
  for (const s of seats) { const hm = /^HRC\|(\w+)$/.exec(s.name); s.pos = hm ? hm[1] : byName[s.name]; s.bb = s.stack / bb; }
  const cards = {}; const dre = /^Dealt to (.+?) \[(.. ..)\]/mg; while ((m = dre.exec(t))) cards[m[1]] = m[2];
  const parts = t.split(/^\*\*\* (FLOP|TURN|RIVER|SHOW DOWN|SUMMARY) \*\*\*/m);
  const pre = parts[0].split('*** HOLE CARDS ***')[1] || '';
  const acts = (txt) => { const a = []; const are = /^(.+?): (folds|checks|calls ([\d.,]+)|bets ([\d.,]+)|raises [\d.,]+ to ([\d.,]+))( and is all-in)?/mg; let x; while ((x = are.exec(txt))) { const k = x[2].split(' ')[0]; a.push({ name: x[1], k: k === 'folds' ? 'f' : k === 'checks' ? 'x' : k === 'calls' ? 'c' : k === 'bets' ? 'b' : 'r', amt: num(x[3] || x[4] || x[5] || 0) / bb, allin: !!x[6] }); } return a; };
  const streets = { pre: acts(pre) }; const board = {};
  for (let i = 1; i < parts.length; i += 2) { const nm = parts[i]; if (nm === 'FLOP' || nm === 'TURN' || nm === 'RIVER') { streets[nm.toLowerCase()] = acts(parts[i + 1]); board[nm.toLowerCase()] = (/^\s*\[([^\]]+)\](?: \[([^\]]+)\])?/.exec(parts[i + 1]) || []).slice(1).filter(Boolean).join(' '); } }
  const won = {}; const wre = /^(.+?) collected ([\d.,]+) from/mg; while ((m = wre.exec(t))) won[m[1]] = (won[m[1]] || 0) + num(m[2]) / bb;
  return { sb, bb, ante: ante / bb, btn, maxm, n, seats, cards, streets, board, won, id: (/Hand #(\d+)/.exec(t) || [])[1], title: (/Tournament #\d+, ([^-]+)/.exec(t) || [])[1] };
}
module.exports = { parse, h169, POS };
