# Разбор турнира в реплеере (headless Chrome): время загрузки модели, вердикты по всем решениям героя.
#   python3 tests/tour_eval.py <файл турнира> [dist] [json-выход]
import asyncio, sys, json, os, time
from playwright.async_api import async_playwright
F = sys.argv[1]; DIST = sys.argv[2] if len(sys.argv) > 2 else 'app/dist'; OUTJ = sys.argv[3] if len(sys.argv) > 3 else None
EVAL = r"""() => {
  const res = { hands: HANDS.length, dec: 0, kinds: {}, errBB: 0, rows: [] };
  HANDS.forEach((H, i) => { for (const x of RMAPP.analyse(H)) { if (x.d.i !== H.hero) continue; res.dec++;
    const k = x.err ? 'сбой' : (x.v ? x.v.kind : 'нет'); res.kinds[k] = (res.kinds[k] || 0) + 1;
    if (k === 'ошибка') res.errBB += x.v.d || 0;
    res.rows.push({ i, act: x.d.act, pos: x.d.pos, eff: x.d.eff && +x.d.eff.toFixed(1), hand: x.a && x.a.hand, kind: k, d: x.v && x.v.d, best: x.a && x.a.best && (x.a.best.ru || x.a.best.label || x.a.best.act), rec: x.a && x.a.rec && (x.a.rec.ru || ''), st: x.a && x.a.st, kd: x.a && x.a.kd, stage: x.a && x.a.stage, err: x.err || null }); } });
  return res; }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--allow-file-access-from-files', '--no-sandbox', '--js-flags=--max-old-space-size=8192'])
        pg = await b.new_page(viewport={'width': 1680, 'height': 1000})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        t0 = time.time()
        await pg.goto('file://' + os.path.abspath(DIST) + '/index.html', timeout=600000)
        await pg.wait_for_function('() => window.RM_MODEL && window.RMAPP', timeout=600000)
        t1 = time.time()
        mem = await pg.evaluate('() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null')
        await pg.set_input_files('#file', F)
        await pg.wait_for_function('() => window.HANDS && HANDS.length > 0', timeout=600000)
        await pg.wait_for_timeout(1000)
        t2 = time.time()
        r = await pg.evaluate(EVAL)
        t3 = time.time()
        print('загрузка страницы с моделью: %.1f с, память JS %s МБ; загрузка турнира %.1f с; разбор всех решений %.1f с' % (t1 - t0, mem, t2 - t1, t3 - t2))
        print('раздач', r['hands'], 'решений героя', r['dec'], json.dumps(r['kinds'], ensure_ascii=False), 'ошибок на', round(r['errBB'], 1), 'BB')
        print('JS-ошибки:', errs[:3] or 'нет')
        if OUTJ: json.dump(r, open(OUTJ, 'w'), ensure_ascii=False)
        await b.close()
asyncio.run(main())
