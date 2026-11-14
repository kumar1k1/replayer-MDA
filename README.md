# replayer-MDA — умный реплеер: алгоритм подсказок v7

Отдельный проект. Реплеер раздач, который на каждом решении игрока подсказывает, какое действие по базе на 100 млн рук оптимально, а какое нет.

Опирается на два проекта, **которые здесь не меняются**:
- **Backing**, ветка `Clever-Replay` — нынешний реплеер, конвейер v6 и парсер историй (`parser.cjs` берётся оттуда, путь — `BACKING_DIR`);
- **MDA Lab** — его реплеер (`renderer/replay.js`, запись `rp`). Для него есть адаптер `RMEngine.fromMda`.

## Что где
- `lib/cards.js` — карты, 169 рук, классы, оценка 7 карт, эквити (точно на флопе и тёрне, Монте-Карло на префлопе), рука против диапазона.
- `lib/build_eq169.js` → `data/eq169.json` — префлоп-эквити 169×169 (20 000 выборок на пару).
- `lib/spots.js` — разметка префлоп-спотов, общая для конвейера и браузера.
- `pipeline/` — проходы по базе: `passA_v7` (игроки, половина A), `tops_v7`, `passV7` (модель).
- `engine/engine_v7.js` — движок подсказок: `create(model, eq169)` → `advise(spot, cards)` и `verdict(advice, act)`.
- `tests/` — проверки (см. `docs/АЛГОРИТМ_v7.md` §3).
- `docs/АУДИТ_v6.md` — что было не так в v6. `docs/АЛГОРИТМ_v7.md` — как устроен v7, проверки, запуск.

## Быстрая проверка
```
node tests/test_cards.js
node <mda-lab>/tools/make-demo-hh.js /tmp/synth2 0,400000,0      # синтетика (пишется в /tmp, MDA Lab не меняется)
OUT_DIR=/tmp/v7b RAW_DIRS=/tmp/synth2 GROUPS=- TOPS=- node pipeline/passV7.cjs
node tests/validate_bias.cjs /tmp/synth2/PS
node tests/validate_pushfold.cjs /tmp/synth2/PS /tmp/v7b/model_v7.json
MODEL=/tmp/v7b/model_v7.json node tests/smoke_engine.js /tmp/synth2/PS
```

## Дальше
1. Прогнать v7 на вашей базе (команды — `docs/АЛГОРИТМ_v7.md` §5).
2. Встроить движок в реплеер: панель «СЕЙЧАС ХОД» — варианты с EV от фолда, совет, вердикт.
3. Слой «ваши руки» из базы MDA Lab: несмещённый EV по конкретной руке.
4. Постфлоп по той же схеме. ICM / стадия турнира.
