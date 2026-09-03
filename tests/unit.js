// 完整逻辑单测（含游戏层纯函数，不执行启动代码）
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = js.indexOf("$('btnHist').onclick");
if (cut < 0) { console.log('CUT FAIL'); process.exit(1); }
js = js.slice(0, cut);
eval(js + `
global.T = {isWinShape,isPungShape,isSevenPairs,evaluateShape,shantenStd,shantenPung,shantenColor,
 shantenWindOnly,evalAll,getWaitsHand,toCounts,countsToTiles,calcFlowers,extraFan,claimOptions,
 tryWin,selfKongOptions,canKnock,PLAYCNT,isFlower,tileName,aiChooseDiscard,G,CFG,mkPlayer,buildWall,drawFront,wallLeft,deal,initGame};
`);
const T = global.T;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + x : '')); } };

const m = n => n - 1, p = n => 9 + n - 1, s = n => 18 + n - 1;
const E = 27, S = 28, W = 29, N = 30;
const H = (...ts) => T.toCounts(ts);
const mkMelds = a => a;
function ev(hand, melds) { return T.evaluateShape(T.toCounts(hand), melds || [], { flowerCount: 0 }); }

console.log('== 1. 基本胡型 (need=4) ==');
ok('顺子型胡', T.isWinShape(H(m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),p(1),p(1),p(1),p(2),p(2)), 4));
ok('刻子型胡', T.isWinShape(H(m(1),m(1),m(1),m(5),m(5),m(5),p(3),p(3),p(3),s(7),s(7),s(7),E,E), 4));
ok('少一张不胡', !T.isWinShape(H(m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),p(1),p(1),p(1),p(2)), 4));
ok('风牌不能顺子', !T.isWinShape(H(E,S,W,m(1),m(2),m(3),m(4),m(5),m(6),p(1),p(2),p(3),p(9),p(9)), 4));
ok('七对子(普通)', T.isSevenPairs(H(m(1),m(1),m(3),m(3),m(5),m(5),p(2),p(2),p(4),p(4),s(6),s(6),E,E)));
ok('七对子(4张算两对)', T.isSevenPairs(H(E,E,E,E,S,S,S,S,W,W,W,W,N,N)));
ok('非七对(3张)', !T.isSevenPairs(H(m(1),m(1),m(1),m(3),m(3),p(2),p(2),p(4),p(4),s(6),s(6),E,E,N,N)));

console.log('== 2. 碰碰胡 ==');
ok('碰碰胡型', T.isPungShape(H(m(1),m(1),m(1),m(5),m(5),m(5),p(3),p(3),p(3),s(7),s(7),s(7),E,E), 4));
ok('顺子型非碰碰胡', !T.isPungShape(H(m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),p(1),p(1),p(1),p(2),p(2)), 4));

console.log('== 3. 番型评估 ==');
T.CFG.lajiHu = false;
ok('关垃圾胡：推倒胡不能胡', ev([m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),p(1),p(1),p(1),p(2),p(2)]) === null);
T.CFG.lajiHu = true;
let lv = ev([m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),p(1),p(1),p(1),p(2),p(2)]);
ok('开垃圾胡：推倒胡=垃圾胡(0番)', lv && lv.type === '垃圾胡' && lv.base === 0, JSON.stringify(lv));
let r;
r = ev([m(1),m(1),m(1),m(5),m(5),m(5),p(3),p(3),p(3),s(7),s(7),s(7),E,E]);
ok('碰碰胡1番', r && r.type === '碰碰胡' && r.base === 1, JSON.stringify(r));
r = ev([m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),m(9),m(9),m(2),m(2),m(2)]);
ok('清一色3番', r && r.type === '清一色' && r.base === 3, JSON.stringify(r));
r = ev([m(1),m(1),m(1),m(5),m(5),m(5),m(7),m(7),m(7),m(9),m(9),m(9),m(3),m(3)]);
ok('清碰4番', r && r.type === '清碰' && r.base === 4, JSON.stringify(r));
r = ev([m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),E,E,E,N,N]);
ok('混一色1番', r && r.type === '混一色' && r.base === 1, JSON.stringify(r));
r = ev([m(1),m(1),m(1),m(5),m(5),m(5),m(7),m(7),m(7),E,E,E,N,N]);
ok('混碰2番', r && r.type === '混碰' && r.base === 2, JSON.stringify(r));
r = ev([E,E,E,S,S,S,W,W,W,N,N,N,E,E]);
ok('风碰8番', r && r.type === '风碰' && r.base === 8, JSON.stringify(r));
r = ev([E,E,E,E,S,S,S,S,W,W,W,W,N,N]);
ok('风一色(乱风向)4番', r && r.type === '风一色' && r.base === 4, JSON.stringify(r));
r = ev([m(1),m(1),m(3),m(3),m(5),m(5),p(2),p(2),p(4),p(4),s(6),s(6),E,E]);
ok('普通七小对不能胡', r === null, JSON.stringify(r));
r = ev([m(1),m(1),m(1),m(2),m(2),m(2),m(3),m(3)],
       mkMelds([{type:'pung',tile:m(5),tiles:[m(5),m(5),m(5)]},{type:'pung',tile:m(9),tiles:[m(9),m(9),m(9)]}]));
