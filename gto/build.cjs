// GTO-база из селфплея HRC — ОТДЕЛЬНО от базы майнинга. Пишет gto/out/<набор>_<стек>.json по одному на вложенный архив.
// Для каждого префлоп-спота (кто что сделал до нас) и каждой из 169 рук: сколько раз какое действие и средний результат (BB, chip EV по факту).
// Чекпоинт: готовые наборы пропускаются (файл уже есть), ГТО_БАЗА.cmd можно закрыть и запустить снова.
const fs = require('fs'), path = require('path'), Z = require('./zipread.cjs'), H = require('./hh.cjs');
const ZIP = process.argv[2] || process.env.GTO_ZIP; if (!ZIP || !fs.existsSync(ZIP)) { console.log('Не найден архив: ' + ZIP); process.exit(1); }
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'build.log'); const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(LOG, new Date().toISOString().slice(0, 19) + ' ' + s + '\n'); };
const ONLY = process.env.GTO_ONLY ? new RegExp(process.env.GTO_ONLY, 'i') : null;
const LIMIT = +(process.env.GTO_LIMIT || 0); // для проверки: раздач на набор
const R1 = (x) => Math.round(x * 10) / 10;

// Действие префлопа в коде узла: f, x, c (колл/лимп), r<до сколько BB>, j (олл-ин любым способом)
const code = (a) => a.k === 'f' ? 'f' : a.k === 'x' ? 'x' : a.allin ? 'j' : a.k === 'c' ? 'c' : 'r' + R1(a.amt);
function netOf(t, p) { // результат каждого игрока в BB: выигрыш − вложено
  const inv = {}; for (const s of p.seats) inv[s.name] = 0;
  const add = (n, v) => { inv[n] = (inv[n] || 0) + v; };
  let m; const ar = /^(.+?): posts the ante ([\d.,]+)/mg; while ((m = ar.exec(t))) add(m[1], +m[2].replace(/,/g, '') / p.bb);
  const streets = t.split(/^\*\*\* (?:HOLE CARDS|FLOP|TURN|RIVER|SHOW DOWN|SUMMARY) \*\*\*/m);
  // блайнды — в префлоп-улице
  for (let si = 0; si < Math.min(streets.length, 5); si++) {
    const s = streets[si], cur = {};
    if (si === 0) { const br = /^(.+?): posts (?:small|big) blind ([\d.,]+)/mg; while ((m = br.exec(s))) cur[m[1]] = (cur[m[1]] || 0) + +m[2].replace(/,/g, '') / p.bb; }
    if (si === 1) { const br = /^(.+?): posts (?:small|big) blind ([\d.,]+)/mg; const h0 = streets[0]; while ((m = br.exec(h0))) cur[m[1]] = (cur[m[1]] || 0) + +m[2].replace(/,/g, '') / p.bb; }
    if (si === 0) continue; // ставки начинаются после HOLE CARDS
    const re = /^(.+?): (calls ([\d.,]+)|bets ([\d.,]+)|raises [\d.,]+ to ([\d.,]+))/mg;
    while ((m = re.exec(s))) { const n = m[1]; if (m[3]) cur[n] = (cur[n] || 0) + +m[3].replace(/,/g, '') / p.bb; else if (m[4]) cur[n] = (cur[n] || 0) + +m[4].replace(/,/g, '') / p.bb; else cur[n] = +m[5].replace(/,/g, '') / p.bb; }
    const ur = /^Uncalled bet \(([\d.,]+)\) returned to (.+)$/mg; while ((m = ur.exec(s))) cur[m[2].trim()] = (cur[m[2].trim()] || 0) - +m[1].replace(/,/g, '') / p.bb;
    for (const n in cur) add(n, cur[n]);
  }
  const net = {}; for (const n in inv) net[n] = (p.won[n] || 0) - inv[n];
  return net;
}
async function buildSet(name, files) {
  // узел: 'n|ПОЗ|история' → { a: [коды действий], h: {рука: [счётчики..., суммы результата..., суммы квадратов...]} }
  const N = {}; let hands = 0, bad = 0, sumNet = 0; const t0 = Date.now(); let depth = null, players = null;
  const txt = files.filter(f => !f.zipped && !/\.(zip|json|hrcv|hrcz|dat)$/i.test(f.name));
  outer: for (const f of txt) {
    for await (const t of Z.handsOf(f)) {
      const p = H.parse(t); if (!p) { bad++; continue; }
      if (depth === null) { depth = R1(p.seats[0].bb); players = p.n; }
      const net = netOf(t, p); for (const n in net) sumNet += net[n];
      const posOf = {}; for (const s of p.seats) posOf[s.name] = s.pos;
      let hist = [];
      for (const a of p.streets.pre) {
        const pos = posOf[a.name], c = code(a), cards = p.cards[a.name];
        const key = pos + '|' + (hist.join(' ') || '-');
        let nd = N[key]; if (!nd) nd = N[key] = { a: [], h: {} };
        let ai = nd.a.indexOf(c); if (ai < 0) { nd.a.push(c); ai = nd.a.length - 1; }
        if (cards) {
          const h = H.h169(cards); let row = nd.h[h]; if (!row) row = nd.h[h] = { n: [], s: [], q: [] };
          row.n[ai] = (row.n[ai] || 0) + 1; const v = net[a.name] || 0; row.s[ai] = (row.s[ai] || 0) + v; row.q[ai] = (row.q[ai] || 0) + v * v;
        }
        if (c !== 'f') hist.push(pos + ':' + c);
      }
      if (++hands % 500000 === 0) log('  ', name, hands, 'раздач', ((Date.now() - t0) / 60000).toFixed(1), 'мин');
      if (LIMIT && hands >= LIMIT) break outer;
    }
  }
  // плотный вид: для каждого узла — список действий и по рукам массивы n / ср.результат
  const nodes = {};
  for (const [k, nd] of Object.entries(N)) {
    const A = nd.a.length, tot = new Array(A).fill(0), hs = {};
    for (const [h, r] of Object.entries(nd.h)) {
      const n = [], ev = [], sd = [];
      for (let i = 0; i < A; i++) { const c = r.n[i] || 0; n.push(c); tot[i] += c; ev.push(c ? +(r.s[i] / c).toFixed(3) : null); sd.push(c > 1 ? +Math.sqrt(Math.max(0, r.q[i] / c - (r.s[i] / c) ** 2)).toFixed(2) : null); }
      hs[h] = { n, ev, sd };
    }
    nodes[k] = { act: nd.a, total: tot, hands: hs };
  }
  return { set: name, depth, players, hands, bad, zeroSum: +(sumNet / Math.max(1, hands)).toFixed(4), nodes: Object.keys(nodes).length, minutes: +((Date.now() - t0) / 60000).toFixed(1), data: nodes };
}
(async () => {
  const top = Z.walk(ZIP); let ni = 0;
  log('GTO-база: архив', ZIP, '| вложенных наборов:', top.length);
  for (const z of top) {
    const nm = z.name.replace(/^.*?20ml\//, '').replace(/\.zip$/i, '').replace(/[\\/ ]+/g, '_');
    if (ONLY && !ONLY.test(nm)) continue;
    const dest = path.join(OUT, nm + '.json');
    if (fs.existsSync(dest) && !LIMIT) { log('  уже готово:', nm); continue; }
    log('Набор', nm, '— начало');
    let files, cleanup = () => {};
    if (z.zipped) { const nz = await Z.openNested(z, ni++); files = nz.files; cleanup = nz.cleanup; } else files = [z];
    const res = await buildSet(nm, files); cleanup();
    fs.writeFileSync(dest + '.tmp', JSON.stringify(res)); fs.renameSync(dest + '.tmp', dest);
    log('Набор', nm, 'готов:', res.hands, 'раздач,', res.nodes, 'спотов, стек', res.depth, 'BB,', res.players, 'игр.,', res.minutes, 'мин | проверка суммы (должно быть ≈ 0):', res.zeroSum);
  }
  log('ВСЁ ГОТОВО');
})().catch(e => { log('ОШИБКА: ' + e.stack); process.exit(1); });
