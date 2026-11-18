'use strict';
// Переводчики историй новых румов в формат PokerStars (его читает парсер Backing, сам парсер не меняем).
//  • WPN (текст «Game Hand #… - Tournament #… - Holdem(No Limit) - Level 3 (450.00/900.00)- дата UTC»)
//  • iPoker / RedStar (XML: <general> сессии, <game gamecode> с <players> и <round>)
// Заголовок раздачи получает префикс рума («WPN Hand #», «iPoker Hand #»), по нему roomOf отличает румы.
// Раздачи, которые не удалось перевести (не холдем, кэш, нет кнопки), пропускаются — функции возвращают null.

const num = (x) => { const v = parseFloat(String(x == null ? '' : x).replace(/,/g, '')); return isFinite(v) ? v : 0; };
const fmt = (v) => { const r = Math.round(v * 100) / 100; return String(r); };

// ---------------- WPN ----------------
// fp — путь файла внутри архива: «2607-WPN-HL-954Mb/$109/$109__Freezeout/WPN-HL-109 (10).txt» — бай-ин и формат
// турнира есть только там (в заголовке раздачи WPN их нет), переносим в название турнира.
function wpnToPS(t, fp) {
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const h = /^Game Hand #(\d+) - Tournament #(\d+) - Holdem\(No Limit\) - Level (\d+) \(([\d.,]+)\/([\d.,]+)\)\s*- (.+)$/.exec(lines[0]);
  if (!h) return null;
  const tb = /^Table '(.*)' (\d+)-max Seat #(\d+) is the button$/.exec(lines[1] || '');
  if (!tb) return null;
  const out = [];
  const bm = /[$€£]\s?([\d.]+)/.exec(fp || ''), km = /(Knockout|Freezeout|Mystery|Bounty|PKO|Turbo|Hyper)/i.exec(fp || '');
  out.push(`WPN Hand #${h[1]}: Tournament #${h[2]}, ${bm ? '$' + bm[1] + ' ' : ''}WPN${km ? ' ' + km[1] : ''} Hold'em No Limit - Level ${h[3]} (${fmt(num(h[4]))}/${fmt(num(h[5]))}) - ${h[6].replace(/\s*UTC$/, ' UTC')}`);
  out.push(`Table '${h[2]} ${tb[1]}' ${tb[2]}-max Seat #${tb[3]} is the button`);
  const nicks = [];
  let i = 2;
  for (; i < lines.length; i++) {
    const m = /^Seat (\d+): (.+?) \(([\d.,]+)\)\s*$/.exec(lines[i]);
    if (!m) break;
    nicks.push(m[2]);
    out.push(`Seat ${m[1]}: ${m[2]} (${fmt(num(m[3]))} in chips)`);
  }
  if (!nicks.length) return null;
  const byLen = nicks.slice().sort((a, b) => b.length - a.length);
  const who = (l) => { for (const n of byLen) if (l.startsWith(n + ' ') || l.startsWith(n + ':')) return n; return null; };
  let pot = 0, inSum = false; const wins = [];
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^\*\*\* SUMMARY \*\*\*/.test(l)) { inSum = true; continue; }
    if (inSum) {
      const m = /^Total pot ([\d.,]+)/.exec(l);
      if (m) { pot = num(m[1]); continue; }
      const w = /^Seat \d+: .*?\b(?:won|collected) \(?([\d.,]+)/.exec(l), n = w && who(l.replace(/^Seat \d+: /, ''));
      if (w && n) wins.push(`${n} collected ${fmt(num(w[1]))} from pot`);
      continue;
    }
    if (/^\*\*\* /.test(l)) { out.push(l); continue; }
    if (/^(Main pot|Side pot)/.test(l)) continue;
    let m;
    if ((m = /^Uncalled bet \(([\d.,]+)\) returned to (.+)$/.exec(l))) { out.push(`Uncalled bet (${fmt(num(m[1]))}) returned to ${m[2]}`); continue; }
    const n = who(l); if (!n) continue;
    const r = l.slice(n.length).replace(/^:?\s*/, '');
    const ai = /and is all-in\s*$/.test(r) ? ' and is all-in' : '';
    if ((m = /^posts ante ([\d.,]+)/.exec(r))) out.push(`${n}: posts the ante ${fmt(num(m[1]))}`);
    else if ((m = /^posts the (small|big) blind ([\d.,]+)/.exec(r))) out.push(`${n}: posts ${m[1]} blind ${fmt(num(m[2]))}`);
    else if (/^folds/.test(r)) out.push(`${n}: folds`);
    else if (/^checks/.test(r)) out.push(`${n}: checks`);
    else if ((m = /^calls ([\d.,]+)/.exec(r))) out.push(`${n}: calls ${fmt(num(m[1]))}${ai}`);
    else if ((m = /^bets ([\d.,]+)/.exec(r))) out.push(`${n}: bets ${fmt(num(m[1]))}${ai}`);
    else if ((m = /^raises ([\d.,]+) to ([\d.,]+)/.exec(r))) out.push(`${n}: raises ${fmt(num(m[1]))} to ${fmt(num(m[2]))}${ai}`);
    else if ((m = /^shows \[(.+?)\]/.exec(r))) out.push(`${n}: shows [${m[1]}]`);
  }
  if (!inSum || !wins.length) return null;
  const won = wins.reduce((a, x) => a + num(/collected ([\d.]+)/.exec(x)[1]), 0);
  return out.concat(wins, ['*** SUMMARY ***', `Total pot ${fmt(pot)} | Rake ${fmt(Math.max(0, pot - won))}`]).join('\n');
}

