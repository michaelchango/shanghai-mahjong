// m16：底和番端到端验证（runHand 杠后自摸 → 结算明细）
// Part A：真实跑 runHand——玩家敲定 → 杠（暗杠或明杠）→ 杠后补牌自摸 → 断言「杠上开花 +1」进结算
// Part B：点炮结算——断言门清/无花果在点炮时也计入（从玩家状态读取）
// Part C：finish 直调——海底捞月 / 天胡 / 地胡 的 ctx 番种进入结算面板
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = js.indexOf("$('btnHist').onclick");
if (cut < 0) { console.log('CUT FAIL'); process.exit(1); }
js = js.slice(0, cut);

const harness = `
;NET.active = false;                     // 引擎段已定义 const NET，走单机分支
var __cap = { finishRes: null, finishHtml: null, finishRec: null };
// ---- 静音所有 UI ----
render = function(){}; renderActs = function(){}; renderHand = function(){};
renderSeats = function(){}; renderRiver = function(){}; renderFx = function(){};
renderTop = function(){}; renderTurnClock = function(){}; renderRoom = function(){};
logMsg = function(){}; toast = function(){}; seatToast = function(){};
openSheet = function(){}; closeSheet = function(){};
CFG.speed = 1000;   // sleep/waitBot 是 const 不可覆盖，改用速度倍率把等待压到亚毫秒
// ---- 捕获结算 ----
var __realFinish = finish;
finish = async function(res){ __cap.finishRes = res; await __realFinish(res); };
finishHand = function(html, dealer, rec){ __cap.finishHtml = html; __cap.finishRec = rec; };
// ---- 真人应答器：自摸点胡；首张（敲定前）打闲张 9m；其余不动作 ----
ask = async function(kind, payload, seat){
  if (kind === 'zimo') return 'hu';
  if (kind === 'discard') return 8;   // 9m 闲张，钓 7s
  return null;   // claim/knock/selfkong → 过
};
// ---- 定向牌墙 ----
// p0(庄, 座位0) 手牌 = 1m3 2m3 3m3 5p3 7s1（index 0,4..48）+ 第14张 9m（index52）
// 其余三家拿 1p..4s 循环（顺子形，无对无刻，不碰不胡）
// 摸牌区 index53..56：9p,9s,9s,1m —— p0 迟早摸到 1m 凑成四张杠
// 尾部 4 张 = 7s —— 杠后补牌恰好单钓 7s 胡牌
var __wall = [];
(function build(){
  for (var i = 0; i < 61; i++) __wall.push(27);        // 先全填北风（安全占位）
  var p0 = [0,0,0, 1,1,1, 2,2,2, 13,13,13, 24];        // 1m3 2m3 3m3 5p3 7s
  for (var k = 0; k < 13; k++) __wall[k*4] = p0[k];    // p0(庄) 拿 index 0,4,...,48
  __wall[52] = 8;                                       // p0 第 14 张：9m 闲张
  var fill = [9,10,11,12,13,14,15,16,17,18,19,20,21];  // 1p..4s
  for (var i2 = 0; i2 < 52; i2++) if (i2 % 4 !== 0) __wall[i2] = fill[i2 % 13];
  __wall[53] = 17; __wall[54] = 26; __wall[55] = 26; __wall[56] = 0;  // 摸牌区，1m 留给 p0
  for (var t = 0; t < 4; t++) __wall.push(24);          // 尾部 4 张 7s（drawTail 用）
})();
buildWall = function(){ return __wall.slice(); };
var __lastKongWasConcealed = null;   // 记录杠的形式（供断言门清判定）
var __realApplySelfKong = applySelfKong;
applySelfKong = async function(p, o){
  __lastKongWasConcealed = (o.k === 'ankan');
  return __realApplySelfKong(p, o);
};

async function main(){
  initGame();
  G.dealer = 0;
  var pr = runHand();          // 同步段（发牌/骰子/天胡检查）先跑完
  G.players[0].knocked = true; // 发牌后强制敲定（有杠必杠 / 有和必和自动）
  var timeout = new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('runHand 超时 10s')); }, 10000); });
  await Promise.race([pr, timeout]);
  return __cap;
}
global.__main = main;

// Part B：点炮时门清/无花果仍计入（finish 点炮分支从玩家状态读取）
global.__runDianpao = async function(){
  var capB = { html: null };
  var realFH = finishHand; finishHand = function(h){ capB.html = h; };
  try {
    initGame(); G.kaibao = false; G.huangfan = 0;
    G.players[0].menqing = true; G.players[0].flowers = []; G.players[0].melds = [];
    G.players[0].hand = [0,0,0, 1,1,1, 2,2,2, 13,13,13, 24, 24];  // 含炮牌 7s
    var ev = tryWin(toCounts(G.players[0].hand), G.players[0]);
    await finish({ type: 'dianpao', wins: [{ idx: 0, ev: ev, tile: 24, robKong: false, diaoche: false }], from: 1 });
    return { html: capB.html, evType: ev ? ev.type : null, evTotal: ev ? ev.total : null, base: ev ? ev.base : null };
  } finally { finishHand = realFH; }
};

// Part C：海底捞月 / 天胡 / 地胡 ctx 番（有花+非门清，隔离其他附加番）
global.__runCtxFan = async function(ctx){
  var capC = { html: null };
  var realFH = finishHand; finishHand = function(h){ capC.html = h; };
  try {
    initGame(); G.kaibao = false; G.huangfan = 0;
    G.players[0].hand = [0,0,0, 1,1,1, 2,2,2, 13,13,13, 24, 24];
    G.players[0].flowers = [100]; G.players[0].menqing = false; G.players[0].melds = [];
    var ev = tryWin(toCounts(G.players[0].hand), G.players[0]);
    await finish({ type: 'zimo', idx: 0, ev: ev, tile: 24, ctx: ctx });
    var m = /合计<\\/span><span class="v">(\\d+) 番/.exec(capC.html || '');
    return { html: capC.html, base: ev.base, total: ev.total, fanShown: m ? Number(m[1]) : null };
  } finally { finishHand = realFH; }
};

// 诊断：导出对局终局状态
global.__dumpState = function(){
  return {
    result: __cap.finishRes && __cap.finishRes.type,
    logs: (G.logs || []).slice(-40),
    p0: { hand: G.players[0].hand, melds: G.players[0].melds, discards: G.players[0].discards, knocked: G.players[0].knocked },
    wallLeft: wallLeft()
  };
};

`;

