'use strict';
// Замена окружения программы MDA Lab для реплеера (как preview/shim.js в MDA Lab): глобальные el, DB, RP,
// replaysFor, heroLabel. Реплеер MDA Lab берёт их из core.js / hands-ui.js / app.js программы.
var RP = null; // открытый реплеер (в MDA Lab объявлен в hands-ui.js)
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function heroLabel() { return 'Вы'; }
// записи раздач для реплеера: заполняет app.js (HANDS[i].rec — запись в формате MDA Lab)
window.HANDS = [];
window.DB = { cols: { net: [], nev: [], room: [] }, rooms: ['PokerStars', 'CoinPoker', 'PokerStars.es', 'WPN', '888poker', 'iPoker', 'Chico', 'GGPoker', 'другой рум', 'Winamax'] };
async function replaysFor(ids) { const o = {}; for (const i of ids) o[i] = window.HANDS[i] ? window.HANDS[i].rec : null; return o; }
