'use strict';
// КЛАСТЕРЫ ПО МОДЕЛИ ТРЕНЕРА (docs/КЛАСТЕРЫ.md, data/clusters_v2.json). Работает в Node и в браузере (window.RMClusters).
// classify(rates) — rates: 11 статов в процентах в порядке модели
//   [VPIP, PFR, Limp nSB, 3Bet nAI, F3Bet, WS, LS, WN, LN, Bet River HU, Fold to River Bet HU]
// → { cl, d, cl2, d2, dists } — ближайший кластер, расстояние («чистота»), второй по близости.
(function (root, factory) {
  if (typeof module !== 'undefined') module.exports = factory();
  else root.RMClusters = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // группы из документации: реги (выигрывающие) / невыигрывающие ниты / фиши / суперфиши
  const GROUP = {};
  [8, 0, 5, 4, 3, 10].forEach(c => { GROUP[c] = 'reg'; });
  [7, 16, 1, 18].forEach(c => { GROUP[c] = 'nit'; });
  [19, 14, 11, 17, 6, 13].forEach(c => { GROUP[c] = 'fish'; });
  [12, 2, 9, 15].forEach(c => { GROUP[c] = 'superfish'; });
  const GROUP_RU = { reg: 'рег', nit: 'нит', fish: 'фиш', superfish: 'суперфиш' };

  function create(model) {
    const mean = model.mean, sd = model.sd, Z = [];
    for (let c = 0; c < 20; c++) Z.push(model.z[String(c)]);
    function classify(rates) {
      const z = rates.map((x, k) => (x - mean[k]) / sd[k]);
      const dists = Z.map(zc => { let s = 0; for (let k = 0; k < z.length; k++) { const d = z[k] - zc[k]; s += d * d; } return s * 100; });
      let a = 0, b = -1;
      for (let c = 1; c < 20; c++) if (dists[c] < dists[a]) a = c;
      for (let c = 0; c < 20; c++) if (c !== a && (b < 0 || dists[c] < dists[b])) b = c;
      return { cl: a, d: dists[a], cl2: b, d2: dists[b], dists };
    }
    return { classify, mean, sd };
  }
  return { create, GROUP, GROUP_RU };
});
