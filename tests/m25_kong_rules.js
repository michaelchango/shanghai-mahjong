// m25：加杠规则（v1.2.12）
//  1) selfKongOptions 扫描全手牌：已碰+手里第4张=加杠选项；手牌4张=暗杠选项
//  2) 未敲真人出牌前可杠询问（discardTurn 内）；选杠返回 {kong}；点过则本轮不再问
//  3) 加杠被抢杠：其他已敲者听该牌 → 抢杠胡，被抢者付 3 倍
//  4) 杠算花 → 无花果被破（有杠时 extraFan 不含无花果）
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
var __askR = null;
var __kongAnswer = null;
ask = async function(kind){
  if (kind === 'selfkong') return __kongAnswer;
  if (kind === 'discard') return 23;   // 点过后的正常出牌
  return null;
};
global.__setAsk = function(v){ __kongAnswer = v; };

// 重置牌局
global.__reset = function(state){
  initGame();
  G.dealer = 0; G.kaibao = false; G.huangfan = 0; G.abort = false; G.finished = false; G.running = true;
  for (const p of G.players){
    p.score = 1000; p.flowers = []; p.melds = []; p.menqing = true; p.knocked = false; p.knockWaits = [];
    p.kongAsked = false; p.settleFan = null; p.settleDi = null;
  }
  if (state) for (const k in state){
    const p = G.players[state[k].idx];
    if (state[k].hand) p.hand = state[k].hand.slice();
    if (state[k].melds) p.melds = state[k].melds.slice();
    if (state[k].knocked) p.knocked = true;
    if (state[k].knockWaits) p.knockWaits = state[k].knockWaits.slice();
    if (state[k].flowers) p.flowers = state[k].flowers.slice();
  }
};
const PUNG = (t, from) => ({ type:'pung', tiles:[t,t,t], tile:t, concealed:false, from: from });
global.__PUNG = PUNG;
global.__kongOpts = function(melds, hand){ __reset({ 0:{ idx:0, melds: melds, hand: hand } }); return selfKongOptions(G.players[0]); };
global.__extraFanFlowers = function(melds, flowers){ __reset({ 0:{ idx:0, melds: melds, flowers: flowers } }); const add = extraFan(G.players[0], {}); return add.some(x => x[0] === '无花果'); };
global.__robKong = async function(){
  __reset({
    0:{ idx:0, melds:[PUNG(14,1)], hand:[0,1,2,3,4,5,6,7,8,9,10,11,14] },  // p0 碰 5p + 手里第 4 张 5p
    1:{ idx:1, knocked:true, knockWaits:[14], hand:[0,0,0,1,1,1,2,2,2,11,11,11,14] }  // p1 已敲听 5p
  });
  await applySelfKong(G.players[0], { k:'chakan', tile:14 });
  return __cap;
};
global.__kongViaDiscard = async function(doKong){
  __reset({ 0:{ idx:0, melds:[PUNG(14,1)], hand:[0,1,2,3,4,5,6,7,8,9,10,11,14] } });
  __setAsk(doKong ? { k:'chakan', tile:14 } : null);
  const r = await discardTurn(G.players[0], 23, false);
  return { ret: r, kongAsked: G.players[0].kongAsked };
};
`;
eval(js + harness + '\n//# sourceURL=m25-engine');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

(async () => {
  const PUNG = global.__PUNG;
  console.log('== 加杠 / 抢杠 / 无花果 ==');

  // 1) selfKongOptions 扫全手牌
  let o = global.__kongOpts([PUNG(14,1)], [0,1,2,3,4,5,6,7,8,9,10,11,14]);   // 碰5p + 手里第4张5p
  ok('已碰+手里第4张 → 加杠选项', o.some(x => x.k === 'chakan' && x.tile === 14), o);
  o = global.__kongOpts([], [0,0,0,1,1,1,2,2,2,3,4,4,4,4]);   // 手牌 4 张 4p（其余 10 张）
  ok('手牌4张 → 暗杠选项', o.some(x => x.k === 'ankan' && x.tile === 4), o);
  o = global.__kongOpts([], [0,1,2,3,4,5,6,7,8,9,10,11,12,13]);
  ok('无可杠时返回空', o.length === 0, o);

  // 2) 未敲真人出牌前：选杠 → {kong}；点过 → 本轮不再问
  let r = await global.__kongViaDiscard(true);
  ok('出牌前选加杠 → 返回 {kong}', !!(r.ret && r.ret.kong === true), r.ret);
  r = await global.__kongViaDiscard(false);
  ok('出牌前点过 → kongAsked=true（本轮不再问）', r.kongAsked === true, r);
  ok('出牌前点过 → 正常出牌（返回数字）', typeof r.ret === 'number', r.ret);

  // 3) 抢杠：加杠被已敲者抢胡 → 被抢者（加杠方）付 3 倍
  const c = await global.__robKong();
  const d = c.finishRec ? c.finishRec.delta : null;
  const per = d ? Math.abs(d[0]) / 3 : NaN;
  ok('抢杠：胡家(seat1)收 3 倍', d && d[1] === 3 * per, d);
  ok('抢杠：被抢者(seat0)付 3 倍', d && d[0] === -3 * per, d);
  ok('抢杠：结算面板标注「加杠被抢」', !!(c.finishHtml && c.finishHtml.includes('加杠被抢')), '');
  ok('抢杠：分数守恒', d && d.reduce((s, x) => s + x, 0) === 0, d && d.reduce((s, x) => s + x, 0));

  // 4) 杠算花 → 无花果被破
  ok('无杠无花 → 有无花果', global.__extraFanFlowers([], []) === true, '');
  ok('有暗杠 → 无花果被破', global.__extraFanFlowers([{ type:'kong', tiles:[4,4,4,4], tile:4, concealed:true, from:-1 }], []) === false, '');
  ok('有加杠(明杠) → 无花果被破', global.__extraFanFlowers([{ type:'kong', tiles:[5,5,5,5], tile:5, concealed:false, from:1 }], []) === false, '');

  console.log('结果: ' + (fail ? '❌ ' + fail + ' 项失败' : '✅ ' + pass + ' 通过 / 0 失败'));
  process.exit(fail ? 1 : 0);
})();
