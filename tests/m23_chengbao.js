// m23：包三口结算规则（v1.2.11）
//  1) 承包关系中一方自摸 → 承包对方付 5 份（替三家支付 + 自加 2 份罚金），另两家免付
//  2) 承包关系中一方点炮另一方 → 点炮者付 3 份
//  3) 其他两家点炮承包方 → 正常结算
//  豹子/荒番走 mult（per 已含），包三口份额同样适用
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = js.indexOf("$('btnHist').onclick");
if (cut < 0) { console.log('CUT FAIL'); process.exit(1); }
js = js.slice(0, cut);

const harness = `
;NET.active = false;
var __cap = { finishHtml: null, finishRec: null, finishDealer: undefined };
render = function(){}; renderActs = function(){}; renderHand = function(){};
renderSeats = function(){}; renderRiver = function(){}; renderFx = function(){};
renderTop = function(){}; renderTurnClock = function(){}; renderRoom = function(){};
renderHUD = function(){}; logMsg = function(){}; toast = function(){}; seatToast = function(){};
openSheet = function(){}; closeSheet = function(){};
finishHand = function(html, dealer, rec){ __cap.finishHtml = html; __cap.finishDealer = dealer; __cap.finishRec = rec; };

// 每场景重置牌局：score 1000 起步；可指定各家的 melds（承包关系只由 melds 判定）
global.__reset = function(melds){
  initGame();
  G.dealer = 0; G.kaibao = false; G.huangfan = 0; G.abort = false; G.running = true;
  for (const p of G.players){
    p.score = 1000;
    p.hand = [0,0,0,1,1,1,2,2,2,3,3,3,4,4];
    p.flowers = []; p.melds = (melds && melds[p.idx]) || [];
    p.menqing = false; p.knocked = false; p.settleFan = null; p.settleDi = null;
  }
};
const PUNG = (t, from) => ({ type:'pung', tiles:[t,t,t], tile:t, concealed:false, from: from });
const CHOW = (t, from) => ({ type:'chow', tiles:[t,t+1,t+2], tile:t, concealed:false, from: from });
global.__PUNG = PUNG; global.__CHOW = CHOW;
global.__zimo = async function(winnerIdx, melds){ __reset(melds); await finish({ type:'zimo', idx: winnerIdx, ev:{ type:'平胡', base:0, total:0 }, tile:4, ctx:{} }); return __cap; };
global.__dianpao = async function(from, melds){ __reset(melds); await finish({ type:'dianpao', wins:[{ idx:1, ev:{ type:'平胡', base:0, total:0 }, tile:4, diaoche:false }], from: from }); return __cap; };
`;
eval(js + harness + '\n//# sourceURL=m23-engine');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

(async () => {
  const PUNG = global.__PUNG, CHOW = global.__CHOW;
  console.log('== 包三口结算 ==');

  // 基线：无承包自摸 → 3/-1/-1/-1 份，先定单份 p
  await global.__reset({});
  let cap = await global.__zimo(0, {});
  let d = cap.finishRec.delta;
  const per = -d[1];
  ok('基线自摸 delta [3p,-p,-p,-p]', d[0] === 3 * per && d[1] === -per && d[2] === -per && d[3] === -per, d);
  ok('基线分数守恒', d.reduce((s, x) => s + x, 0) === 0, d.reduce((s, x) => s + x, 0));

  // 场景1：p0 对 p1 碰三口，p0 自摸 → p1 付 5 份，另两家免付
  cap = await global.__zimo(0, { 0: [PUNG(1,1), PUNG(2,1), PUNG(3,1)] });
  d = cap.finishRec.delta;
  ok('承包自摸(碰三口) p0 收 5 份', d[0] === 5 * per, d[0]);
  ok('承包自摸 p1(承包方) 付 5 份', d[1] === -5 * per, d[1]);
  ok('承包自摸 另两家免付', d[2] === 0 && d[3] === 0, d);
  ok('承包自摸 分数守恒', d.reduce((s, x) => s + x, 0) === 0, d.reduce((s, x) => s + x, 0));
  ok('承包自摸 结算面板标注包三口', cap.finishHtml.includes('包三口'), '');
  ok('承包自摸 下庄=胡家(seat0)', cap.finishDealer === 0, cap.finishDealer);

  // 场景2：p0 点炮 p1（p0 对 p1 碰三口 → 互为承包）→ 点炮者付 3 份
  cap = await global.__dianpao(0, { 0: [PUNG(1,1), PUNG(2,1), PUNG(3,1)] });
  d = cap.finishRec.delta;
  ok('承包点炮 胡家 p1 收 3 份', d[1] === 3 * per, d[1]);
  ok('承包点炮 点炮者 p0 付 3 份', d[0] === -3 * per, d[0]);
  ok('承包点炮 另两家不动', d[2] === 0 && d[3] === 0, d);
  ok('承包点炮 结算面板标注包三口', cap.finishHtml.includes('包三口'), '');

  // 场景3：其他两家(p2)点炮承包关系中的一方(p1) → 正常 1 份
  cap = await global.__dianpao(2, { 0: [PUNG(1,1), PUNG(2,1), PUNG(3,1)] });
  d = cap.finishRec.delta;
  ok('非承包点炮 胡家 p1 收 1 份', d[1] === per, d[1]);
  ok('非承包点炮 点炮者 p2 付 1 份', d[2] === -per, d[2]);
  ok('非承包点炮 面板无包三口标注', !cap.finishHtml.includes('包三口'), '');

  // 场景4：反向承包（p1 对 p0 碰三口），p0 自摸 → 同样 5 份（互为承包对称）
  cap = await global.__zimo(0, { 1: [PUNG(1,0), PUNG(2,0), PUNG(3,0)] });
  d = cap.finishRec.delta;
  ok('反向承包自摸 p0 收 5 份', d[0] === 5 * per, d[0]);
  ok('反向承包自摸 p1 付 5 份', d[1] === -5 * per, d[1]);

  // 场景5：吃三口同样构成承包
  cap = await global.__zimo(0, { 0: [CHOW(1,1), CHOW(4,1), CHOW(7,1)] });
  d = cap.finishRec.delta;
  ok('吃三口承包自摸 p0 收 5 份', d[0] === 5 * per, d[0]);
  ok('吃三口承包自摸 p1 付 5 份', d[1] === -5 * per, d[1]);

  // 场景6：凑不满三口的 2 碰不构成承包 → 正常自摸
  cap = await global.__zimo(0, { 0: [PUNG(1,1), PUNG(2,1)] });
  d = cap.finishRec.delta;
  ok('两碰不构成承包：正常 3/-1/-1/-1', d[0] === 3 * per && d[1] === -per && d[2] === -per && d[3] === -per, d);

  console.log('结果: ' + (fail ? '❌ ' + fail + ' 项失败' : '✅ ' + pass + ' 通过 / 0 失败'));
  process.exit(fail ? 1 : 0);
})();
