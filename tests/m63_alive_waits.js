// m63：v1.3.4 听口有效性 + AI 规则补全
//
//  ① 「听死」这个概念第一次进入规则层：听的牌在台面上已经现完（剩 0 张）——
//     摸不到、别人也打不出，等于没听。凡是「算不算听」的地方都要一致：
//     敲定判定（knockCheck / canKnock）、可敲听提示（potentialKnocks）、
//     顶部与底部的听牌展示、AI 的候选（aiRankDiscards / aiChooseDiscard）。
//     ⚠️ 口径必须统一：只改一处就会出现「提示说听牌、敲下去又胡不了」这种最难受的错位。
//  ② 多个听法之间比「有效听口剩余张数之和」—— 多的优先（最容易胡的那个听法）。
//  ③ 提示词补全 4 个规则缺口：七小对随设置 / 清混碰锁门 / 无花果只能自摸 / 番值梯度。
const fs = require('fs');
const path = require('path');
const { boot } = require('../proto/server/headless');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

const T = { '1m':0,'2m':1,'3m':2,'4m':3,'5m':4,'6m':5,'7m':6,'8m':7,'9m':8,
  '1p':9,'2p':10,'3p':11,'4p':12,'5p':13,'6p':14,'7p':15,'8p':16,'9p':17,
  '1s':18,'2s':19,'3s':20,'4s':21,'5s':22,'6s':23,'7s':24,'8s':25,'9s':26,
  'E':27,'S':28,'W':29,'N':30,'Z':31,'F':32,'B':33 };
const mk = l => l.map(k => T[k]);

// 13 张、听 3s（123m 456m 789m 11p + 1s2s 搭子）
const H13 = ['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','1p','1s','2s'];
// 14 张（多一张 3s）：打 3s 听 3s（单钓）；打 1s 听 1s·4s（两面）
const H14 = ['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','1p','1s','2s','3s'];

