// m36：v1.2.16 清混碰玩法 + 玩法选项 + 中发白算花 + 圆心无人留空
//  1) 玩法选项：设置面板「玩法」行 = 敲麻 / 清混碰（写 lajiHu），默认值与原语义一致
//  2) 清混碰下 AI 目标含 清一色/风一色（旧版只会在碰碰胡+混一色里选）
//  3) aiPlan / tileFitsPlan 花色约束：混一色只吃本门+风、清一色只吃本门、风一色只吃风
//  4) aiClaim：清混碰下不吃不符花色的牌；碰碰胡不吃顺子
//  5) 敲麻模式（lajiHu 开）行为不变：仍可走平胡、吃碰不受花色锁
//  6) 中发白算花：108~119 是花，不参与组牌（PLAYCNT 内无中发白）
//  7) 圆心无人决策时留空（源码断言 renderTurnClock）
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = js.indexOf("$('btnHist').onclick");
if (cut < 0) { console.log('CUT FAIL'); process.exit(1); }
js = js.slice(0, cut);

const harness = `
;NET.active = false;
render = function(){}; renderActs = function(){}; renderHand = function(){}; renderSeats = function(){};
renderRiver = function(){}; renderFx = function(){}; renderTop = function(){}; renderTurnClock = function(){};
renderRoom = function(){}; renderHUD = function(){}; logMsg = function(){}; toast = function(){};
seatToast = function(){}; openSheet = function(){}; closeSheet = function(){};

global.__mkBot = function(hand, target){
  const p = mkPlayer(0, '机器人', true);
  p.hand = hand.slice(); p.melds = []; p.target = target || null;
  return p;
};
global.__setLaji = function(v){ CFG.lajiHu = !!v; };
global.__evalAll = function(hand, meldN){ return evalAll(toCounts(hand), meldN || 0); };
global.__targetOf = function(hand){ const p = global.__mkBot(hand); return aiTargetOf(p); };
global.__planOf = function(target){ const p = global.__mkBot([0,1,2], target); return aiPlan(p); };
global.__fits = function(t, target){ return tileFitsPlan(t, aiPlan(global.__mkBot([0,1,2], target))); };
// 清混碰下 AI 对某个「打出的牌」是否动牌
global.__claim = function(hand, target, tile, opts){
  const p = global.__mkBot(hand, target);
  return aiClaim(p, tile, 1, opts, false);
};
const CHOW = (combo, tile) => ({ k:'chow', tile: tile, combo: combo });
const PUNG = t => ({ k:'pung', tile: t });
const KONG = t => ({ k:'kong', tile: t });
global.__CHOW = CHOW; global.__PUNG = PUNG; global.__KONG = KONG;
global.__mkPlayer = mkPlayer;
global.__cfgRows = function(laji){ CFG.lajiHu = !!laji; return cfgRows(false); };
global.__isFlower = isFlower;
global.__flowerChar = flowerChar;
global.__tileName = tileName;
global.__PLAYCNT = PLAYCNT;
global.__suitOf = suitOf;
`;
eval(js + harness + '\n//# sourceURL=m36-engine');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ❌ FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

// 牌编码：0-8 萬 / 9-17 筒 / 18-26 條 / 27-30 東南西北 / 100+ 花

console.log('== 1) 玩法选项：敲麻 / 清混碰 ==');
let rows = global.__cfgRows(true);
ok('设置面板含「玩法」行', rows.indexOf('玩法') >= 0, rows.indexOf('玩法'));
ok('玩法选项为「敲麻 / 清混碰」', rows.indexOf('>敲麻<') >= 0 && rows.indexOf('>清混碰<') >= 0,
   [rows.indexOf('>敲麻<'), rows.indexOf('>清混碰<')]);
ok('敲麻选中时高亮在「敲麻」', /class="on"[^>]*>敲麻</.test(rows), rows.match(/sgLaji[\s\S]{0,160}/));
ok('不再出现「垃圾胡（平胡）」旧文案', rows.indexOf('垃圾胡（平胡）') < 0, null);
rows = global.__cfgRows(false);
ok('清混碰选中时高亮在「清混碰」', /class="on"[^>]*>清混碰</.test(rows), rows.match(/sgLaji[\s\S]{0,160}/));
ok('玩法行仍用 setCfg8', rows.indexOf('setCfg8') >= 0, null);

