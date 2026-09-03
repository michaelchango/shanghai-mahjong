// m19：起手补花延迟到首次出牌（上海敲麻规则）
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = js.indexOf("$('btnHist').onclick");
if (cut < 0) { console.log('CUT FAIL'); process.exit(1); }
js = js.slice(0, cut);

const harness = `
;NET.active = false;
var __cap = { finishRes: null, bahua: false };
render = function(){}; renderActs = function(){}; renderHand = function(){};
renderSeats = function(){}; renderRiver = function(){}; renderFx = function(){};
renderTop = function(){}; renderHUD = function(){}; logMsg = function(){};
toast = function(){}; seatToast = function(){}; openSheet = function(){}; closeSheet = function(){};
// 沿用引擎真实 waitBot/sleep（引擎里是 const，不可重赋）
var __realFinish = finish;
finish = async function(res){ __cap.finishRes = res; if (res && res.type === 'bahua') __cap.bahua = true; };
// 固定牌尾补牌来源，消除随机性：默认每次补花都补一张合法非花牌 5
// v1.2.10：支持 __tailScript 序列（逐个弹出），用于模拟「补上来的牌又是花」
var __tailCount = 0;
var __tailScript = null;
drawTail = function(){ __tailCount++; if (__tailScript && __tailScript.length) return __tailScript.shift(); return 5; };

// 场景一：真实发牌后，起手花不立即补（留在 pendingFlowers），flowers 全空、手牌不含花
global.__dealState = function(){
  __tailCount = 0;
  initGame();
  G.dealer = 0;
  deal();
  return G.players.map(function(p, i){
    return { seat: i, handLen: p.hand.length, hasFlower: p.hand.some(isFlower), flowers: p.flowers.length, pending: p.pendingFlowers.length };
  });
};

// 场景二/三：补花执行
global.__supply = async function(scenario){
  __tailCount = 0;
  __tailScript = null;
  __cap.bahua = false;   // v1.2.10：每个场景重置，避免上一场景的八花齐标记残留
  initGame();
  G.dealer = 0;
  buildWall(); G.wpos = 0; G.wtail = G.wall.length - 1;
  var p = G.players[0];
  G.abort = false;
  if (scenario === 'normal'){
    p.hand = [0,1,2,3,4,5,6,7,8,9,10];                 // 11 张无花
    p.flowers = [];
    p.pendingFlowers = [100, 108];                     // 春 + 中
  } else if (scenario === 'bahua'){
    p.hand = [0,1,2,3,4,5,6,7,8,9,10];
    p.flowers = [];
    p.pendingFlowers = [100,101,102,103,104,105,106,107];  // 8 张季花
  } else if (scenario === 'chain'){
    // 场景四：牌尾补上来的又是花 → 必须继续换，直到手里无花
    p.hand = [0,1,2,3,4,5,6,7,8,9,10];                 // 11 张无花
    p.flowers = [];
    p.pendingFlowers = [100, 108];                     // 暂存 2 张
    __tailScript = [101, 102];                         // 前两次补上来的都是花
  }
  await supplyPendingFlowers(p);
  return {
    abort: G.abort,
    pending: p.pendingFlowers.length,
    flowers: p.flowers.slice(),
    handLen: p.hand.length,
    handHasFlower: p.hand.some(isFlower),
    tailDrawn: __tailCount,
    bahua: __cap.bahua
  };
};
`;
eval(js + harness + '\n//# sourceURL=m19-engine');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

(async () => {
  console.log('== 起手补花延迟到首次出牌 ==');

  // 场景一：起手不立即补花
  const st = global.__dealState();
  for (const p of st){
    ok('seat' + p.seat + ' 起手 flowers 为空', p.flowers === 0, p.flowers);
    ok('seat' + p.seat + ' 起手手牌不含花', p.hasFlower === false, p.hasFlower);
  }
  ok('庄家(0) hand+pending === 14', st[0].handLen + st[0].pending === 14, st[0].handLen + st[0].pending);
  ok('闲家(1) hand+pending === 13', st[1].handLen + st[1].pending === 13, st[1].handLen + st[1].pending);
  ok('闲家(2) hand+pending === 13', st[2].handLen + st[2].pending === 13, st[2].handLen + st[2].pending);
  ok('闲家(3) hand+pending === 13', st[3].handLen + st[3].pending === 13, st[3].handLen + st[3].pending);
  ok('四家起手花已暂存（pending 合计 > 0 概率性，仅校验庄家有牌可出）', st[0].handLen === 14 || st[0].handLen + st[0].pending === 14, st[0]);

  // 场景二：普通补花
  const n = await global.__supply('normal');
  ok('normal 补花后 pending 清空', n.pending === 0, n.pending);
  ok('normal 补花后 flowers=2', n.flowers.length === 2, n.flowers.length);
  ok('normal 补花后手牌回到 13', n.handLen === 13, n.handLen);
  ok('normal 补花后手牌不含花', n.handHasFlower === false, n.handHasFlower);
  ok('normal 从牌尾补 2 张', n.tailDrawn === 2, n.tailDrawn);
  ok('normal 未触发八花齐 / 未 abort', n.bahua === false && n.abort === false, { bahua: n.bahua, abort: n.abort });

  // 场景三：八花齐
  const b = await global.__supply('bahua');
  ok('bahua 补花后 flowers=8', b.flowers.length === 8, b.flowers.length);
  ok('bahua 触发八花齐', b.bahua === true, b.bahua);
  ok('bahua 设置 G.abort 终止本局', b.abort === true, b.abort);

  // 场景四：牌尾补上来的又是花 → 循环补到手里无花（v1.2.10 修复回归）
  const c = await global.__supply('chain');
  ok('chain 补花后 pending 清空', c.pending === 0, c.pending);
  ok('chain flowers=4（暂存2 + 补上来的2）', c.flowers.length === 4, c.flowers);
  ok('chain 补上来的花已换出，手牌不含花', c.handHasFlower === false, c.handHasFlower);
  ok('chain 手牌回到 13（11 + 补4 - 再换2）', c.handLen === 13, c.handLen);
  ok('chain 牌尾共摸 4 张', c.tailDrawn === 4, c.tailDrawn);
  ok('chain 未误触发八花齐', c.bahua === false, c.bahua);

  console.log('结果: ' + (fail ? '❌ ' + fail + ' 项失败' : '✅ ' + pass + ' 通过 / 0 失败'));
  process.exit(fail ? 1 : 0);
})();