(async () => {
  const S = boot({ instant: true });          // instant：knockCheck 里的 await sleep 立刻返回
  const st = S.__state, CFG = st.CFG, G = st.G;
  S.initGame();
  CFG.lajiHu = true;                          // 敲麻（敲定判定只在敲麻走）
  const P0 = G.players[0], P1 = G.players[1], P2 = G.players[2];
  const clearAll = () => {
    for (const p of G.players){
      p.discards = []; p.melds = []; p.flowers = [];
      p.knocked = false; p.knockWaits = []; p.target = null; p.missHu = new Set();
    }
  };
  const myRiver = tiles => { P0.discards = mk(tiles); };

  console.log('== 1) leftFor：4 - 自己手牌 - 四家牌河 - 副露（不算别人手牌） ==');
  {
    clearAll();
    P1.hand = mk(['1m','1m','2m','3m']);
    myRiver(['1m','1m']);
    ok('手牌 2 张 + 牌河 2 张 → 剩 0', S.leftFor(T['1m'], P1) === 0, S.leftFor(T['1m'], P1));
    ok('手里 1 张、没现过 → 剩 3', S.leftFor(T['2m'], P1) === 3, S.leftFor(T['2m'], P1));
    ok('没用的牌 → 剩 4', S.leftFor(T['9s'], P1) === 4);
    P2.melds = [{ type: 'pung', tile: T['2m'], tiles: mk(['2m','2m','2m']) }];
    ok('副露里的同牌也算已见', S.leftFor(T['2m'], P1) === 0, S.leftFor(T['2m'], P1));
    ok('下限是 0（不会算出负数）', S.leftFor(T['1m'], P1) === 0);
    P0.hand = mk(['5m','5m']);
    ok('visibleLeft 就是「以我为视角」的 leftFor（同源同口径）',
      S.visibleLeft(T['5m']) === S.leftFor(T['5m'], P0), [S.visibleLeft(T['5m']), S.leftFor(T['5m'], P0)]);
  }

  console.log('== 2) 听死：形状上听着，但牌全在台面现完 ==');
  {
    clearAll();
    P1.hand = mk(H13);
    const w0 = S.getWaitsHand(P1.hand, []);
    ok('形状上确实听 3s', w0.some(w => w.t === T['3s']), w0.map(w => w.t));
    myRiver(['3s','3s','3s','3s']);
    ok('3s 四张全在牌河 → 剩 0 张', S.leftFor(T['3s'], P1) === 0);
    ok('aliveWaits 把听死的 3s 滤掉', S.aliveWaits(w0, P1).length === 0, S.aliveWaits(w0, P1).map(w => w.t));
    ok('aliveLeft = 0（没有能胡的张）', S.aliveLeft(w0, P1) === 0);
    myRiver(['3s']);                                     // 还剩 3 张
    ok('只现 1 张 → 是活听', S.aliveWaits(w0, P1).length === 1 && S.aliveLeft(w0, P1) === 3, S.aliveLeft(w0, P1));
  }

  console.log('== 3) 敲定：听死牌不敲，继续组牌 ==');
  {
    clearAll();
    P1.hand = mk(H13); P1.isBot = true; P1.knocked = false;
    myRiver(['3s','3s','3s','3s']);
    ok('canKnock：听死 → 不可敲', S.canKnock(P1) === false);
    await S.knockCheck(P1);
    ok('bot 听死牌不敲（未锁定）', P1.knocked === false);
    ok('也没写进 knockWaits', !P1.knockWaits || !P1.knockWaits.length, P1.knockWaits);

    myRiver(['3s','3s']);                                 // 还剩 2 张
    ok('3s 剩 2 张 → 可敲', S.canKnock(P1) === true);
    await S.knockCheck(P1);
    ok('bot 恢复正常敲定', P1.knocked === true);
    ok('敲定记录的是有效听口（含 3s）', (P1.knockWaits || []).indexOf(T['3s']) >= 0, P1.knockWaits);
  }

  console.log('== 4) 可敲听提示：过滤听死的打法、按剩余张数排序 ==');
  {
    clearAll();
    P0.hand = mk(H14); P0.melds = []; P0.knocked = false; P0.isBot = false;
    myRiver(['3s','3s']);                                 // 3s：手里 1 + 河 2 = 3 → 剩 1
    P1.discards = mk(['1s']);                             // 1s：手里 1 + 河 1 = 2 → 剩 2；4s 剩 4
    const ks = S.potentialKnocks(P0);
    const i3 = ks.findIndex(k => k.discard === T['3s']);
    const i1 = ks.findIndex(k => k.discard === T['1s']);
    ok('打 3s（听 1 张）与打 1s（听 6 张）都在候选里', i3 >= 0 && i1 >= 0, ks.map(k => [k.discard, k.left]));
    ok('听口剩余多的打法排前面（1s 两侧 6 张 > 3s 单钓 1 张）', i1 < i3, ks.map(k => [k.discard, k.left]));
    ok('每个听法都至少有一张能胡', ks.every(k => k.left > 0), ks.map(k => k.left));

    myRiver(['3s','3s','3s']);                            // 3s → 剩 0，打 3s 变听死
    P1.discards = mk(['1s','1s','1s']);                   // 1s → 手里 1 张 + 河 3 = 4 → 剩 0
    P2.discards = mk(['4s','4s','4s','4s']);              // 4s → 剩 0
    const ks2 = S.potentialKnocks(P0);
    ok('听死的打法被打掉（打 3s / 打 1s 都不再出现）',
      !ks2.some(k => k.discard === T['3s']) && !ks2.some(k => k.discard === T['1s']),
      ks2.map(k => [k.discard, k.left]));
  }

  console.log('== 5) AI：宁可改听，也不听死牌 ==');
  {
    clearAll();
    P1.hand = mk(H14); P1.melds = []; P1.knocked = false; P1.target = null;
    myRiver(['3s','3s','3s']);                            // 手里 1 + 河 3 = 4 → 打 3s 听死
    const rows = S.aiRankDiscards(P1, [], 20);
    const r3 = rows.find(r => r.t === T['3s']);
    const r1 = rows.find(r => r.t === T['1s']);
    ok('候选里打了就听死的 3s：left 记 0、向听退回 1', !!r3 && r3.left === 0 && r3.sh >= 1, r3);
    ok('打 1s 听 1s·4s：left > 0、向听 0', !!r1 && r1.left > 0 && r1.sh === 0, r1);
    ok('听活的排在听死的前面', rows.indexOf(r1) < rows.indexOf(r3), rows.map(r => [r.t, r.sh, r.left]));

    const d = S.aiChooseDiscard(P1, []);
    ok('出牌不选「打了就听死」的那张', d !== T['3s'], d);
  }

  console.log('== 6) aiView：把「影响选牌的规则状态」交给模型 ==');
  {
    clearAll();
    P1.hand = mk(H13); P1.knocked = false;
    CFG.sevenPairs = false;
    const v1 = S.aiView(P1, 'discard', { bans: [], cand: [] });
    ok('view.mode 告诉模型玩法', v1.mode === '敲麻', v1.mode);
    ok('view.sevenPairs 跟着设置走', v1.sevenPairs === false);
    CFG.sevenPairs = true;
    ok('设置打开时 sevenPairs 为 true', S.aiView(P1, 'discard', { bans: [] }).sevenPairs === true);
    CFG.sevenPairs = false;
    ok('view.lock：敲麻不锁门 → null', v1.lock === null, v1.lock);
    ok('view.wuGuoHua 是布尔', typeof v1.wuGuoHua === 'boolean');
    ok('view.cur 给出当前底 / 番', !!v1.cur && typeof v1.cur.fan === 'number', v1.cur);

    CFG.lajiHu = false;                                    // 清混碰：吃过萬子 → 锁门
    P2.hand = mk(H13);
    P2.melds = [{ type: 'chow', tile: T['3m'], tiles: mk(['2m','3m','4m']), concealed: false }];
    const v2 = S.aiView(P2, 'discard', { bans: [] });
    ok('清混碰吃过萬子 → mode=清混碰、lock=萬', v2.mode === '清混碰' && v2.lock === '萬', [v2.mode, v2.lock]);
    CFG.lajiHu = true;

    const cand = S.aiRankDiscards(P1, [], 4);
    const v3 = S.aiView(P1, 'discard', { bans: [], cand });
    ok('candidates 带上 left（没听牌的不带）',
      v3.candidates.every(c => c.left === undefined || typeof c.left === 'number'), v3.candidates);
  }

  console.log('== 7) 提示词：4 个规则缺口都补上了 ==');
  {
    const brain = require('../proto/server/aibrain');
    const sys = brain.buildMessages('discard', { mode: '清混碰' })[0].content;
    ok('七小对随 view.sevenPairs', /sevenPairs/.test(sys));
    ok('清混碰锁门（view.lock）', /锁门/.test(sys) && /view\.lock/.test(sys));
    ok('无花果只能自摸', /无花果/.test(sys) && /自摸/.test(sys));
    ok('番值梯度：勒子 / 清一色 / 风碰', /勒子/.test(sys) && /清一色/.test(sys) && /风碰/.test(sys));
    ok('玩法差异仍在提示里', /敲麻/.test(sys) && /清混碰/.test(sys));

    const sys2 = brain.buildMessages('discard', { mode: '敲麻', candidates: [{ tile: '一萬' }] })[0].content;
    ok('强档候选说明里讲了 left 的含义', /left/.test(sys2) && /听死/.test(sys2));

    const usr = JSON.parse(brain.buildMessages('discard', { mode: '敲麻' })[1].content);
    ok('user 段带 mode（模型据此知道在玩哪种）', usr.mode === '敲麻');
  }

  console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
