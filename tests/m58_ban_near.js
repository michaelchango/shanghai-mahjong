/**
 * v1.2.47h：吃牌「隔三张不能打」规则测试（吃管吃、碰管碰）
 *   牌值：0-8 万、9-17 筒、18-26 条、27-33 字牌（东南西北中发白）
 *   规则：吃进 X → 同花色中与 X 相隔 3 张的牌（X-3 / X+3）也不能打。
 *         例：吃 6 条(23) → 3 条(20) / 9 条(26) 不能打；5 条(22) / 7 条(24) 可以。
 *         碰只禁刚碰进的那一张，不牵连。
 */
const E = require('../proto/server/engine.js');

let pass = 0, fail = 0;
function eq(name, got, want){
  const g = JSON.stringify(got) + '', w = JSON.stringify(want) + '';
  if (g === w){ pass++; console.log('  ✔ ' + name + '  = ' + g); }
  else { fail++; console.log('  ✘ ' + name + '\n      实际 ' + g + '\n      期望 ' + w); }
}
function mk(hand, melds, noDiscard, kind){
  return { hand: hand.slice(), melds: melds || [], idx: 0, name: '测试',
    noDiscard: (noDiscard == null ? null : noDiscard), noDiscardKind: kind || null, menqing: false };
}
const CHOW6T = [{ type: 'chow', tiles: [23, 24, 25], tile: 23, from: 2, concealed: false }];  // 6-7-8 条
const PUNG5D = [{ type: 'pung', tiles: [13, 13, 13], tile: 13, from: 2, concealed: false }];  // 5 筒
const PUNG_E = [{ type: 'pung', tiles: [27, 27, 27], tile: 27, from: 2, concealed: false }];  // 东

console.log('\n【1】吃 6 条（X=23）→ 隔三张：3 条(20) / 9 条(26)');
eq('手里有 3 条 → 禁', E.banTilesOf(mk([20, 0, 1, 2, 5, 5], CHOW6T, 23, 'chow')), [20]);
eq('手里有 9 条 → 禁', E.banTilesOf(mk([26, 0, 1, 2, 5, 5], CHOW6T, 23, 'chow')), [26]);
eq('手里 3 条 + 9 条 → 两张都禁', E.banTilesOf(mk([20, 26, 0, 1, 2, 5], CHOW6T, 23, 'chow')), [20, 26]);
eq('手里 5 条(22) 不受限', E.banTilesOf(mk([22, 0, 1, 2, 5, 5], CHOW6T, 23, 'chow')), []);
eq('手里 7 条(24) 不受限', E.banTilesOf(mk([24, 0, 1, 2, 5, 5], CHOW6T, 23, 'chow')), []);
eq('手里 5 条 + 7 条 都不受限', E.banTilesOf(mk([22, 24, 0, 1, 2, 5], CHOW6T, 23, 'chow')), []);
eq('手里还有第 4 张 6 条 → 6 条仍禁（原规则）', E.banTilesOf(mk([23, 20, 0, 1, 2, 5], CHOW6T, 23, 'chow')), [23, 20]);

console.log('\n【2】越界与跨花色不误禁');
eq('吃 9 条(26)：26+3 越界 → 只牵连 23（6 条）',
   E.banTilesOf(mk([23, 0, 1, 2, 5, 5], [{type:'chow',tiles:[24,25,26],tile:26}], 26, 'chow')), [23]);
eq('吃 1 万(0)：0-3 越界 → 只牵连 3（四万）',
   E.banTilesOf(mk([3, 9, 10, 11, 12, 5], [{type:'chow',tiles:[0,1,2],tile:0}], 0, 'chow')), [3]);
eq('吃 7 条(24)：24+3=27 是字牌 → 不跨花色，字牌不禁',
   E.banTilesOf(mk([27, 21, 0, 1, 2, 5], [{type:'chow',tiles:[24,25,26],tile:24}], 24, 'chow')), [21]);

console.log('\n【3】碰只禁同一张（吃管吃、碰管碰）');
eq('碰 5 筒 → 4 筒 / 6 筒 不禁',
   E.banTilesOf(mk([12, 14, 0, 1, 2, 5], PUNG5D, 13, 'pung')), []);
eq('碰 5 筒 + 手里第 4 张 → 只禁 5 筒',
   E.banTilesOf(mk([13, 12, 0, 1, 2, 5], PUNG5D, 13, 'pung')), [13]);
eq('碰 5 筒 → 与「隔三张」无关的 2 筒 / 8 筒 也不禁',
   E.banTilesOf(mk([11, 17, 0, 1, 2, 5], PUNG5D, 13, 'pung')), []);

console.log('\n【4】字牌没有「隔三张」概念');
eq('碰东 → 南(28) 不禁', E.banTilesOf(mk([28, 29, 0, 1, 2, 5], PUNG_E, 27, 'pung')), []);
eq('碰东 + 手里第 4 张东 → 仍禁', E.banTilesOf(mk([27, 28, 0, 1, 2, 5], PUNG_E, 27, 'pung')), [27]);

console.log('\n【5】边界：不能把手牌全禁');
eq('手里只剩 9 条，吃 6 条 → 放开', E.banTilesOf(mk([26], CHOW6T, 23, 'chow')), []);
eq('手里 9 条 + 1 张无关牌 → 只禁 9 条', E.banTilesOf(mk([26, 5], CHOW6T, 23, 'chow')), [26]);

console.log('\n【6】大吊车例外（4 副露）');
eq('4 副露时限制全解除',
   E.banTilesOf(mk([26, 20, 1, 2, 5, 5],
     [{type:'chow',tiles:[23,24,25],tile:23,from:2},
      {type:'pung',tiles:[0,0,0],tile:0,from:1},
      {type:'pung',tiles:[9,9,9],tile:9,from:2},
      {type:'pung',tiles:[18,18,18],tile:18,from:3}], 23, 'chow')), []);

console.log('\n【7】出牌后限制解除');
eq('noDiscard 为空 → 不限制', E.banTilesOf(mk([26, 20, 1, 2, 5, 5], CHOW6T, null, null)), []);

console.log('\n【8】AI 不会打出禁牌');
{
  const p = mk([26, 20, 23, 22, 24, 0, 1, 2, 5, 5, 9, 9, 10, 10], CHOW6T, 23, 'chow');
  const bans = E.banTilesOf(p);
  const d = E.aiChooseDiscard(p, bans);
  eq('禁牌 = 3 条 + 9 条 + 第 4 张 6 条', bans, [23, 20, 26]);
  eq('AI 选的牌不在禁牌里', bans.indexOf(d) < 0, true);
  const d2 = E.aiChooseDiscard(p, [26]);
  eq('传数组同样生效（不会打出 9 条）', d2 !== 26, true);
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
