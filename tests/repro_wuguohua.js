// repro_wuguohua.js：无花果「刻子算花」回归（v1.2.52）
// 规则：花牌、字牌（风/中/發/白）明碰/暗刻、明杠/暗杠都算花 → 破无花果 → 点炮可胡；
//       清混碰下中发白刻子同样算花（用户 2026-09-15 确认）。无花果仍只能自摸。
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = js.indexOf("$('btnHist').onclick");
if (cut < 0) { console.log('CUT FAIL'); process.exit(1); }
js = js.slice(0, cut);

eval(js + `
;NET.active = false;
render = function(){}; renderActs = function(){}; renderHand = function(){}; renderSeats = function(){};
renderRiver = function(){}; renderFx = function(){}; renderTop = function(){}; renderTurnClock = function(){};
renderRoom = function(){}; renderHUD = function(){}; logMsg = function(){}; toast = function(){};
seatToast = function(){}; openSheet = function(){}; closeSheet = function(){};
global.__ = { CFG, mkPlayer, claimOptions, calcFlowers, wuGuoHuaAt, isWuGuoHua, tryWin, toCounts };
`);
const T = global.__;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ❌ FAIL: ' + n + ' -> ' + JSON.stringify(x)); } };

T.CFG.lajiHu = false;          // 清混碰（截图玩法）
T.CFG.allowChow = true;

const EAST = 27, SOUTH = 28, ZHONG = 31, FA = 32, BAI = 33;
const T2 = 9 + 1, T3 = 9 + 2;  // 二筒 / 三筒

function mk(hand, melds, flowers){
  const p = T.mkPlayer(0, '我', false);
  p.hand = hand.slice();
  p.melds = melds || [];
  p.flowers = flowers || [];
  p.knocked = false;           // 截图状态：未敲（有「碰」按钮）
  p.missHu = new Set();
  p.tianDi = false;
  return p;
}
const pung = (t, from) => ({ type: 'pung', tile: t, tiles: [t, t, t], from: from === undefined ? 1 : from });
const hasHu = (p, tile, from, isNext) => T.claimOptions(p, tile, from, isNext).some(o => o.k === 'hu');

console.log('== A) 风刻·副露明碰（東東東已碰）→ 点炮三筒可胡 ==');
{
  const p = mk([BAI,BAI,BAI, ZHONG,ZHONG,ZHONG, T3,T3, T2,T2], [pung(EAST)]);
  ok('A claimOptions 含 hu', hasHu(p, T3, 3, true), T.claimOptions(p, T3, 3, true).map(o=>o.k));
  ok('A 花数=1（风明碰）', T.calcFlowers(p, null) === 1, T.calcFlowers(p, null));
}
console.log('== B) 风刻·手牌暗刻（東東東在手）→ 点炮三筒可胡 ==');
{
  const p = mk([EAST,EAST,EAST, BAI,BAI,BAI, ZHONG,ZHONG,ZHONG, T3,T3, T2,T2], []);
  ok('B claimOptions 含 hu', hasHu(p, T3, 3, true), T.claimOptions(p, T3, 3, true).map(o=>o.k));
}
console.log('== C) 字刻·副露明碰（發發發已碰，用户截图场景）→ 点炮三筒可胡 ==');
{
  const p = mk([BAI,BAI,BAI, ZHONG,ZHONG,ZHONG, T3,T3, T2,T2], [pung(FA)]);
  ok('C claimOptions 含 hu（v1.2.52 字刻算花）', hasHu(p, T3, 3, true), T.claimOptions(p, T3, 3, true).map(o=>o.k));
  ok('C wuGuoHuaAt=false', T.wuGuoHuaAt(p, T3) === false, T.wuGuoHuaAt(p, T3));
  ok('C 结算口径 isWuGuoHua=false（含手牌暗刻）', T.isWuGuoHua({ ...p, hand: p.hand.concat([T3]) }) === false);
}
console.log('== D) 字刻·手牌暗刻（中中中在手）→ 点炮三筒可胡 ==');
{
  const p = mk([ZHONG,ZHONG,ZHONG, BAI,BAI,BAI, FA,FA,FA, T3,T3, T2,T2], []);
  ok('D claimOptions 含 hu', hasHu(p, T3, 3, true), T.claimOptions(p, T3, 3, true).map(o=>o.k));
  ok('D 结算口径 isWuGuoHua=false', T.isWuGuoHua({ ...p, hand: p.hand.concat([T3]) }) === false);
}
console.log('== E) 风刻·明杠（東東東東杠）→ 点炮可胡 ==');
{
  const p = mk([BAI,BAI,BAI, ZHONG,ZHONG,ZHONG, T3,T3, T2,T2], [{ type:'kong', tile:EAST, tiles:[EAST,EAST,EAST,EAST], concealed:false, from:1 }]);
  ok('E claimOptions 含 hu', hasHu(p, T3, 3, true), T.claimOptions(p, T3, 3, true).map(o=>o.k));
}
console.log('== F) 敲麻：风暗刻在 手 → 点炮可胡（回归）==');
{
  T.CFG.lajiHu = true;
  const p = mk([EAST,EAST,EAST, BAI,BAI,BAI, ZHONG,ZHONG,ZHONG, T3,T3, T2,T2], []);
  p.knocked = true;
  ok('F claimOptions 含 hu', hasHu(p, T3, 3, true), T.claimOptions(p, T3, 3, true).map(o=>o.k));
  T.CFG.lajiHu = false;
}
console.log('== G) 对照：真·无花（纯数牌、无副露无字刻）→ 无花果成立，点炮不给胡 ==');
{
  // 听三筒的纯数牌手：二三筒+五六筒… 构造 4面子+将不可能（无副露 13 张）
  // 用最小对照：门清纯数牌听牌形 3n+1=10 张（模拟 3 副露数牌顺子已在 melds 之外不可能，这里直接验证 wuGuoHuaAt）
  const p = mk([T2,T2, T3,T3, 0,1,2, 9,10,11, 18,19,20], []);   // 二二+三三+三组顺子
  ok('G wuGuoHuaAt(三筒)=true（0 花）', T.wuGuoHuaAt(p, T3) === true, T.calcFlowers(p, T.toCounts(p.hand)));
  ok('G claimOptions 不含 hu（无花果只能自摸）', !hasHu(p, T3, 3, true), T.claimOptions(p, T3, 3, true).map(o=>o.k));
}
console.log('\n结果: pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