// ---------------- iPoker XML ----------------
const SUIT = { S: 's', H: 'h', D: 'd', C: 'c' };
function card(c) { const m = /^([SHDC])(10|[2-9TJQKA])$/i.exec(c.trim()); if (!m) return null; return (m[2] === '10' ? 'T' : m[2].toUpperCase()) + SUIT[m[1].toUpperCase()]; }
function cards(s) { const a = String(s).trim().split(/\s+/).map(card); return a.every(Boolean) ? a : null; }
const tag = (s, name) => { const m = new RegExp('<' + name + '>([^<]*)</' + name + '>').exec(s); return m ? m[1].trim() : ''; };
const attrs = (s) => { const o = {}; s.replace(/(\w+)="([^"]*)"/g, (_, k, v) => { o[k] = v; return ''; }); return o; };
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// sess — данные <general> сессии: {code, name, buyin, size, hero}
function ipokerGameToPS(g, sess) {
  const code = (/gamecode="(\d+)"/.exec(g) || [])[1]; if (!code || !sess.code) return null;
  const gen = (/<general>([\s\S]*?)<\/general>/.exec(g) || [])[1] || '';
  let sb = num(tag(gen, 'smallblind')), bb = num(tag(gen, 'bigblind'));
  // в выгрузках hm3-pt4 блайндов в <general> нет — берём из постов малого/большого блайнда
  if (!bb) { const b = /<action\b[^>]*\btype="2"[^>]*>/.exec(g), s1 = /<action\b[^>]*\btype="1"[^>]*>/.exec(g); bb = b ? num(attrs(b[0]).sum) : 0; sb = s1 ? num(attrs(s1[0]).sum) : bb / 2; }
  if (!bb) return null;
  let date = tag(gen, 'startdate'); const dm = /^(\d\d)-(\d\d)-(\d{4})(.*)$/.exec(date);
  date = dm ? dm[3] + '/' + dm[2] + '/' + dm[1] + dm[4] : date.replace(/-/g, '/');
  const pl = [];
  gen.replace(/<player\b([^>]*)\/?>/g, (_, a) => { const o = attrs(a); pl.push({ seat: +o.seat, name: unesc(o.name), chips: num(o.chips), dealer: o.dealer === '1', win: num(o.win), bet: num(o.bet) }); return ''; });
  if (pl.length < 2) return null;
  const btn = pl.find(p => p.dealer); if (!btn) return null;
  const maxSeat = Math.max(...pl.map(p => p.seat));
  const size = Math.max(sess.size || 0, pl.length, maxSeat <= 10 ? 0 : maxSeat);
  const out = [];
  out.push(`iPoker Hand #${code}: Tournament #${sess.code}, ${sess.buyin} ${sess.name} Hold'em No Limit - Level 1 (${fmt(sb)}/${fmt(bb)}) - ${date}`);
  out.push(`Table '${sess.code} 1' ${size}-max Seat #${btn.seat} is the button`);
  pl.slice().sort((a, b) => a.seat - b.seat).forEach(p => out.push(`Seat ${p.seat}: ${p.name} (${fmt(p.chips)} in chips)`));
  const pocket = {}, board = {};
  const rounds = [];
  g.replace(/<round no="(\d+)">([\s\S]*?)<\/round>/g, (_, no, body) => { rounds.push({ no: +no, body }); return ''; });
  rounds.sort((a, b) => a.no - b.no);
  for (const r of rounds) {
    r.body.replace(/<cards\b([^>]*)>([^<]*)<\/cards>/g, (_, a, c) => {
      const o = attrs(a);
      if (o.type === 'Pocket') { const cc = cards(c); if (cc && o.player) pocket[unesc(o.player)] = cc; }
      else if (/Flop|Turn|River/.test(o.type)) { const cc = cards(c); if (cc) board[o.type] = cc; }
      return '';
    });
  }
  const inv = {}; pl.forEach(p => { inv[p.name] = 0; });
  let cur = {}, maxBet = 0, lastAggr = null, streetIdx = 0;
  const flush = () => { cur = {}; maxBet = 0; };
  const names = ['', 'FLOP', 'TURN', 'RIVER'];
  let heroDealt = false, allBoard = [];
  for (const r of rounds) {
    if (r.no >= 2 && r.no <= 4) {
      // улица: проверка неуравненной ставки предыдущей улицы — у iPoker её нет отдельной строкой, считаем в конце
      flush(); streetIdx = r.no - 1;
      const bc = r.no === 2 ? board.Flop : r.no === 3 ? board.Turn : board.River;
      if (!bc) return null;
      if (r.no === 2) { out.push(`*** FLOP *** [${bc.join(' ')}]`); allBoard = bc.slice(); }
      else { out.push(`*** ${names[streetIdx]} *** [${allBoard.join(' ')}] [${bc.join(' ')}]`); allBoard = allBoard.concat(bc); }
    }
    if (r.no === 1) {
      out.push('*** HOLE CARDS ***');
      if (sess.hero && pocket[sess.hero]) { out.push(`Dealt to ${sess.hero} [${pocket[sess.hero].join(' ')}]`); heroDealt = true; }
    }
    const acts = [];
    r.body.replace(/<action\b([^>]*)\/?>/g, (_, a) => { const o = attrs(a); acts.push({ no: +o.no, p: unesc(o.player), sum: num(o.sum), type: +o.type }); return ''; });
    acts.sort((a, b) => a.no - b.no);
    for (const a of acts) {
      if (inv[a.p] === undefined) return null;
      const c0 = cur[a.p] || 0;
      if (a.type === 15) { out.push(`${a.p}: posts the ante ${fmt(a.sum)}`); inv[a.p] += a.sum; continue; }
      if (a.type === 1 || a.type === 2) {
        out.push(`${a.p}: posts ${a.type === 1 ? 'small' : 'big'} blind ${fmt(a.sum)}`);
        cur[a.p] = c0 + a.sum; inv[a.p] += a.sum; maxBet = Math.max(maxBet, cur[a.p]); continue;
      }
      if (a.type === 0) { out.push(`${a.p}: folds`); continue; }
      if (a.type === 4) { out.push(`${a.p}: checks`); continue; }
      if (a.type === 3 || a.type === 5 || a.type === 23 || a.type === 7) {
        const tot = c0 + a.sum, ai = a.type === 7 ? ' and is all-in' : '';
        cur[a.p] = tot; inv[a.p] += a.sum;
        if (a.type === 3 || (a.type === 7 && tot <= maxBet)) out.push(`${a.p}: calls ${fmt(a.sum)}${ai}`);
        else if (maxBet === 0) { out.push(`${a.p}: bets ${fmt(a.sum)}${ai}`); maxBet = tot; lastAggr = a.p; }
        else if (a.type === 5 && r.no >= 2 && maxBet === 0) { out.push(`${a.p}: bets ${fmt(a.sum)}${ai}`); maxBet = tot; }
        else { out.push(`${a.p}: raises ${fmt(tot - maxBet)} to ${fmt(tot)}${ai}`); maxBet = tot; lastAggr = a.p; }
        continue;
      }
      // прочие коды (сидит без игры, время и т.п.) пропускаем
    }
  }
  // неуравненная часть: вложено больше всех и выше второго по вложению
  const order = Object.keys(inv).sort((a, b) => inv[b] - inv[a]);
  if (order.length >= 2 && inv[order[0]] > inv[order[1]] + 1e-9) {
    const d = inv[order[0]] - inv[order[1]];
    out.push(`Uncalled bet (${fmt(d)}) returned to ${order[0]}`); inv[order[0]] -= d;
  }
  // вскрытия: карты известны у игроков, кроме сброшенных раньше; показываем у тех, кто дошёл до конца
  const folded = new Set(); g.replace(/<action\b([^>]*)\/?>/g, (_, a) => { const o = attrs(a); if (o.type === '0') folded.add(unesc(o.player)); return ''; });
  const live = pl.filter(p => !folded.has(p.name));
  if (live.length >= 2) {
    out.push('*** SHOW DOWN ***');
    for (const p of live) if (pocket[p.name] && !(heroDealt && p.name === sess.hero && false)) out.push(`${p.name}: shows [${pocket[p.name].join(' ')}]`);
  }
  let pot = 0; Object.values(inv).forEach(v => { pot += v; });
  for (const p of pl) if (p.win > 0) out.push(`${p.name} collected ${fmt(p.win)} from pot`);
  out.push('*** SUMMARY ***');
  const won = pl.reduce((s, p) => s + p.win, 0);
  out.push(`Total pot ${fmt(pot)} | Rake ${fmt(Math.max(0, pot - won))}`);
  return out.join('\n');
}

