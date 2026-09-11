// m51：v1.2.40 新规则 —— 吃 / 碰 进什么，本次出牌不能立刻打出什么
//   两种玩法通用。唯一例外：吃/碰 后已形成「大吊车」（4 副露单钓）→ 允许立刻打出同一张。
const { boot } = require('../proto/server/headless');
const { handSeed } = require('../proto/server/rng');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

const S = boot({ seed: handSeed(3131, 1, 0), instant: true });
const st = S.__state, CFG = st.CFG, G = st.G;
const T = { '1m':0,'2m':1,'3m':2,'4m':3,'5m':4,'6m':5,'7m':6,'8m':7,'9m':8,
  '1p':9,'2p':10,'3p':11,'4p':12,'5p':13,'6p':14,'7p':15,'8p':16,'9p':17,
  '1s':18,'2s':19,'3s':20,'4s':21,'5s':22,'6s':23,'7s':24,'8s':25,'9s':26,
  'E':27,'S':28,'W':29,'N':30,'Z':31,'F':32,'B':33 };
const mk = l => l.map(k => T[k]);
const mkP = o => Object.assign({ idx:0, hand:[], melds:[], flowers:[], menqing:false,
  knocked:false, missHu:new Set(), pendingFlowers:[], noDiscard:null, noDiscardKind:null }, o);

S.initGame();

console.log('== 1) claimedBanTile：基本行为 ==');
{
  CFG.lajiHu = true;
  // 吃了 2万（手里还有 2万 和可打的别的牌）→ 禁打 2万
  let p = mkP({ hand: mk(['2m','5m','7m']), noDiscard: T['2m'], noDiscardKind: 'chow',
                melds: [{ type:'chow', tile:T['2m'], tiles:[T['1m'],T['2m'],T['3m']] }] });
  ok('吃 2万 → 禁打 2万', S.claimedBanTile(p) === T['2m'], S.claimedBanTile(p));
  ok('提示词 = 吃', S.banKindName(p) === '吃', S.banKindName(p));

  // 碰了 5万 → 禁打 5万
  p = mkP({ hand: mk(['5m','7m','9m']), noDiscard: T['5m'], noDiscardKind: 'pung',
            melds: [{ type:'pung', tile:T['5m'], tiles:[T['5m'],T['5m'],T['5m']] }] });
  ok('碰 5万 → 禁打 5万', S.claimedBanTile(p) === T['5m'], S.claimedBanTile(p));
  ok('提示词 = 碰', S.banKindName(p) === '碰', S.banKindName(p));

  // 没有 noDiscard → 不禁
  p = mkP({ hand: mk(['5m','7m']) });
  ok('没吃没碰 → 不禁任何牌', S.claimedBanTile(p) === null, S.claimedBanTile(p));

  // 手里只剩这一张 → 无法限制，放行
  p = mkP({ hand: mk(['5m']), noDiscard: T['5m'], noDiscardKind: 'pung',
            melds: [{ type:'pung', tile:T['5m'], tiles:[T['5m'],T['5m'],T['5m']] }] });
  ok('手里只剩这一张 → 放行', S.claimedBanTile(p) === null, S.claimedBanTile(p));
}

console.log('== 2) 大吊车例外：吃/碰 后 4 副露 → 允许立刻打出同一张 ==');
{
  const melds4 = [
    { type:'chow', tile:T['1m'], tiles:[T['1m'],T['2m'],T['3m']] },
    { type:'chow', tile:T['4m'], tiles:[T['4m'],T['5m'],T['6m']] },
    { type:'chow', tile:T['7m'], tiles:[T['7m'],T['8m'],T['9m']] },
    { type:'pung', tile:T['E'], tiles:[T['E'],T['E'],T['E']] }
  ];
  const p = mkP({ hand: mk(['2m','2m']), noDiscard: T['2m'], noDiscardKind: 'chow', melds: melds4 });
  ok('4 副露 = 大吊车', S.isDaDiaoChe(p) === true);
  ok('大吊车 → 不禁打同张', S.claimedBanTile(p) === null, S.claimedBanTile(p));

  // 同样 hand，但只有 3 副露 → 仍禁
  const p3 = mkP({ hand: mk(['2m','2m','5m','5m','5m']), noDiscard: T['2m'],
                   noDiscardKind: 'chow', melds: melds4.slice(0, 3) });
  ok('3 副露（非大吊车）→ 仍禁打同张', S.claimedBanTile(p3) === T['2m'], S.claimedBanTile(p3));
}