console.log('== 2) 清混碰：AI 目标含清一色 / 风一色 ==');
global.__setLaji(false);
// 萬子高度集中：清一色应当被选为目标
let t = global.__targetOf([0,0,0,1,2,3,4,5,6,7,8,8,8]);
ok('萬子集中 → 目标为 pure0（清一色萬）或 mix0', t === 'pure0' || t === 'mix0', t);
let e = global.__evalAll([0,0,0,1,2,3,4,5,6,7,8,8,8], 0);
ok('该手牌清一色向听不比混一色差 2 步以上', e.pure0 - e.mix0 <= 1, { pure0: e.pure0, mix0: e.mix0 });
// 风牌集中 → 风一色
t = global.__targetOf([27,27,27,27,28,28,28,29,29,29,30,30,30]);
ok('全风牌（4 组风刻）→ 目标 wind（风一色）', t === 'wind', t);
// 对子多、花色杂 → 碰碰胡
t = global.__targetOf([0,0,0,9,9,9,18,18,18,27,27,2,5]);
ok('刻子多花色杂 → 目标 pung（碰碰胡）', t === 'pung', t);
// 清混碰下绝不选平胡 std
const hands = [[0,1,2,9,10,11,18,19,20,3,4,5,6], [0,0,1,1,2,2,9,9,10,10,18,19,20],
               [3,4,5,12,13,14,21,22,23,27,28,29,30]];
let anyStd = hands.some(h => global.__targetOf(h) === 'std');
ok('清混碰下不会出现 std（平胡）目标', !anyStd, hands.map(global.__targetOf));

console.log('== 3) 清混碰：花色约束（aiPlan / tileFitsPlan） ==');
let pl = global.__planOf('mix0');
ok('mix0：本门(萬)+风，非碰碰胡', pl.suit === 0 && pl.allowWind === true && pl.pung === false, pl);
pl = global.__planOf('pure1');
ok('pure1：只本门(筒)、不吃风', pl.suit === 1 && pl.allowWind === false, pl);
pl = global.__planOf('wind');
ok('wind：只风牌', pl.suit === 3 && pl.allowWind === true, pl);
pl = global.__planOf('pung');
ok('pung：不限花色（pung=true）', pl.suit === null && pl.pung === true, pl);
ok('混一色可吃本门 5萬', global.__fits(4, 'mix0') === true, null);
ok('混一色不吃 5筒', global.__fits(13, 'mix0') === false, null);
ok('混一色可碰 東(27)', global.__fits(27, 'mix0') === true, null);
ok('清一色不碰 東(27)', global.__fits(27, 'pure0') === false, null);
ok('清一色可吃本门 3條', global.__fits(20, 'pure2') === true, null);
ok('风一色只吃风：東(27) 可', global.__fits(27, 'wind') === true, null);
ok('风一色只吃风：5萬(4) 不可', global.__fits(4, 'wind') === false, null);
ok('碰碰胡任意花色都可碰', global.__fits(13, 'pung') === true && global.__fits(27, 'pung') === true, null);

console.log('== 4) 清混碰：aiClaim 不吃不符花色的牌 ==');
global.__setLaji(false);
// 混一色(萬)机器人：筒子的碰/吃/杠都不该动
const mixHand = [0,0,1,2,3,4,5,6,7,8,8,27,27];
ok('混一色(萬) 不碰 5筒(13)', global.__claim(mixHand, 'mix0', 13, [global.__PUNG(13)]) === null,
   global.__claim(mixHand, 'mix0', 13, [global.__PUNG(13)]));
ok('混一色(萬) 不吃 筒子顺子', global.__claim(mixHand, 'mix0', 12, [global.__CHOW([12,13,14], 12)]) === null,
   global.__claim(mixHand, 'mix0', 12, [global.__CHOW([12,13,14], 12)]));
// 该手牌 mix0 已听牌，再碰只会倒退 → 不该动牌
ok('混一色已听牌时不乱碰（向听不倒退）',
   global.__claim([0,0,1,2,3,4,5,6,7,8,27,27,27], 'mix0', 27, [global.__PUNG(27)]) === null,
   global.__claim([0,0,1,2,3,4,5,6,7,8,27,27,27], 'mix0', 27, [global.__PUNG(27)]));