eval(js + harness + '\n//# sourceURL=m16-engine');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

(async () => {
  console.log('== Part A：runHand 杠后自摸（端到端） ==');
  let cap;
  try { cap = await global.__main(); }
  catch (e) { console.log('  FAIL: 引擎跑完', e.message); process.exit(1); }

  const res = cap.finishRes;
  if (!res || res.type !== 'zimo'){
    const st = global.__dumpState();
    console.log('  -- 诊断：终局 =', st.result, '· 墙剩', st.wallLeft);
    console.log('  -- p0 手牌', st.p0.hand.join(','), '· 杠', JSON.stringify(st.p0.melds.map(m => m.tile)));
    console.log('  -- 尾部日志:', st.logs.slice(-12).join(' | '));
  }
  ok('本局以自摸结束', res && res.type === 'zimo', res && res.type);
  ok('ctx.kongDraw = true（主循环杠标记传入结算）', !!(res && res.ctx && res.ctx.kongDraw === true), res && res.ctx);
  ok('结算面板明细含「杠上开花」', !!(cap.finishHtml && cap.finishHtml.includes('杠上开花')));
  // v1.2.12：杠算花 → 有杠必破无花果，结算不再给无花果
  ok('结算面板不含「无花果」（杠算花，已被杠破）', !(cap.finishHtml && cap.finishHtml.includes('无花果')));
  const base = res && res.ev ? res.ev.base : -1;
  ok('牌型为碰碰胡（v1.2.23 线性番 base=2）', base === 2, base);
  const expectTotal = base === 2 ? (cap.finishHtml && cap.finishHtml.includes('门清') ? 4 : 3) : -1;
  ok('总番数 = 牌型 + 附加番（杠上开花，无花果已破）', res && res.ev && res.ev.total === expectTotal, res && res.ev && [res.ev.type, res.ev.total, expectTotal]);
  ok('支付 = 底×番×unit（v1.2.23 线性，未超封顶不截断）', (() => {
    if (!res || !res.ev) return false;
    const di = 1 /*CFG.base*/ + (res.ev.flowers || 0);
    const raw = di * Math.max(1, res.ev.total) * 1 /*CFG.unit*/;
    return cap.finishHtml.includes('× ' + Math.max(1, res.ev.total)) && cap.finishHtml.includes(String(raw));
  })());

  console.log('== Part B：点炮时门清/无花果仍计入 ==');
  {
    const b = await global.__runDianpao();
    ok('点炮牌型成立（碰碰胡）', b.evType === '碰碰胡', b.evType);
    ok('点炮结算含「门清」', !!(b.html && b.html.includes('门清')));
    ok('点炮结算含「无花果」', !!(b.html && b.html.includes('无花果')));
    ok('点炮结算不含「杠上开花」（自摸专属）', !!(b.html && !b.html.includes('杠上开花')));
    ok('点炮总番 = 牌型+门清+无花果', b.evTotal === b.base + 2, [b.evType, b.base, b.evTotal]);
  }

  console.log('== Part C：海底捞月 / 天胡 / 地胡 ctx 番 ==');
  {
    const h = await global.__runCtxFan({ kongDraw: false, haidi: true, dihu: false, tianhu: false });
    ok('海底捞月 +1 进结算', !!(h.html && h.html.includes('海底捞月')));
    ok('海底捞月合计 = 牌型+1', h.fanShown === h.base + 1, [h.base, h.fanShown]);

    const d = await global.__runCtxFan({ kongDraw: false, haidi: false, dihu: true, tianhu: false });
    ok('地胡 +8 进结算', !!(d.html && d.html.includes('地胡')));
    ok('地胡合计 = 牌型+8', d.fanShown === d.base + 8, [d.base, d.fanShown]);

    const t = await global.__runCtxFan({ kongDraw: false, haidi: false, dihu: false, tianhu: true });
    ok('天胡 +8 进结算', !!(t.html && t.html.includes('天胡')));
    ok('天胡合计 = 牌型+8', t.fanShown === t.base + 8, [t.base, t.fanShown]);
  }

  console.log('结果: ' + (fail ? '❌ ' + fail + ' 项失败' : '✅ ' + pass + ' 通过 / 0 失败'));
  process.exit(fail ? 1 : 0);
})();