ok('副露清碰4番', r && r.type === '清碰' && r.base === 4, JSON.stringify(r));
r = ev([m(1),m(1),m(1),m(2),m(2),m(2),m(3),m(3)],
       mkMelds([{type:'chow',tile:m(5),tiles:[m(4),m(5),m(6)]},{type:'pung',tile:m(9),tiles:[m(9),m(9),m(9)]}]));
ok('有吃牌不算碰碰胡', r && r.type === '清一色' && r.base === 3, JSON.stringify(r));
r = ev([m(1),m(1),m(1),m(2),m(2),m(2),m(3),m(3)],
       mkMelds([{type:'kong',tile:m(5),tiles:[m(5),m(5),m(5),m(5)]},{type:'pung',tile:m(9),tiles:[m(9),m(9),m(9)]}]));
ok('暗杠仍算碰碰胡', r && r.type === '清碰' && r.base === 4, JSON.stringify(r));

console.log('== 4. 向听数 ==');
const sh = (hand, melds) => T.shantenStd(T.toCounts(hand), melds || 0);
ok('听牌形=0', sh([m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),p(1),p(1),p(1),p(2)]) === 0);
ok('胡牌形=-1', sh([m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),p(1),p(1),p(1),p(2),p(2)]) === -1);
ok('含副露听牌=0', sh([m(1),m(2),m(3),p(1),p(1),p(1),p(2)], 2) === 0);
ok('4面子+孤张=0', sh([m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),p(1),p(2),p(3),s(9)]) === 0);
ok('3面子+2搭子=1', sh([m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),p(1),p(2),p(4),p(5)]) === 1);
ok('5对子=3', sh([m(1),m(1),m(3),m(3),m(5),m(5),p(2),p(2),p(4),p(4)]) === 3);
ok('孤张>=4', sh([m(1),m(3),m(5),m(7),m(9),p(1),p(3),p(5),p(7),p(9),s(1),s(3),s(5)]) >= 4);
ok('碰碰胡向听(4刻+单钓=0)', T.shantenPung(T.toCounts([m(1),m(1),m(1),m(5),m(5),m(5),p(3),p(3),p(3),s(7),s(7),s(7),E]), 3) === 0);
ok('碰碰胡向听(5对子=3)', T.shantenPung(T.toCounts([m(1),m(1),m(3),m(3),m(5),m(5),p(2),p(2),p(4),p(4)]), 0) === 3);

console.log('== 5. 花数 / 附加番 ==');
const fp = (f, ml) => ({ flowers: f, melds: ml });
ok('3张花=3', T.calcFlowers(fp([100,101,108], []), null) === 3);
ok('数牌暗杠+2', T.calcFlowers(fp([], [{type:'kong',tile:m(5),concealed:true}]), null) === 2);
ok('数牌明杠+1', T.calcFlowers(fp([], [{type:'kong',tile:m(5),concealed:false}]), null) === 1);
ok('风明杠+2', T.calcFlowers(fp([], [{type:'kong',tile:E,concealed:false}]), null) === 2);
ok('风暗杠+3', T.calcFlowers(fp([], [{type:'kong',tile:E,concealed:true}]), null) === 3);
ok('风碰+1', T.calcFlowers(fp([], [{type:'pung',tile:E,concealed:false}]), null) === 1);
ok('手牌风暗刻+1', T.calcFlowers(fp([], []), T.toCounts([E,E,E,m(1)])) === 1);
ok('门清+无花+杠开=3', T.extraFan({menqing:true,flowers:[]}, {kongDraw:true}).reduce((a,b)=>a+b[1],0) === 3);
ok('非门清有花=0', T.extraFan({menqing:false,flowers:[100]}, {}).length === 0);