// 吃本门顺子直接成组 → 应当吃
ok('混一色(萬) 可吃本门顺子（吃 6 用 7,8）',
   !!global.__claim([0,1,2,3,4,5,7,8,27,27,27,9,9], 'mix0', 6, [global.__CHOW([7,8], 6)]),
   global.__claim([0,1,2,3,4,5,7,8,27,27,27,9,9], 'mix0', 6, [global.__CHOW([7,8], 6)]));
// 清一色：风牌也不碰
ok('清一色(萬) 不碰 東(27)', global.__claim([0,0,1,2,3,4,5,6,7,8,27,27,27], 'pure0', 27, [global.__PUNG(27)]) === null,
   global.__claim([0,0,1,2,3,4,5,6,7,8,27,27,27], 'pure0', 27, [global.__PUNG(27)]));
// 碰碰胡不吃顺子
const pungHand = [0,0,0,9,9,9,18,18,18,27,27,2,5];
ok('碰碰胡 不吃顺子', global.__claim(pungHand, 'pung', 12, [global.__CHOW([12,13,14], 12)]) === null,
   global.__claim(pungHand, 'pung', 12, [global.__CHOW([12,13,14], 12)]));
ok('碰碰胡 可碰刻子', !!global.__claim(pungHand, 'pung', 2, [global.__PUNG(2)]), null);
// 有胡必和不受花色约束
const huOpt = { k:'hu', tile:13 };
ok('清混碰下「有和必和」仍优先（胡不受花色锁）',
   !!(global.__claim(mixHand, 'mix0', 13, [huOpt, global.__PUNG(13)]) || {}).k &&
   global.__claim(mixHand, 'mix0', 13, [huOpt, global.__PUNG(13)]).k === 'hu',
   global.__claim(mixHand, 'mix0', 13, [huOpt, global.__PUNG(13)]));

console.log('== 5) 敲麻模式：行为不变（花色锁不生效） ==');
global.__setLaji(true);
ok('敲麻下仍可走平胡 std 目标', global.__targetOf([0,1,2,9,10,11,18,19,20,3,4,5,6]) === 'std',
   global.__targetOf([0,1,2,9,10,11,18,19,20,3,4,5,6]));
ok('敲麻下不施加花色锁（源码：lajiHu 时 plan 为 null）',
   /const plan = CFG\.lajiHu \? null : aiPlan\(p\);/.test(html), null);
ok('清混碰下才按目标牌型算收益（源码 keyOf）', /const keyOf = /.test(html), null);

console.log('== 6) 中发白：敲麻算花 / 清混碰算牌（v1.2.17 需求纠正） ==');
let allFlower = true;
for (let t = 108; t <= 119; t++) if (!global.__isFlower(t)) allFlower = false;
ok('敲麻形态 108~119（中發白各 4 张）仍是花牌', allFlower, null);
ok('清混碰形态 31~33（中/發/白）不是花', [31, 32, 33].every(t => !global.__isFlower(t)), null);
ok('编码空间到 33（PLAYCNT=34，0~33 全可组牌）', global.__PLAYCNT === 34, global.__PLAYCNT);
ok('風牌仍是组牌牌（27 不是花）', global.__isFlower(27) === false, null);
ok('清混碰中发白名字正确（中/發/白）', (() => {
  const s = global.__tileName ? global.__tileName : null;
  return !s || (s(31) === '中' && s(32) === '發' && s(33) === '白');
})(), null);
ok('花牌编码形态字符仍正确（中/發/白）',
   global.__flowerChar(108) === '中' && global.__flowerChar(112) === '發' && global.__flowerChar(116) === '白',
   [global.__flowerChar(108), global.__flowerChar(112), global.__flowerChar(116)]);

console.log('== 7) 圆心：无人决策时留空 ==');
const src = html;
ok('renderTurnClock 无决策时写空串', /el\.textContent = s > 0 \? String\(s\) : '';/.test(src), null);
ok('圆心不再写「——」占位', src.indexOf("s > 0 ? s : '——'") < 0, null);

console.log(`\n结果: ✅ ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
