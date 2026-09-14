/**
 * v1.2.48：吃牌禁打 —— 「隔三张」必须**连成 4 张连片**才生效
 *   牌值：0-8 万、9-17 筒、18-26 条、27-33 字牌（东南西北中发白）
 *   规则：吃进 X 后，只有当 X 能与手里（含这副顺子）连成 4 张连片时，
 *         连片另一端的 X±3 才不能打。
 *     · 吃 4 万 + 手里 5、6（顺子 4-5-6）→ 7 万禁打
 *     · 吃 4 万 + 手里只有 3、5（顺子 3-4-5，够不到 7）→ 7 万照常可打
 *   碰只禁刚碰进的那一张，永不牵连。
 */
const E = require('../proto/server/engine.js');

let pass = 0, fail = 0;
function eq(name, got, want){
  const g = JSON.stringify(got) + '', w = JSON.stringify(want) + '';
  if (g === w){ pass++; console.log('  ✔ ' + name + '  = ' + g); }
  else { fail++; console.log('  ✘ ' + name + '\n      实际 ' + g + '\n      期望 ' + w); }
}
// F = 无关填充牌（1~4 筒），避免「手牌全禁则放开」干扰判断
const F = [9, 10, 11, 12];
function mk(hand, melds, noDiscard, kind){
  return { hand: hand.slice(), melds: melds || [], idx: 0, name: '测试',
    noDiscard: (noDiscard == null ? null : noDiscard), noDiscardKind: kind || null, menqing: false };
}
const chow = (tiles, tile) => [{ type: 'chow', tiles: tiles, tile: tile, from: 2, concealed: false }];
// 万：1万=0 2万=1 3万=2 4万=3 5万=4 6万=5 7万=6 ｜ 条：3条=20 4条=21 5条=22 6条=23 7条=24 8条=25 9条=26

console.log('\n【1】用户的两个例子：吃 4 万（X=3）');
eq('手里 5、6、7 万（顺子 4-5-6）→ 7 万(6) 禁',
   E.banTilesOf(mk([6].concat(F), chow([3, 4, 5], 3), 3, 'chow')), [6]);
eq('手里只有 3、5、7 万（顺子 3-4-5，够不到 7）→ 7 万(6) 不禁',
   E.banTilesOf(mk([6].concat(F), chow([2, 3, 4], 3), 3, 'chow')), []);
eq('反向：顺子 2-3-4 万 + 手里 1 万 → 1-2-3-4 连片，1 万(0) 禁',
   E.banTilesOf(mk([0].concat(F), chow([1, 2, 3], 3), 3, 'chow')), [0]);
eq('顺子 2-3-4 万 + 手里 5、6、7 万 → 7 万(6) 禁（中间张在手上也算连片）',
   E.banTilesOf(mk([4, 5, 6].concat(F), chow([1, 2, 3], 3), 3, 'chow')), [6]);
eq('顺子 2-3-4 万 + 手里 5、7 万（缺 6 万）→ 7 万不禁',
   E.banTilesOf(mk([4, 6].concat(F), chow([1, 2, 3], 3), 3, 'chow')), []);

console.log('\n【2】吃 6 条（X=23）：同样需要连片');
eq('手里 7、8、9 条（顺子 6-7-8）→ 9 条(26) 禁',
   E.banTilesOf(mk([26].concat(F), chow([23, 24, 25], 23), 23, 'chow')), [26]);
eq('手里 4、5、9 条（顺子 4-5-6，够不到 9）→ 9 条(26) 不禁',
   E.banTilesOf(mk([26].concat(F), chow([22, 23, 24], 23), 23, 'chow')), []);
eq('手里 3、4、5 条（顺子 4-5-6）→ 3 条(20) 禁',
   E.banTilesOf(mk([20].concat(F), chow([22, 23, 24], 23), 23, 'chow')), []);
eq('手里 5、7 条（缺 8，够不到 9）→ 不禁',
   E.banTilesOf(mk([22, 24].concat(F), chow([23, 24, 25], 23), 23, 'chow')), []);

