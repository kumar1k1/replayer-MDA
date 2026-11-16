# П.11 СВЕРКА ПАНЕЛИ С МОДЕЛЬЮ: 20 шагов префлопа из разных раздач — снимок и пересчёт каждого числа
# независимо от движка (прямо по model / sizes / lineup, своим кодом ключей):
#   • «топы, %» — доля действия у топов по счётчикам модели (точный ключ, при < 30 — обобщённый);
#   • размер совета — по таблице сайзингов (свой поиск ключа: топы → пул), × опен для 3-бета/4-бета, + лимперы для изо;
#   • P(все сфолдят) — произведение P(фолд) игроков за спиной, показанных в панели;
#   • фолд = 0; совет — одно из действий спота; EV-совет — максимум среди надёжных вариантов.
#   python3 tests/verify_panel.py [dist] [папка снимков] [число шагов]
import asyncio, sys, os, json
from playwright.async_api import async_playwright
DIST = sys.argv[1] if len(sys.argv) > 1 else 'app/dist'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else '/tmp/shots/verify'
N = int(sys.argv[3]) if len(sys.argv) > 3 else 20
os.makedirs(SHOTS, exist_ok=True)
PICK = r"""(N) => {   // равномерно по раздачам: шаги префлопа с известными картами и без
  const out = []; const all = [];
  HANDS.forEach((H, i) => RMAPP.analyse(H).forEach((x, j) => all.push([i, j, !!x.cards])));
  const withC = all.filter(x => x[2]), noC = all.filter(x => !x[2]);
  const take = (L, n) => { const s = []; for (let q = 0; q < n && L.length; q++) s.push(L[Math.floor((q + 0.5) * L.length / n)]); return s; };
  return take(withC, Math.ceil(N * 0.6)).concat(take(noC, N - Math.ceil(N * 0.6)));
}"""
CHECK = r"""([i, j]) => {
  const H = HANDS[i], x = RMAPP.analyse(H)[j], a = x.a, d = x.d, M = RM_MODEL.EV, errs = [];
  const tk = d.tb + d.kd, band = RMSpots.bandOf(d.eff), pb = RMSpots.posBand;
  const S = [d.tbl, a.st, tk, d.pos, d.oppPos, band, d.L, d.C].join('|'), Sb = '~' + [d.tbl, a.st, tk, pb(d.pos), d.oppPos ? pb(d.oppPos) : '', band, d.L, d.C].join('|');
  const acts = a.rows.map(r => r.act);
  const cnt = (coh, s) => acts.map(ac => (M[coh + '|' + s + '|' + ac + '|*'] || [0])[0]);
  let v = cnt('T', S), tot = v.reduce((p, q) => p + q, 0); if (tot < 30) { v = cnt('T', Sb); tot = v.reduce((p, q) => p + q, 0); }
  a.rows.forEach((r, q) => { const f = tot ? v[q] / tot : 0; if (Math.abs(f - r.freqT) > 1e-9) errs.push('частота ' + r.act + ': панель ' + r.freqT + ', модель ' + f); });
  const fold = a.rows.find(r => r.act === 'fold'); if (fold && fold.ev !== 0) errs.push('EV фолда ≠ 0');
  if (!acts.includes(a.rec.act)) errs.push('совет не из действий спота');
  // размер: свой поиск по таблице
  if (a.rec.size) {
    const T = RM_SIZES, sa = a.rec.act === 'open' ? 'open' : a.rec.act === 'iso' ? 'iso' : a.rec.act === '3bet' ? (d.C === 'C0' ? '3bet' : 'sqz') : '4bet';
    const g = ({ '<12': '<20', '12-19': '<20', '20-35': '20-35', '36-59': '36-59', '60-99': '60+', '100-149': '60+', '150+': '60+' })[band];
    const side = sa === 'open' ? pb(d.pos) : sa === 'iso' ? 'L' + Math.min(Math.max(d.nLimp || 1, 1), 2) : sa === '4bet' ? '*' : (pb(d.pos) === 'SB' || pb(d.pos) === 'BB' ? 'blinds' : 'ip');
    const keys = [d.room + '|' + sa + '|' + g + '|' + side]; if (sa === 'open') keys.push(d.room + '|open|' + g + '|*'); if (sa === 'iso' && side === 'L2') keys.push(d.room + '|iso|' + g + '|L1'); keys.push('*|' + sa + '|' + g + '|' + side);
    let row = null; for (const k of keys) { for (const L of ['tops', 'pool']) { const r = T[L][k]; if (r && r.n >= (L === 'tops' ? 100 : 200)) { row = r; break; } } if (row) break; }
    const m = row ? row.rec : { open: 2, iso: 2.5, '3bet': 3, sqz: 4, '4bet': 2.2 }[sa];
    let to = sa === 'open' ? m : sa === 'iso' ? m + (d.nLimp || 0) : m * d.refTo;
    const mr = sa === 'open' || sa === 'iso' ? 2 : d.refTo + Math.max(1, d.refTo - (sa === '4bet' ? (d.openTo || 0) : 1)); to = Math.max(to, mr);
    to = sa === 'open' || sa === 'iso' ? Math.round(to * 20) / 20 : Math.round(to * 10) / 10;
    if (Math.abs(to - a.rec.size.to) > 1e-9) errs.push('размер: панель ' + a.rec.size.to + ', таблица ' + to);
  }
  // EV-совет — максимум среди надёжных
  if (/^максимальный EV/.test(a.rec.why)) { const best = Math.max(...a.rows.filter(r => r.reliable).map(r => r.ev)); const rr = a.rows.find(r => r.act === a.rec.act); if (Math.abs(rr.ev - best) > 1e-9) errs.push('совет не максимум EV'); }
  return { errs, hand: i + 1, step: j, pos: d.pos, tbl: d.tbl, rec: a.rec.ru, cards: a.hand };
}"""
LINEUP = r"""() => { const t = document.querySelector('.rm-body').textContent; const m = t.match(/P\(все сфолдят\) = (\d+)%/); if (!m) return null;
  const f = [...document.querySelectorAll('.rm-body .rm-li .rm-pf')].map(e => e.textContent).filter(s => /^фолд/.test(s)).map(s => +s.match(/(\d+)%/)[1] / 100);
  return { shown: +m[1], prod: Math.round(f.reduce((a, b) => a * b, 1) * 100), n: f.length }; }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--allow-file-access-from-files', '--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1680, 'height': 1000})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + os.path.abspath(DIST) + '/index.html'); await pg.wait_for_timeout(3500)
        picks = await pg.evaluate(PICK, N)
        bad = 0; lines = []
        for q, (i, j, hasC) in enumerate(picks):
            await pg.evaluate('window.closeReplayer && window.closeReplayer()')
            await pg.evaluate('i => window.openReplayer(i, HANDS.map((_, q) => q), { side: window.RM_SIDE })', i)
            await pg.wait_for_timeout(150)
            for _ in range(j): await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(20)
            await pg.wait_for_timeout(150)
            r = await pg.evaluate(CHECK, [i, j])
            lu = await pg.evaluate(LINEUP)
            if lu and abs(lu['shown'] - lu['prod']) > 1 + lu['n']: r['errs'].append('P(все сфолдят) %d%% ≠ произведение %d%%' % (lu['shown'], lu['prod']))
            name = '%02d_hand%d_step%d.png' % (q + 1, r['hand'], j)
            await pg.screenshot(path=os.path.join(SHOTS, name))
            ok = not r['errs']; bad += 0 if ok else 1
            lines.append(('ok  ' if ok else 'FAIL') + ' %02d #%d %s %s %s → %s%s%s' % (q + 1, r['hand'], r['pos'], r['tbl'], r['cards'] or '(карты неизвестны)', r['rec'], (' · лайнап %d%% = Π %d%%' % (lu['shown'], lu['prod'])) if lu else '', ('  ' + '; '.join(r['errs'])) if r['errs'] else ''))
        print('\n'.join(lines))
        print(('\nВсе %d шагов сверены с моделью' % len(picks)) if not bad and not errs else '\nРасхождений: %d, ошибок JS: %d' % (bad, len(errs)))
        await b.close(); sys.exit(1 if bad or errs else 0)
asyncio.run(main())
