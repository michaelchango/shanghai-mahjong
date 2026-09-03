// m33：v1.2.15 三项修复回归
//  Part1（index.html 引擎侧）：「自动胡牌」开关控制点炮/自摸询问；设置面板含「自动胡牌」
//  Part2（engine.js 服务端侧）：「自动敲」敲对座位（不再错敲座位 0）；投影下发自己的 knockWaits、别家不下发
const fs = require('fs');
const path = require('path');
const { boot } = require('../proto/server/headless');
const { projectFor } = require('../proto/server/view');
const { handSeed } = require('../proto/server/rng');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

/* ---------- Part1：harness（index.html） ---------- */
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = js.indexOf("$('btnHist').onclick");
if (cut < 0) { console.log('CUT FAIL'); process.exit(1); }
js = js.slice(0, cut);

const harness = `
;NET.active = false;
var __askLog = [], __askReply = undefined;
render = function(){}; renderActs = function(){}; renderHand = function(){};
renderSeats = function(){}; renderRiver = function(){}; renderFx = function(){};
renderTop = function(){}; renderTurnClock = function(){}; renderRoom = function(){};
renderHUD = function(){}; logMsg = function(){}; toast = function(){}; seatToast = function(){};
openSheet = function(){}; closeSheet = function(){};
ask = async function(kind, payload, seat){ __askLog.push([kind, seat]); return __askReply; };
global.__api = { G, CFG, mkPlayer, pickClaim, cfgRows, knockCheck,
  setAskLog(){ __askLog = []; }, getAskLog(){ return __askLog; }, setReply(v){ __askReply = v; } };
`;
eval(js + harness + '\n//# sourceURL=m33-engine');

(async () => {
  console.log('== Part1：自动胡牌开关（index.html 引擎） ==');
  const { G, CFG, mkPlayer, pickClaim, cfgRows } = global.__api;

  ok('CFG.autoHu 默认为关', CFG.autoHu === false, CFG.autoHu);
  const rowsStr = cfgRows(false);
  ok('设置面板含「自动胡牌」行', rowsStr.includes('自动胡牌') && rowsStr.includes('setCfg9'), null);

  const mkP = (idx) => mkPlayer(idx, 'P' + idx, false);
  // 敲定者 + 点炮胡选项
  const hu = { k: 'hu', tile: 24, ev: { type: '垃圾胡', base: 0, total: 0, flowers: 2 } };

  // 场景1：autoHu 开 → 敲定者点炮自动胡，不询问
  CFG.autoHu = true;
  G.players = [mkP(0), mkP(1), mkP(2), mkP(3)];
  const p0 = G.players[0]; p0.knocked = true;
  global.__api.setAskLog(); global.__api.setReply(null);
  let r1 = await pickClaim(p0, 0, 24, 1, [hu], false);
  ok('autoHu开：敲定者点炮自动胡', r1 && r1.k === 'hu', r1);
  ok('autoHu开：不弹询问', global.__api.getAskLog().length === 0, global.__api.getAskLog());

  // 场景2：autoHu 关 → 敲定者点炮出「胡/过」询问；选「过」记漏胡
  CFG.autoHu = false;
  global.__api.setAskLog(); global.__api.setReply(null);
  let r2 = await pickClaim(p0, 0, 24, 1, [hu], false);
  ok('autoHu关：敲定者被询问 claim', global.__api.getAskLog().length === 1 && global.__api.getAskLog()[0][0] === 'claim', global.__api.getAskLog());
  ok('autoHu关：询问座位正确', global.__api.getAskLog()[0][1] === 0, global.__api.getAskLog()[0]);
  ok('autoHu关：pass 返回 null', r2 === null, r2);
  ok('autoHu关：pass 记漏胡', p0.missHu.has(24), [...p0.missHu]);

  // 场景2b：autoHu 关 → 敲定者点炮点「胡」正常胡
  global.__api.setReply(hu);
  let r2b = await pickClaim(p0, 0, 24, 1, [hu], false);
  ok('autoHu关：选胡返回 hu', r2b && r2b.k === 'hu', r2b);
  global.__api.setReply(undefined);

  // 场景3：autoHu 关 + 未敲（地胡免敲场景有 hu 选项）→ 仍走询问
  const p1 = G.players[1]; p1.knocked = false;
  global.__api.setAskLog(); global.__api.setReply(null);
  await pickClaim(p1, 1, 24, 0, [hu], true);
  ok('autoHu关：未敲者有胡选项也走询问', global.__api.getAskLog().length === 1, global.__api.getAskLog());
  ok('autoHu关：未敲 pass 也记漏胡', p1.missHu.has(24), [...p1.missHu]);

  // 场景4：autoHu 开 + 未敲者 → 自动胡（免敲询问也跳过）
  CFG.autoHu = true;
  global.__api.setAskLog();
  let r4 = await pickClaim(p1, 1, 24, 0, [hu], true);
  ok('autoHu开：未敲者有胡也自动胡', r4 && r4.k === 'hu', r4);
  ok('autoHu开：不弹询问', global.__api.getAskLog().length === 0, global.__api.getAskLog());
  CFG.autoHu = false;

  /* ---------- Part2：engine.js 服务端侧 ---------- */
  console.log('== Part2：自动敲座位 + knockWaits 投影（服务端） ==');
  const S2 = boot({ seed: handSeed(915, 1, 0), instant: true });
  const st = S2.__state;
  S2.initGame();
  // 场景5：autoKnock 开 → 座位 1 的真人凑到听牌 → 敲的是座位 1（修复前错敲座位 0）
  st.CFG.autoKnock = true;
  const P = st.G.players;
  for (const p of P){ p.isBot = false; }
  P[0].knocked = false; P[1].knocked = false;
  P[1].hand = [0,0,0, 1,1,1, 2,2,2, 12,12,12, 24];   // 13 张听 7s(24)
  P[1].melds = [];
  await S2.knockCheck(P[1]);
  ok('autoKnock：座位 1 被敲定', P[1].knocked === true && P[1].knockWaits.length === 1, [P[1].knocked, P[1].knockWaits]);
  ok('autoKnock：座位 0 不被误敲', P[0].knocked === false, P[0].knocked);
  st.CFG.autoKnock = false;

  // 场景6：投影只下发自己的 knockWaits
  P[0].knocked = true; P[0].knockWaits = [24, 25];
  P[1].knocked = true; P[1].knockWaits = [0];
  const v0 = projectFor(S2, 0);
  const v1 = projectFor(S2, 1);
  ok('投影：自己的 knockWaits 下发', Array.isArray(v0.players[0].knockWaits) && v0.players[0].knockWaits.join(',') === '24,25', v0.players[0].knockWaits);
  ok('投影：别家 knockWaits 不下发', v0.players[1].knockWaits === undefined, v0.players[1].knockWaits);
  ok('投影：座位 1 视角拿到自己的', v1.players[1].knockWaits && v1.players[1].knockWaits.join(',') === '0', v1.players[1].knockWaits);

  // 场景7：server.js 配置白名单含 autoHu（源码检查）
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  ok('服务端 CFG_ALLOW 含 autoHu', /autoHu:\s*v =>/.test(srv), null);
  ok('服务端默认规则含 autoHu', /autoKnock: false, autoHu: false/.test(srv), null);
  ok('服务端重连清 noPromptSig', srv.includes("noPromptSig = ''"), null);

  console.log('结果: ' + (fail ? '❌ ' + fail + ' 项失败' : '✅ ' + pass + ' 通过 / 0 失败'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
