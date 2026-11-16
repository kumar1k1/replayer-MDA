# П.9 ПРОВЕРКА РЕПЛЕЕРА В БРАУЗЕРЕ (headless Chrome): app/dist/index.html с примером раздач.
#  1. страница открывается без ошибок JS;
#  2. запись для реплеера MDA Lab сходится: фишки сохраняются (стеки в конце + банк = стеки в начале),
#     число шагов префлопа = числу решений, по которым считаются подсказки (иначе панель показывала бы чужой ход);
#  3. в каждой раздаче на каждом шаге префлопа панель «Сейчас ход» рисуется, совет — из списка действий спота;
#  4. снимки: список и несколько шагов.
#   python3 tests/test_app.py [путь к dist] [папка снимков]
import asyncio, sys, json
from playwright.async_api import async_playwright
DIST = sys.argv[1] if len(sys.argv) > 1 else 'app/dist'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else '/tmp/shots'
CHECK = r"""() => {
  const out = { hands: HANDS.length, chips: 0, map: 0, details: [] };
  HANDS.forEach((H, i) => {
    const fr = Replay.frames(H.rec), f0 = fr[0], fl = fr[fr.length - 1];
    const s0 = f0.stacks.reduce((a, b) => a + b, 0), s1 = fl.stacks.reduce((a, b) => a + b, 0) + fl.pot + fl.bets.reduce((a, b) => a + b, 0);
    if (Math.abs(s0 - s1) > 0.05) { out.chips++; out.details.push('#' + (i + 1) + ' фишки ' + s0.toFixed(2) + ' → ' + s1.toFixed(2)); }
    const adv = RMAPP.analyse(H);
    const pre = fr.filter((f, k) => k >= 2 && f.street === 0 && f.actor >= 0).length;
    if (pre !== adv.length) { out.map++; out.details.push('#' + (i + 1) + ' шагов префлопа ' + pre + ', решений ' + adv.length); }
    for (const x of adv) if (x.err) out.details.push('#' + (i + 1) + ' ошибка движка: ' + x.err);
  });
  return out;
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--allow-file-access-from-files', '--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1680, 'height': 1000})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'fonts.g' not in m.text else None)
        import os
        await pg.goto('file://' + os.path.abspath(DIST) + '/index.html')
        await pg.wait_for_timeout(3500)
        r = await pg.evaluate(CHECK)
        fails = 0
        def ok(c, m):
            nonlocal fails
            print(('ok  ' if c else 'FAIL') + ' ' + m)
            if not c: fails += 1
        ok(not errs, 'страница без ошибок JS' + ('' if not errs else ': ' + '; '.join(errs[:3])))
        ok(r['hands'] > 0 and r['chips'] == 0, 'фишки сходятся во всех %d раздачах' % r['hands'])
        ok(r['map'] == 0, 'шаги префлопа реплеера ↔ решения подсказок совпадают')
        for d in r['details'][:10]: print('     ', d)
        await pg.screenshot(path=SHOTS + '/app_list.png')
        # панель на каждом шаге префлопа во всех раздачах
        bad = 0; steps = 0
        for i in range(r['hands']):
            await pg.evaluate('window.closeReplayer && window.closeReplayer()')
            await pg.evaluate('i => window.openReplayer(i, HANDS.map((_, q) => q), { side: window.RM_SIDE })', i)
            await pg.wait_for_timeout(150)
            n = await pg.evaluate('i => RMAPP.analyse(HANDS[i]).length', i)
            for k in range(n):
                txt = await pg.evaluate("() => (document.querySelector('.rm-body') || {}).textContent || ''")
                kc = await pg.evaluate('([i, k]) => !!RMAPP.analyse(HANDS[i])[k].cards', [i, k])
                # совет — только когда карты известны; без карт — пометка «совета нет»
                if 'Сейчас ход' not in txt or (kc and 'Совет' not in txt) or (not kc and ('Совет' in txt or 'совета нет' not in txt)): bad += 1
                steps += 1
                await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(30)
        ok(bad == 0 and steps > 0, 'панель «Сейчас ход» на всех %d шагах: совет только при известных картах' % steps + ('' if not bad else ' (нет на %d)' % bad))
        ok(not errs, 'без ошибок JS при листании')
        await pg.evaluate('window.closeReplayer && window.closeReplayer()')
        await b.close()
        print('\nВсе проверки реплеера пройдены' if not fails else '\nЕсть ошибки: %d' % fails)
        sys.exit(1 if fails else 0)
asyncio.run(main())