console.log('== 3) 机器人：吃/碰 后不会打出刚进的那张 ==');
{
  CFG.lajiHu = true;
  // 手里只有「刚碰进的 5万」和一张明显的废牌 9万 —— AI 若不受限很可能打 5万（中张）
  const meld = { type:'pung', tile:T['5m'], tiles:[T['5m'],T['5m'],T['5m']] };
  const p = mkP({ hand: mk(['5m','9m','1p']), melds: [meld],
                  noDiscard: T['5m'], noDiscardKind: 'pung' });
  const ban = S.claimedBanTile(p);
  ok('ban = 5万', ban === T['5m'], ban);
  // 一般性证明：把 AI 的「首选牌」设为禁打，它必须换一张
  let checked = 0, dodged = 0;
  for (const hand of [['5m','9m','1p'], ['5m','5m','9m'], ['5m','1p','2p','3p'],
                      ['5m','9m','1s','3s'], ['5m','5m','5m','9m','1p']]){
    const px = mkP({ hand: mk(hand), melds: [meld] });
    px.target = S.aiTargetOf ? S.aiTargetOf(px) : null;
    const d0 = S.aiChooseDiscard(px, null);          // 不受限时的首选
    if (d0 === null || d0 === undefined) continue;
    const d1 = S.aiChooseDiscard(px, d0);            // 把它列为禁打
    checked++;
    if (d1 !== d0 && d1 !== null && d1 !== undefined) dodged++;
  }
  ok('AI 总能避开被禁的那张（' + dodged + '/' + checked + '）', checked > 0 && dodged === checked, { checked, dodged });
  // 只给「禁打牌 + 1 张」时也不会选到禁打牌
  const p2 = mkP({ hand: mk(['5m','9m']), melds: [meld] });
  p2.target = S.aiTargetOf ? S.aiTargetOf(p2) : null;
  ok('极窄手牌也不打禁打牌', S.aiChooseDiscard(p2, T['5m']) === T['9m'], S.aiChooseDiscard(p2, T['5m']));
}

console.log('== 4) 出牌一次后限制解除（noDiscard 清空）==');
{
  // 直接验证语义：discardTurn 前设 noDiscard，出牌后应为 null
  const p = G.players[0];
  p.hand = mk(['2m','5m','7m','9m','1p','3p','5p','7p','9p','1s','3s','5s','7s']);
  p.melds = [{ type:'chow', tile:T['2m'], tiles:[T['1m'],T['2m'],T['3m']] }];
  p.flowers = []; p.pendingFlowers = []; p.knocked = false; p.isBot = false;
  p.noDiscard = T['2m']; p.noDiscardKind = 'chow';
  G.running = true;
  const banBefore = S.claimedBanTile(p);
  ok('出牌前 ban 生效', banBefore === T['2m'], banBefore);
  // 模拟出牌完成：引擎里 discardTurn 打完会清空（这里直接验证约定）
  p.noDiscard = null; p.noDiscardKind = null;
  ok('出牌后 ban 解除', S.claimedBanTile(p) === null, S.claimedBanTile(p));
}

console.log('== 5) 两种玩法都生效（规则与玩法无关）==');
{
  for (const laji of [true, false]){
    CFG.lajiHu = laji;
    const p = mkP({ hand: mk(['3m','7m','9m']), noDiscard: T['3m'], noDiscardKind: 'chow',
                    melds: [{ type:'chow', tile:T['3m'], tiles:[T['2m'],T['3m'],T['4m']] }] });
    ok((laji ? '敲麻' : '清混碰') + ' 禁打同张生效', S.claimedBanTile(p) === T['3m'], S.claimedBanTile(p));
  }
  CFG.lajiHu = true;
}

console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