console.log('\n【3】吃进的那张牌本身仍按原规则禁（与连片无关）');
eq('吃 4 万 + 手里还有第 4 张 4 万 → 禁 4 万',
   E.banTilesOf(mk([3].concat(F), chow([2, 3, 4], 3), 3, 'chow')), [3]);

console.log('\n【4】越界与跨花色');
eq('吃 9 条(26)（顺子 7-8-9）+ 手里 6 条 → 6 条(23) 禁',
   E.banTilesOf(mk([23].concat(F), chow([24, 25, 26], 26), 26, 'chow')), [23]);
eq('吃 9 条：26+3 落到字牌 → 不跨花色（手里有字牌也不禁）',
   E.banTilesOf(mk([27, 28].concat(F), chow([24, 25, 26], 26), 26, 'chow')), []);
eq('吃 1 万(0)：0-3 越界（不牵连）；+3 方向 4 万成片 → 4 万(3) 禁',
   E.banTilesOf(mk([3].concat(F), chow([0, 1, 2], 0), 0, 'chow')), [3]);
eq('吃 1 万：手里只有 5 万（不成片）→ 不禁',
   E.banTilesOf(mk([4].concat(F), chow([0, 1, 2], 0), 0, 'chow')), []);

console.log('\n【5】碰只禁同一张（吃管吃、碰管碰）');
const PUNG5D = [{ type: 'pung', tiles: [13, 13, 13], tile: 13, from: 2, concealed: false }];
const PUNG_E = [{ type: 'pung', tiles: [27, 27, 27], tile: 27, from: 2, concealed: false }];
eq('碰 5 筒 → 4 筒 / 6 筒 不禁',
   E.banTilesOf(mk([12, 14].concat(F), PUNG5D, 13, 'pung')), []);
eq('碰 5 筒 + 手里第 4 张 → 只禁 5 筒',
   E.banTilesOf(mk([13, 12].concat(F), PUNG5D, 13, 'pung')), [13]);
eq('碰东 + 手里第 4 张东 → 仍禁（字牌无隔三张）',
   E.banTilesOf(mk([27, 28].concat(F), PUNG_E, 27, 'pung')), [27]);
eq('碰东 → 南(28) 不禁', E.banTilesOf(mk([28, 29].concat(F), PUNG_E, 27, 'pung')), []);

console.log('\n【6】边界：不能把手牌全禁');
eq('手里只剩 9 条、吃 6 条成片 → 放开（否则无牌可打）',
   E.banTilesOf(mk([26], chow([23, 24, 25], 23), 23, 'chow')), []);
eq('手里 9 条 + 1 张无关牌 → 只禁 9 条',
   E.banTilesOf(mk([26, 5], chow([23, 24, 25], 23), 23, 'chow')), [26]);

console.log('\n【7】大吊车例外（4 副露）');
eq('4 副露时限制全解除',
   E.banTilesOf(mk([26, 20].concat(F),
     [{ type: 'chow', tiles: [23, 24, 25], tile: 23, from: 2 },
      { type: 'pung', tiles: [0, 0, 0], tile: 0, from: 1 },
      { type: 'pung', tiles: [9, 9, 9], tile: 9, from: 2 },
      { type: 'pung', tiles: [18, 18, 18], tile: 18, from: 3 }], 23, 'chow')), []);

console.log('\n【8】出牌后限制解除');
eq('noDiscard 为空 → 不限制', E.banTilesOf(mk([26, 20].concat(F), chow([23, 24, 25], 23), null, null)), []);
eq('kind=pung 但 noDiscard 为空 → 不限制', E.banTilesOf(mk([13, 20].concat(F), PUNG5D, null, 'pung')), []);

console.log('\n【9】AI 不会打出禁牌');
{
  const p = mk([4, 5, 6, 9, 10, 11, 12, 13, 14, 18, 19], chow([3, 4, 5], 3), 3, 'chow');
  const bans = E.banTilesOf(p);
  eq('禁牌 = 7 万(6)', bans, [6]);
  eq('AI 选的牌不在禁牌里', bans.indexOf(E.aiChooseDiscard(p, bans)) < 0, true);
  eq('传入数组同样生效', E.aiChooseDiscard(p, [6]) !== 6, true);
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
