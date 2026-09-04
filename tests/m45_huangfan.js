// m45：荒番（流局倍数）累积与递减规则（v1.2.25）
//  规则（README）：上一局流局 → 得分与封顶 ×2^荒番数；有人胡后荒番 −1
//  本测试用 Node 直接调 finish()，验证各胡牌路径（自摸/点炮/八花齐）后荒番是否按规则递减。
//  背景：用户反馈单机下「机器人胡牌时流局倍数没清掉」，此处做可复现断言。
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

// 重置牌局，可指定起始荒番
global.__reset = function(huangfan){
  initGame();
  G.dealer = 0; G.kaibao = false; G.huangfan = (huangfan === undefined ? 0 : huangfan);
  G.abort = false; G.running = true; G.finished = false;
  for (const p of G.players){
    p.score = 1000;
    p.hand = [0,0,0,1,1,1,2,2,2,3,3,3,4,4];
    p.flowers = []; p.melds = [];
    p.menqing = false; p.knocked = false; p.settleFan = null; p.settleDi = null;
  }
};
// 机器人（idx）自摸
global.__zimo = async function(winnerIdx, huangfan){
  __reset(huangfan);
  await finish({ type:'zimo', idx: winnerIdx, ev:{ type:'平胡', base:0, total:0 }, tile:4, ctx:{} });
  return { hf: G.huangfan, rec: __cap.finishRec };
};
// 机器人（idx=1）胡点炮（from=0 我点炮）
global.__dianpao = async function(winnerIdx, fromIdx, huangfan){
  __reset(huangfan);
  await finish({ type:'dianpao', wins:[{ idx: winnerIdx, ev:{ type:'平胡', base:0, total:0 }, tile:4, diaoche:false, robKong:false }], from: fromIdx });
  return { hf: G.huangfan, rec: __cap.finishRec };
};
// 流局
global.__liuju = async function(huangfan){
  __reset(huangfan);
  await finish({ type:'liuju' });
  return { hf: G.huangfan, rec: __cap.finishRec };
};
global.__finish = finish;
global.__G = () => G;
`;
eval(js + harness + '\n//# sourceURL=m45-engine');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

(async () => {
  console.log('== 荒番（流局倍数）累积/递减 ==');

  // 1) 流局：荒番 +1（封顶 HUANG_FAN_MAX=3）
  let r = await global.__liuju(0);
  ok('流局一次 → 荒番 0→1', r.hf === 1, r.hf);
  r = await global.__liuju(1);
  ok('再流局 → 荒番 1→2', r.hf === 2, r.hf);
  r = await global.__liuju(3);
  ok('荒番封顶 3（不超 HUANG_FAN_MAX）', r.hf === 3, r.hf);

  // 2) 机器人自摸 → 荒番 −1
  r = await global.__zimo(1, 2);
  ok('机器人自摸 → 荒番 2→1', r.hf === 1, r.hf);

  // 3) 机器人胡点炮 → 荒番 −1
  r = await global.__dianpao(1, 0, 2);
  ok('机器人点炮胡 → 荒番 2→1', r.hf === 1, r.hf);

  // 4) 荒番为 0 时胡牌不应变成负数
  r = await global.__zimo(1, 0);
  ok('荒番 0 时自摸 → 仍为 0（不为负）', r.hf === 0, r.hf);

  // 5) 荒番影响单份金额：荒番 1 的单份 = 荒番 0 的两倍
  const base = await global.__zimo(1, 0);
  const dbl  = await global.__zimo(1, 1);
  const per0 = base.rec.delta[0];
  const per1 = dbl.rec.delta[0];
  ok('荒番 ×2 生效：单份翻倍', per1 === per0 * 2, { per0, per1 });

  // 6) 一炮多响（两家机器人胡）也只 −1
  await global.__reset(2);
  await global.__finish({ type:'dianpao',
    wins:[{ idx:1, ev:{ type:'平胡', base:0, total:0 }, tile:4, diaoche:false, robKong:false },
          { idx:2, ev:{ type:'平胡', base:0, total:0 }, tile:4, diaoche:false, robKong:false }],
    from: 0 });
  ok('一炮多响 → 荒番 2→1（只减一次）', global.__G().huangfan === 1, global.__G().huangfan);

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exit(fail ? 1 : 0);
})();
