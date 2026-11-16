// П.3 Сверка статов героя по каждой раздаче: наш расчёт против MDA Lab (его parse.js — только чтение, MDA Lab не меняется).
//   HERO_HH=<папка историй героя> MDA_LAB_DIR=<папка mda-lab> BACKING_DIR=<Backing> node tests/compare_mdalab.cjs
// Сверка по каждой раздаче: наш расчёт (lib/stats.js, парсер Backing) против MDA Lab (app/parser/parse.js — только чтение).
const fs=require('fs'),path=require('path');
const C=require('../pipeline/common.cjs'),ST=require('../lib/stats.js'),SP=require('../lib/spots.js');
const P=C.loadParser(),parse=C.makeParse(P);
const MP=require(require('path').join(process.env.MDA_LAB_DIR, 'app/parser/parse.js'));
const HEROES=new Set(['Hero','Kumar1k']);
const files=[];(function w(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(fs.statSync(p).isDirectory())w(p);else if(f.endsWith('.txt'))files.push(p);}})(process.env.HERO_HH);
const cmp={},ex={};let matched=0,onlyUs=0,onlyM=0;
const put=(s,ours,theirs,info)=>{const c=cmp[s]||(cmp[s]={same:0,diff:0,oursHit:0,thHit:0,n:0});
 if(ours===null&&theirs===null)return; c.n++;
 if(ours===theirs){c.same++;} else {c.diff++; (ex[s]=ex[s]||[]).length<4&&ex[s].push(info+' ours='+ours+' mda='+theirs);}};
for(const f of files){const t=fs.readFileSync(f,'utf8');if(!/PokerStars Hand/.test(t.slice(0,400)))continue;
 const M=MP.parseText(t,HEROES);const byId=new Map(M.hands.map(r=>[String(r.id),r]));
 for(const x of C.splitHands(t,f)){let rp;try{rp=parse(x.hand);}catch(e){continue;}if(!rp||!rp.n)continue;
  const hi=rp.nm.findIndex(n=>HEROES.has(n));if(hi<0)continue;const m=byId.get(String(rp.handId));if(!m){onlyUs++;continue;}matched++;
  const fr=P.frames(rp);const r=ST.handStats(rp,fr);const my={};for(const [i,s,h] of r.cl)if(i===hi)my[s]=h;
  const ds=SP.preflopDecisions(rp,()=>'').filter(d=>d.i===hi);const d0=ds[0];
  const id=rp.handId;
  // VPIP / PFR (у MDA — по первому ходу; у нас — по всем ходам префлопа)
  const mHad=m.hpa>0; const mV=mHad?((m.act>=2||(m.act===1&&!(m.pos===6&&m.sit===1)))?1:0):null; const mP=mHad?(m.act>=2?1:0):null;
  put('VPIP',my.VPIP===undefined?null:my.VPIP,mV,id); put('PFR',my.PFR===undefined?null:my.PFR,mP,id);
  // RFI: первый ход в неразыгранном банке, не ББ
  const oR=d0&&d0.tbl==='RFI'&&d0.pos!=='BB'?(/^open|^shove/.test(d0.act)?1:0):null; const mR=(mHad&&m.sit===0&&m.pos!==6)?(m.act>=2?1:0):null; put('RFI',oR,mR,id);
  // 3-бет не олл-ином: перед первым ходом ровно один рейз
  const o3=my['3BetNAI']===undefined?null:my['3BetNAI']; const m3=(mHad&&m.sit===2&&m.rz===1)?(m.act===2?1:0):null; put('3BetNAI(1-й ход)',d0&&d0.nR===1?o3:null,m3,id);
  put('F3Bet',my.F3Bet===undefined?null:my.F3Bet,m.f3b>=0?m.f3b:null,id);
  const oL=my.LimpNSB===undefined?null:my.LimpNSB; const mL=(mHad&&m.sit<=1&&m.pos!==5&&m.pos!==6)?(m.act===1?1:0):null; put('LimpNSB',oL,mL,id);
 }
 onlyM+=0;}
console.log('совпавших раздач (по номеру):',matched,'| есть только у нас:',onlyUs);
for(const [s,c] of Object.entries(cmp))console.log(s.padEnd(18),'возможностей',c.n,'совпало',c.same,'расхождений',c.diff,(c.diff/c.n*100).toFixed(2)+'%');
console.log(JSON.stringify(ex,null,1));
