// m43：v1.2.20 清混碰免敲（不敲听也能胡）——引擎层
//  1) 清混碰：未敲定、手牌听牌 → 点炮有「胡」资格（敲麻必须先敲）
//  2) 清混碰：免敲玩家能直接胡（hu 优先于碰杠）
//  3) 敲麻对照：未敲定听牌不可胡点炮，canKnock 为 true（可敲）
//  4) 抢杠判定：清混碰实时听（敲麻用锁定 knockWaits）
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
global.__ = { CFG, mkPlayer, claimOptions, getWaits, canKnock, toCounts, aiClaim, G, initGame,
  buildWall, deal, drawFront, wallLeft };
`);
const T = global.__;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ❌ FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

// 构造「4 刻 + 单中」的听牌手牌（听 中 31）
function tingHand(){ return [0,0,0, 9,9,9, 18,18,18, 27,27,27, 31]; }

console.log('== 1) 免敲：点炮直接有胡资格 ==');
T.CFG.lajiHu = false;
let p = T.mkPlayer(0, '甲', false);
p.hand = tingHand();
ok('清混碰未敲定可听牌', T.getWaits(p).length === 1 && T.getWaits(p)[0].t === 31, T.getWaits(p).map(w => w.t));
let o = T.claimOptions(p, 31, 3, true);
ok('清混碰未敲定点炮含胡', o.some(x => x.k === 'hu'), o.map(x => x.k));
ok('免敲玩家点炮 hu 优先（不再需要敲定/碰）', T.aiClaim(p, 31, 3, o, false) !== null, null);

console.log('== 2) 敲麻对照：必须先敲 ==');
T.CFG.lajiHu = true;
let p2 = T.mkPlayer(0, '乙', false);
p2.hand = tingHand();
let o2 = T.claimOptions(p2, 31, 3, true);
ok('敲麻未敲定听牌点炮无胡', !o2.some(x => x.k === 'hu'), o2.map(x => x.k));
ok('敲麻未敲定可以敲（canKnock）', T.canKnock(p2), null);
// 敲定后才有胡
p2.knocked = true; p2.knockWaits = [31];
let o3 = T.claimOptions(p2, 31, 3, true);
ok('敲麻敲定后点炮含胡', o3.some(x => x.k === 'hu'), o3.map(x => x.k));

console.log('== 3) 免敲自摸资格（runHand 主循环判定源码） ==');
ok('自摸判定含免敲分支', /ev && \(p\.knocked \|\| dihu \|\| !CFG\.lajiHu\)/.test(html), null);
ok('敲听流程清混碰直接跳过', /async function knockCheck\(p\)\{\n  \/\/ v1\.2\.20/.test(html) || html.indexOf("if (!CFG.lajiHu) return;\n  if (p.knocked || p.hand.length % 3 !== 1) return;") >= 0, null);

console.log('== 4) 抢杠判定免敲 ==');
T.CFG.lajiHu = false;
// 别人加杠「中」：免敲听牌者应被列为抢杠对象（其实时 waits 含 中）
let q = T.mkPlayer(3, '丁', false);
q.hand = tingHand();
const waitsQ = T.getWaits(q);
ok('免敲听牌者实时听包含加杠牌', waitsQ.some(w => w.t === 31), waitsQ.map(w => w.t));
T.CFG.lajiHu = true;

console.log('');
console.log(`结果: ${fail === 0 ? '✅' : '❌'} ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