console.log('== 6. 听牌判定 getWaitsHand ==');
let w;
T.CFG.lajiHu = false;
w = T.getWaitsHand([m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),p(1),p(1),p(1),p(2)], []);
ok('关垃圾胡：推倒胡不算听牌', w.length === 0, JSON.stringify(w.map(x=>T.tileName(x.t))));
T.CFG.lajiHu = true;
w = T.getWaitsHand([m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),p(1),p(1),p(1),p(2)], []);
ok('开垃圾胡：推倒胡算听牌', w.length > 0, JSON.stringify(w.map(x=>T.tileName(x.t))));
w = T.getWaitsHand([m(1),m(1),m(1),m(5),m(5),m(5),p(3),p(3),p(3),s(7),s(7),s(7),E], []);
ok('碰碰胡听 E', w.length === 1 && w[0].t === E, JSON.stringify(w.map(x=>T.tileName(x.t))));
w = T.getWaitsHand([m(1),m(2),m(3),m(4),m(5),m(6),m(7),m(8),m(9),p(1),p(1),p(1),p(2),p(2)], []);
ok('14张不返回听牌', w.length === 0);

console.log('== 7. 交叉验证：shanten=0 ⟺ 有听牌 ==');
function randHand(n) {
  const pool = [];
  for (let t = 0; t < 31; t++) for (let k = 0; k < 4; k++) pool.push(t);
  for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random()*(i+1))|0; [pool[i],pool[j]]=[pool[j],pool[i]]; }
  return pool.slice(0, n).sort((a,b)=>a-b);
}
let bad = 0, samples = 0;
for (let k = 0; k < 3000; k++) {
  const h = randHand(13);
  const c = T.toCounts(h);
  const s0 = T.shantenStd(c, 0);
  const waits = T.getWaitsHand(h, []);
  samples++;
  // 方向：能按敲麻牌型胡 => 标准向听必须为 0 或 -1
  if (waits.length > 0 && s0 > 0) {
    bad++;
    if (bad <= 3) console.log('   不一致: 判定可听但 shanten=' + s0 + ' hand=' + h.map(T.tileName).join(''));
  }
}
ok('可听牌 ⟹ 标准向听=0 (' + samples + ' 手随机牌, 不一致 ' + bad + ')', bad === 0);

console.log('== 8. 交叉验证：evalAll.best<=0 时确实存在合法胡牌牌型 ==');
let bad2 = 0, cnt8 = 0;
for (let k = 0; k < 4000; k++) {
  const h = randHand(13);
  const e = T.evalAll(T.toCounts(h), 0);
  if (e.best > 0) continue;
  cnt8++;
  // 真实可胡性：加入某张牌后能构成敲麻牌型
  let real = false;
  for (let t = 0; t < 31; t++) {
    const c = T.toCounts(h);
    if (c[t] >= 4) continue;
    c[t]++;
    const r2 = T.evaluateShape(c, [], { flowerCount: 0 });
    if (r2) { real = true; break; }
  }
  if (!real) { bad2++; if (bad2 <= 3) console.log('   误报听牌: ' + h.map(T.tileName).join('') + ' best=' + e.best + ' ' + e.bestType); }
}
ok('evalAll 不误报 (' + cnt8 + ' 手判定听牌, 误报 ' + bad2 + ')', bad2 === 0);

