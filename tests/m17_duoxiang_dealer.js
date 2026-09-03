// m17：一炮多响后下局庄家应为点炮者（上海敲麻规则）
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = js.indexOf("$('btnHist').onclick");
if (cut < 0) { console.log('CUT FAIL'); process.exit(1); }
js = js.slice(0, cut);

const harness = `
;NET.active = false;
var __cap = { finishRes: null, finishHtml: null, finishRec: null };
render = function(){}; renderActs = function(){}; renderHand = function(){};
renderSeats = function(){}; renderRiver = function(){}; renderFx = function(){};
renderTop = function(){}; renderTurnClock = function(){}; renderRoom = function(){};
renderHUD = function(){}; logMsg = function(){}; toast = function(s){ G.__toastMsg = s; };
seatToast = function(){}; openSheet = function(){}; closeSheet = function(){};
CFG.speed = 1000;
var __realFinish = finish;
finish = async function(res){ __cap.finishRes = res; await __realFinish(res); };
finishHand = function(html, dealer, rec){ __cap.finishHtml = html; __cap.finishRec = rec; __cap.finishDealer = dealer; };

// 真人只操控 p0；p1/p2 机器人会自动胡
ask = async function(kind, payload){
  if (kind === 'discard') return 24;   // p0 打 7s 点炮
  return null;
};

// ---- 定向牌墙：p0 庄打 7s，p1/p2 双响 ----
// 发牌顺序：p0 拿 index 0,4,8,...,48；p1 拿 1,5,...,49；p2 拿 2,...,50；p3 拿 3,...,51
// p0 第14张 = index 52
var __wall = [];
(function build(){
  for (var i = 0; i < 144; i++) __wall.push(27);   // 先全填北风
  // p0: 5m3 6m3 7m3 8p2 9p2  (4刻子 + 2对子 = 14? 起手13张 = 4刻子+1对子=13, index52 补一张将/闲)
  // 用 5m3 6m3 7m3 8p2 9p2 = 13张 (3+3+3+2+2=13). 第14张 index52 = 7s, 形成 4刻子+2对子+1单, 不是胡牌型, 然后打 7s.
  var p0 = [4,4,4, 5,5,5, 6,6,6, 13,13, 14,14, 24];
  for (var k = 0; k < 13; k++) __wall[k*4] = p0[k];
  __wall[52] = 24;  // p0 第14张: 7s (单张, 打出)
  // p1: 1m3 2m3 3m3 4p3 7s1 = 13张 (4刻子+单张 7s) → 听 7s
  var p1 = [0,0,0, 1,1,1, 2,2,2, 12,12,12, 24];
  for (var k = 0; k < 13; k++) __wall[k*4 + 1] = p1[k];
  __wall[53] = 27;   // p1 第14张：北风，不影响听 7s
  // p2: 同 p1
  var p2 = [0,0,0, 1,1,1, 2,2,2, 12,12,12, 24];
  for (var k = 0; k < 13; k++) __wall[k*4 + 2] = p2[k];
  __wall[54] = 27;   // p2 第14张：北风
  // p3: 全北风，不参与
})();
buildWall = function(){ return __wall.slice(); };

var __dealState = null;
var __realDeal = deal;
deal = function(){
  __realDeal();
  __dealState = G.players.map(p => p.hand.slice().sort((a,b)=>a-b));
  // 强制敲听 7s，从而能 claim 胡 p0 打出的 7s（上海敲麻规则：没敲不能胡别家）
  // 双响模式（默认）：p1/p2 都敲；单响模式（__duoxiang === false）：只有 p1 敲
  G.players[1].knocked = true; G.players[1].knockWaits = [24];
  if (global.__duoxiang !== false){ G.players[2].knocked = true; G.players[2].knockWaits = [24]; }
};
async function main(){
  initGame();
  G.dealer = 0;
  var pr = runHand();
  var timeout = new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('runHand 超时 10s')); }, 10000); });
  await Promise.race([pr, timeout]);
  return __cap;
}
global.__main = main;
global.__dealState = function(){ return __dealState; };

// 诊断
function dump(){
  return {
    result: __cap.finishRes && __cap.finishRes.type,
    from: __cap.finishRes && __cap.finishRes.from,
    wins: __cap.finishRes && __cap.finishRes.wins && __cap.finishRes.wins.map(w => w.idx),
    dealerInRec: __cap.finishRec && __cap.finishRec.dealer,
    toast: (typeof G !== 'undefined' && G.__toastMsg) || null,
    deal: __dealState,
    p0: { hand: G.players[0].hand.slice().sort((a,b)=>a-b), discards: G.players[0].discards.slice() },
    p1: { hand: G.players[1].hand.slice().sort((a,b)=>a-b), discards: G.players[1].discards.slice() },
    p2: { hand: G.players[2].hand.slice().sort((a,b)=>a-b), discards: G.players[2].discards.slice() },
    p3: { hand: G.players[3].hand.slice().sort((a,b)=>a-b), discards: G.players[3].discards.slice() }
  };
}
global.__dump = dump;
global.__G = (typeof G !== 'undefined' ? G : null);
`;

eval(js + harness + '\n//# sourceURL=m17-engine');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

(async () => {
  console.log('== 一炮多响庄家规则 ==');
  let cap;
  try { cap = await global.__main(); }
  catch (e) { console.log('  FAIL: 引擎跑完', e.message); process.exit(1); }

  const res = cap.finishRes;
  const dmp = global.__dump();
  if (!res || res.type !== 'dianpao' || !(res.wins && res.wins.length >= 2)){
    console.log('  -- 诊断：', JSON.stringify(dmp, null, 1));
  }
  ok('本局以点炮结束', res && res.type === 'dianpao', res && res.type);
  ok('一炮多响（至少两家胡）', !!(res && res.wins && res.wins.length >= 2), res && res.wins && res.wins.length);
  ok('点炮者是 seat0（p0）', res && res.from === 0, res && res.from);
  ok('胡牌者包含 p1 和 p2', !!(res && res.wins && res.wins.some(w => w.idx === 1) && res.wins.some(w => w.idx === 2)), res && res.wins && res.wins.map(w => w.idx));
  ok('结算 toast 含「一炮多响」', !!(global.__G && global.__G.__toastMsg && global.__G.__toastMsg.includes('一炮多响')), global.__G && global.__G.__toastMsg);
  ok('下局庄家 = 点炮者 seat0', cap.finishDealer === 0, cap.finishDealer);

  // ---- 单响场景（v1.2.11）：只有一家胡 → 胡牌者坐庄 ----
  console.log('== 单响庄家规则（v1.2.11：胡家坐庄） ==');
  global.__duoxiang = false;
  cap = await global.__main();
  const res2 = cap.finishRes;
  ok('单响：本局以点炮结束', res2 && res2.type === 'dianpao', res2 && res2.type);
  ok('单响：只有一家胡（p1）', !!(res2 && res2.wins && res2.wins.length === 1 && res2.wins[0].idx === 1), res2 && res2.wins && res2.wins.map(w => w.idx));
  ok('单响：点炮者是 seat0', res2 && res2.from === 0, res2 && res2.from);
  ok('单响：下局庄家 = 胡牌者 seat1（非点炮者）', cap.finishDealer === 1, cap.finishDealer);

  console.log('结果: ' + (fail ? '❌ ' + fail + ' 项失败' : '✅ ' + pass + ' 通过 / 0 失败'));
  process.exit(fail ? 1 : 0);
})();