// Разбор XML-текста: сессии (<general> верхнего уровня) и игры. Возвращает массив PS-текстов.
// st — объект состояния между кусками одного файла (сессия из <general> остаётся для следующих игр)
function ipokerXmlToPS(xml, onHand, st) {
  st = st || {}; let sess = st.sess || { code: '', name: '', buyin: '', size: 0, hero: '' };
  const re = /<general>(?:(?!<\/general>)[\s\S])*?<tournamentcode>[\s\S]*?<\/general>|<game\b[\s\S]*?<\/game>/g;
  let m, k = 0;
  while ((m = re.exec(xml))) {
    const s = m[0];
    if (s.startsWith('<general>') && s.indexOf('<players>') < 0) {
      const gt = tag(s, 'gametype');
      sess = st.sess = { code: tag(s, 'tournamentcode'), name: unesc(tag(s, 'tournamentname')).replace(/[\r\n]+/g, ' '), buyin: unesc(tag(s, 'buyin')).replace(/\s+/g, ''), size: num(tag(s, 'tablesize')), hero: unesc(tag(s, 'nickname')), ok: /holdem/i.test(gt) && /NL|no ?limit/i.test(gt) };
      continue;
    }
    if (!sess.ok) continue;
    const t = ipokerGameToPS(s, sess);
    if (t) { k++; onHand(t); }
  }
  return k;
}

module.exports = { wpnToPS, ipokerXmlToPS, ipokerGameToPS };
