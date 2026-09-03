// m39：v1.2.17 需求纠正——清混碰下中发白「算牌不算花」
//  （敲麻下维持算花 108-119；清混碰下按 31-33 上墙，可碰、可组刻子/将，作字牌参与番型）
//  1) buildWall 双态：敲麻 108~119 上墙（花）/ 清混碰 31~33 上墙（牌），两种都 144 张
//  2) 编码工具：31/32/33 非花、字牌 suit=3、名字 中/發/白、faceKey → chun/hatsu/haku
//  3) 番型判定（evaluateShape）：
//     a. 萬一门 + 白板对 → 混一色（绝不能误判清一色——字不算数牌）
//     b. 全字刻+将 → 风碰；全字七对 → 风一色
//     c. 数牌两门刻 + 字刻 → 碰碰胡；一门 + 字刻 → 混碰
//  4) 听牌枚举含中发白（getWaitsHand 补进 31~33 才有「听白板」）
//  5) claimOptions：中发白可碰/杠、永远不能吃（字牌无顺子）
//  6) AI：清混碰下会碰中发白；混一色目标允许中发白、清一色目标拒绝中发白
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
global.__ = { CFG, mkPlayer, buildWall, isFlower, isHonor, suitOf, tileName, faceKey,
  evaluateShape, isWinShape, getWaitsHand, claimOptions, aiClaim, aiPlan, tileFitsPlan,
  toCounts, sortTiles, PLAYCNT, evalAll };