console.log('== 9. claimOptions ==');
const P = (o) => Object.assign(T.mkPlayer(o.idx || 0, 'x', true), o);
let pl = P({ hand: [m(5),m(5),m(6),m(7)], melds: [], knocked: false, menqing: true, missHu: new Set() });
let co = T.claimOptions(pl, m(5), 3, true);
ok('可碰', co.some(o => o.k === 'pung'), JSON.stringify(co.map(o=>o.k)));
co = T.claimOptions(pl, m(8), 3, true);
ok('可吃 67+8', co.some(o => o.k === 'chow' && o.combo[0] === m(6)), JSON.stringify(co.filter(o=>o.k==='chow').map(o=>o.combo)));
co = T.claimOptions(pl, m(8), 2, false);
ok('非下家不能吃', !co.some(o => o.k === 'chow'));
pl = P({ hand: [m(5),m(5),m(5),m(6)], melds: [], knocked: false, menqing: true, missHu: new Set() });
co = T.claimOptions(pl, m(5), 3, true);
ok('三张可杠', co.some(o => o.k === 'kong'));
pl = P({ hand: [m(1),m(1),m(1),m(2),m(2),m(2),m(3),m(3),m(3),m(4),m(4),m(4),m(5)], melds: [], knocked: true, menqing: true, missHu: new Set() });
co = T.claimOptions(pl, m(5), 3, true);
ok('敲后清碰听牌可胡', co.some(o => o.k === 'hu' && o.ev.type === '清碰'), JSON.stringify(co.map(o=>o.k)));
co = T.claimOptions(pl, s(9), 3, true);
ok('敲后非听牌不胡', !co.some(o => o.k === 'hu'));
pl2 = P({ hand: [m(1),m(1),m(1),m(2),m(2),m(2),m(3),m(3),m(3),m(4),m(4),m(4),m(5)], melds: [], knocked: false, menqing: true, missHu: new Set() });
co = T.claimOptions(pl2, m(5), 3, true);
ok('未敲不能胡', !co.some(o => o.k === 'hu'), JSON.stringify(co.map(o=>o.k)));

console.log('== 10. 牌墙与发牌 ==');
const wall = T.buildWall();
ok('牌墙144张', wall.length === 144, wall.length);
const cnt = {};
for (const t of wall) cnt[t] = (cnt[t] || 0) + 1;
ok('每种组牌牌4张', (() => { for (let t = 0; t <= 30; t++) if (cnt[t] !== 4) return false; return true; })());
ok('季花8张', (() => { let n = 0; for (let f = 100; f <= 107; f++) n += cnt[f] || 0; return n === 8; })());
ok('中发白12张', (() => { let n = 0; for (let f = 108; f <= 119; f++) n += cnt[f] || 0; return n === 12; })());
T.initGame();
T.G.wall = T.buildWall(); T.G.wpos = 0; T.G.wtail = T.G.wall.length - 1; T.G.dealer = 0;
T.deal();
const totals = T.G.players.map(pl2 => pl2.hand.length);
const totalsWithPending = T.G.players.map(pl2 => pl2.hand.length + pl2.pendingFlowers.length);
ok('发牌 14/13/13/13（含起手暂存花）', JSON.stringify(totalsWithPending) === JSON.stringify([14,13,13,13]), JSON.stringify(totalsWithPending));
ok('发牌后手牌无花', T.G.players.every(pl2 => pl2.hand.every(t => !T.isFlower(t))));
ok('牌墙不越界', T.G.wpos <= T.G.wtail + 1);
let allT = [];
for (const pl2 of T.G.players) allT = allT.concat(pl2.hand, pl2.flowers, pl2.pendingFlowers);
const flCount = T.G.players.reduce((a,pl2)=>a+pl2.flowers.length,0);
ok('持牌总数=53+花数', allT.length === 53 + flCount, allT.length + ' vs ' + (53+flCount));
const used = {};
for (const t of allT) used[t] = (used[t]||0)+1;
for (let i = T.G.wpos; i <= T.G.wtail; i++) { const t = T.G.wall[i]; used[t] = (used[t]||0)+1; }
let over = 0;
for (let t = 0; t <= 30; t++) if ((used[t]||0) !== 4) over++;
for (let f = 100; f <= 107; f++) if ((used[f]||0) !== 1) over++;
for (let f = 108; f <= 119; f++) if ((used[f]||0) !== 1) over++;
ok('每种牌张数守恒(含牌墙剩余)', over === 0, '不守恒种类=' + over);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