`);
const T = global.__;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ❌ FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };
const m = n => n - 1, p = n => 9 + n - 1, s = n => 18 + n - 1;
const ZHONG = 31, FA = 32, BAI = 33;
const EV = (hand, melds) => T.evaluateShape(T.toCounts(hand), melds || [], { flowerCount: 0 });
const bot = (hand, target) => { const pl = T.mkPlayer(0, 'bot', true); pl.hand = hand.slice(); pl.melds = []; pl.target = target || null; return pl; };

console.log('== 1) buildWall 双态 ==');
T.CFG.lajiHu = true;
let wK = T.buildWall(), cK = {};
for (const t of wK) cK[t] = (cK[t] || 0) + 1;
T.CFG.lajiHu = false;
let wQ = T.buildWall(), cQ = {};
for (const t of wQ) cQ[t] = (cQ[t] || 0) + 1;
ok('两种玩法墙都是 144 张', wK.length === 144 && wQ.length === 144, [wK.length, wQ.length]);
ok('敲麻墙：108~119 按 12 个编码各 1 张（每视觉种 4 张、编码分散防凑刻）',
   (() => { let n = 0; for (let t = 108; t <= 119; t++) n += cK[t] || 0; return n === 12; })(), null);
ok('敲麻墙：无 31~33（不算牌）', cK[31] === undefined && cK[32] === undefined && cK[33] === undefined, [cK[31], cK[32], cK[33]]);
ok('清混碰墙：31/32/33 各 4 张（牌）', cQ[31] === 4 && cQ[32] === 4 && cQ[33] === 4, [cQ[31], cQ[32], cQ[33]]);
ok('清混碰墙：无 108~119（不算花）', [108, 112, 116].every(t => cQ[t] === undefined), [cQ[108], cQ[112], cQ[116]]);
ok('清混碰墙：季花 8 张仍在', (() => { let n = 0; for (let f = 100; f <= 107; f++) n += cQ[f] || 0; return n === 8; })(), null);

console.log('== 2) 编码工具 ==');
ok('31~33 不是花', [ZHONG, FA, BAI].every(t => !T.isFlower(t)));
ok('31~33 是字牌（isHonor）', [ZHONG, FA, BAI].every(t => T.isHonor(t)));
ok('31~33 suit=3（与风同组：字）', [ZHONG, FA, BAI].every(t => T.suitOf(t) === 3), [ZHONG, FA, BAI].map(T.suitOf));
ok('名字 中/發/白', T.tileName(ZHONG) === '中' && T.tileName(FA) === '發' && T.tileName(BAI) === '白',
   [T.tileName(ZHONG), T.tileName(FA), T.tileName(BAI)]);
ok('faceKey 31/32/33 → chun/hatsu/haku', T.faceKey(ZHONG) === 'chun' && T.faceKey(FA) === 'hatsu' && T.faceKey(BAI) === 'haku',
   [T.faceKey(ZHONG), T.faceKey(FA), T.faceKey(BAI)]);
ok('東南西北不受影响（w0~w3）', [27, 28, 29, 30].every((t, i) => T.faceKey(t) === 'w' + i));

console.log('== 3) 番型判定（清混碰） ==');
T.CFG.lajiHu = false;
// 萬 111 222 333 456 + 白白 → 顺子型（非碰碰），一门萬 + 字白 → 混一色（若把白当数牌会误判清一色）
const r3a = EV([m(1), m(1), m(1), m(2), m(2), m(2), m(3), m(3), m(3), m(4), m(5), m(6), BAI, BAI]);
ok('萬一门+白板对 = 混一色（字不算数牌，不得误判清一色）', r3a && r3a.type === '混一色', r3a);
// 全字刻+将 → 风碰
const r3b = EV([27, 27, 27, 28, 28, 28, ZHONG, ZHONG, ZHONG, FA, FA, FA, BAI, BAI]);
ok('全字（含中发白）刻+将 = 风碰', r3b && r3b.type === '风碰', r3b);
// 全字七对 → 风一色
const r3c = EV([27, 27, 28, 28, 29, 29, 30, 30, ZHONG, ZHONG, FA, FA, BAI, BAI]);
ok('全字七对（含中发白）= 风一色', r3c && r3c.type === '风一色', r3c);
// 数牌两门刻 + 字刻 + 風将 → 碰碰胡
const r3d = EV([m(1), m(1), m(1), p(2), p(2), p(2), ZHONG, ZHONG, ZHONG, FA, FA, FA, 27, 27]);
ok('数牌两门+中發刻+東将 = 碰碰胡', r3d && r3d.type === '碰碰胡', r3d);
// 一门数牌刻 + 字刻 + 将 → 混碰（混一色+碰碰胡，不是清碰）
const r3e = EV([m(1), m(1), m(1), m(2), m(2), m(2), m(3), m(3), m(3), ZHONG, ZHONG, ZHONG, BAI, BAI]);
ok('萬三刻+中刻+白将 = 混碰（非清碰）', r3e && r3e.type === '混碰', r3e);
// 敲麻对照：平胡带字是否仍不组字（108~119 不上墙，手牌里不会出现）
T.CFG.lajiHu = true;
const r3f = EV([m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(1), p(1), 108, 108]);
ok('敲麻下 108 仍是花（不进组牌判定，此手牌不可胡）', r3f === null || r3f.type === '垃圾胡', r3f);

console.log('== 4) 听牌枚举含中发白 ==');
T.CFG.lajiHu = false;
// 中×3 發×3 萬123 萬456 + 单白 → 摸白成 4 面子+白将
const waits = T.getWaitsHand([ZHONG, ZHONG, ZHONG, FA, FA, FA, m(1), m(2), m(3), m(4), m(5), m(6), BAI], []);
ok('听牌列表含白板（摸白即胡）', waits.some(w => w.t === BAI),
   waits.map(w => T.tileName(w.t)));

console.log('== 5) 吃碰选项：可碰/杠、不能吃 ==');
T.CFG.lajiHu = false;
const p5 = bot([ZHONG, ZHONG, ZHONG, FA, FA, BAI, BAI, m(1), m(2), m(3), m(4), m(5), m(6)], 'pung');
const opts5 = T.claimOptions(p5, ZHONG, 1, true);
ok('别人打「中」：有碰', opts5.some(o => o.k === 'pung'), opts5.map(o => o.k));
ok('字牌永远不能吃（无 chow 选项）', !opts5.some(o => o.k === 'chow'), opts5.map(o => o.k));
// 手里已有暗刻时打第四张：有杠
const p5b = bot([ZHONG, ZHONG, ZHONG, FA, FA, BAI, BAI, m(1), m(2), m(3), m(4), m(5), m(6)], 'pung');
const opts5b = T.claimOptions(p5b, ZHONG, 1, true);
ok('手里三张「中」时点炮：有杠可选', opts5b.some(o => o.k === 'kong'), opts5b.map(o => o.k));

console.log('== 6) AI 对中发白的态度（清混碰） ==');
T.CFG.lajiHu = false;
// v1.2.18：aiClaim 会实时重算 target（边打边判断），手动传 target 不再生效；
// 未听牌、实时目标为碰碰胡时打「中」会碰
const p6a = bot([27, 27, 27, 0, 0, 0, 9, 9, 18, 18, ZHONG, ZHONG, 5], 'pung');
const pick6a = T.aiClaim(p6a, ZHONG, 1, T.claimOptions(p6a, ZHONG, 1, false), false);
ok('未听牌朝碰碰胡：打「中」会碰', pick6a !== null && pick6a.k === 'pung', pick6a);
// 已听牌（pung 0 向听）时不再无脑碰——碰了要弃牌、破听又暴露牌（v1.2.18 修复点）
const p6b = bot([27, 27, 27, 28, 28, 28, 0, 0, 0, ZHONG, ZHONG, 9, 9], 'pung');
const curB = T.evalAll(T.toCounts(p6b.hand), 0).pung;
const pick6b = T.aiClaim(p6b, ZHONG, 1, T.claimOptions(p6b, ZHONG, 1, false), false);
ok('已听牌（0 向听）不碰：守护听牌', curB === 0 && pick6b === null, { curB, pick: pick6b });
// 混一色（筒）目标：允许中发白
const planMix = T.aiPlan(bot([], 'mix1'));
const planPure = T.aiPlan(bot([], 'pure1'));
ok('混一色目标：中发白可留（字牌）', T.tileFitsPlan(BAI, planMix), null);
ok('清一色目标：中发白不留（纯数牌）', !T.tileFitsPlan(BAI, planPure), null);
ok('风一色目标：只收字牌', (() => { const pw = T.aiPlan(bot([], 'wind'));
  return T.tileFitsPlan(BAI, pw) && T.tileFitsPlan(30, pw) && !T.tileFitsPlan(8, pw); })(), null);

console.log('');
console.log(`结果: ${fail === 0 ? '✅' : '❌'} ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
