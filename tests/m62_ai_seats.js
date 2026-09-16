// m62：v1.3.1 机器人按座位分别设置
//
//  「哪台机器人用大模型、哪台走本地逻辑」这件事要在两处落地，各有一个安全边界：
//    · 引擎侧（单机 + 服务端共用一份）：aiSeatOn(idx) 说了算 ——
//      设成「不用AI」的座位**根本不问模型**（连请求都不发，零额度零延迟）；
//    · 房间规则侧：cfg.aiSeats / cfg.spd 必须被校验成「长度正好 4 的数组」，
//      否则房主端一旦发出畸形数据，服务端就会把 CFG 写成脏值。
//  另外每台机器人各自的速度（spdOf）也是按座位取的，不能回退成全桌一个值。
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
const HAND = ['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','2p','3p','5p'];

(async () => {
  const S = boot({ instant: false });
  const st = S.__state, CFG = st.CFG, G = st.G;
  S.initGame();
  const P2 = G.players[2];                      // 对家（本地视角的座位 2）
  const P1 = G.players[1];                      // 下家（座位 1）
  const P0 = G.players[0];                      // 我（真人座位）
  function reset(p){
    p.melds = []; p.flowers = []; p.discards = []; p.knocked = false; p.missHu = new Set();
    p.target = null; p.aiWhy = ''; p.hand = mk(HAND);
  }
  function fakeAsk(reply){
    const box = { calls: 0, last: null };
    box.brain = { ask: payload => { box.calls++; box.last = payload; return Promise.resolve(reply); } };
    return box;
  }

  console.log('== 1) aiSeatOn：默认用 AI，显式关掉才不用 ==');
  {
    ok('CFG 默认值就是「四个座位都用」', JSON.stringify(CFG.aiSeats) === JSON.stringify([true, true, true, true]), CFG.aiSeats);
    ok('缺省（老存档 / 老房间规则没这个键）→ 用 AI', S.aiSeatOn(2) === true);
    CFG.aiSeats = [true, true, false, true];
    ok('座位 2 设 false → 不用 AI', S.aiSeatOn(2) === false);
    ok('别的座位不受影响', S.aiSeatOn(1) === true && S.aiSeatOn(3) === true);
    CFG.aiSeats = [true, true, true, true];
    ok('复位后又能用', S.aiSeatOn(2) === true);
  }

  console.log('== 2) spdOf：每台机器人各自的速度，没设过的用全局值 ==');
  {
    CFG.speed = 1.8;
    CFG.spd = [1, 1, 1, 1];
    ok('四个座位都在默认中档', S.spdOf(P2) === 1);
    CFG.spd[2] = 0.6;
    ok('座位 2 单独设慢 → 取 0.6', S.spdOf(P2) === 0.6);
    ok('座位 1 仍是中档', S.spdOf(P1) === 1);
    ok('真人座位不受影响（走全局）', S.spdOf(P0) === 1.8);
    CFG.spd[3] = 0;                              // 脏值兜底
    ok('脏值（0）→ 退回全局速度', S.spdOf(G.players[3]) === 1.8);
    CFG.spd[3] = null;
    ok('空值 → 退回全局速度', S.spdOf(G.players[3]) === 1.8);
    CFG.spd = [1, 1, 1, 1]; CFG.speed = 1;
  }

  console.log('== 3) 出牌：设成「不用AI」的座位连请求都不发 ==');
  {
    reset(P2); reset(P1);
    // 模型会给「五筒」，而本地启发式在这个牌型下会给别的牌 —— 用这个差异判断谁在出牌
    const box = fakeAsk({ discard: '五筒', reason: '留搭子' });
    S.setAiBrain(box.brain, 'strong');

    const local1 = S.aiChooseDiscard(P1, []);
    const local2 = S.aiChooseDiscard(P2, []);
    CFG.aiSeats = [true, true, true, true];
    const d2 = await S.decideDiscard(P2, []);
    ok('座位 2「用AI」→ 采用模型的牌', d2 === T['5p'], [d2, T['5p']]);
    ok('确实问了一次', box.calls === 1, box.calls);

    box.calls = 0;
    CFG.aiSeats = [true, false, true, true];      // 座位 1 设成不用 AI
    const d1 = await S.decideDiscard(P1, []);
    ok('座位 1「不用AI」→ 走本地逻辑', d1 === local1, [d1, local1]);
    ok('座位 1「不用AI」→ 一次请求都没发', box.calls === 0, box.calls);

    box.calls = 0;
    CFG.aiSeats = [true, true, false, true];      // 座位 2 设成不用 AI
    const d2b = await S.decideDiscard(P2, []);
    ok('座位 2 关掉后也走本地逻辑', d2b === local2, [d2b, local2]);
    ok('且同样不发请求', box.calls === 0, box.calls);
    CFG.aiSeats = [true, true, true, true];
  }

  console.log('== 4) 吃碰杠：同样按座位放行 ==');
  {
    const opts = [
      { k: 'pung', tile: T['1p'], combo: null },
      { k: 'chow', tile: T['1p'], combo: mk(['1p', '2p', '3p']) }
    ];
    reset(P2);
    const box = fakeAsk({ action: '碰', reason: '进张' });
    S.setAiBrain(box.brain, 'strong');
    const l2 = S.aiClaim(P2, T['1p'], 3, opts, true);
    CFG.aiSeats = [true, true, true, true];
    const m2 = await S.decideClaim(P2, T['1p'], 3, opts, true);
    ok('座位 2「用AI」→ 模型定夺', !!m2 && m2.k === 'pung', m2);

    box.calls = 0;
    CFG.aiSeats = [true, true, false, true];
    const m2b = await S.decideClaim(P2, T['1p'], 3, opts, true);
    ok('座位 2「不用AI」→ 本地答案', JSON.stringify(m2b) === JSON.stringify(l2), [m2b, l2]);
    ok('且一次请求都没发', box.calls === 0, box.calls);
    CFG.aiSeats = [true, true, true, true];
    S.setAiBrain(null, 'local');
  }

  console.log('== 5) 房间规则：cfg.aiSeats / cfg.spd 的校验与默认值 ==');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
    const i = src.indexOf('const CFG_ALLOW =');
    const j = src.indexOf('class Room {');
    if (i < 0 || j < 0 || j <= i){
      console.log('✗ 无法从 server.js 抽出 CFG_ALLOW / defaultCfg（结构变了？请同步更新本测试）');
      process.exit(1);
    }
    const G2 = new Function(src.slice(i, j) + '; return { CFG_ALLOW: CFG_ALLOW, defaultCfg: defaultCfg };')();
    const ALLOW = G2.CFG_ALLOW, def = G2.defaultCfg();

    ok('defaultCfg 带 aiSeats（默认四台都用 AI）', JSON.stringify(def.aiSeats) === JSON.stringify([true, true, true, true]), def.aiSeats);
    ok('defaultCfg 带 spd（默认全中档）', JSON.stringify(def.spd) === JSON.stringify([1, 1, 1, 1]), def.spd);
    ok('两个键的长度都是 4（下标 = 真实座位号）', def.aiSeats.length === 4 && def.spd.length === 4);

    ok('aiSeats 接受长度 4 的数组', JSON.stringify(ALLOW.aiSeats([true, false, true, false])) === JSON.stringify([true, false, true, false]));
    ok('aiSeats 兼容 1 / 0', JSON.stringify(ALLOW.aiSeats([1, 0, 1, 0])) === JSON.stringify([true, false, true, false]));
    ok('aiSeats 拒绝长度 3', ALLOW.aiSeats([true, true, true]) === null);
    ok('aiSeats 拒绝长度 5', ALLOW.aiSeats([true, true, true, true, true]) === null);
    ok('aiSeats 拒绝非数组', ALLOW.aiSeats('on') === null && ALLOW.aiSeats(null) === null);

    ok('spd 接受 0.6 / 1 / 1.8', JSON.stringify(ALLOW.spd([0.6, 1, 1.8, 1])) === JSON.stringify([0.6, 1, 1.8, 1]));
    ok('spd 把字符串数字转成数字', JSON.stringify(ALLOW.spd(['0.6', '1.8', 1, 1])) === JSON.stringify([0.6, 1.8, 1, 1]));
    ok('spd 拒绝非法档位', ALLOW.spd([0.6, 2, 1, 1]) === null);
    ok('spd 拒绝长度不对', ALLOW.spd([1, 1, 1]) === null && ALLOW.spd([1, 1, 1, 1, 1]) === null);
    ok('spd 拒绝非数组', ALLOW.spd(null) === null);

    ok('旧的全局 speed 键仍然在（老客户端 / 兜底值）', typeof ALLOW.speed === 'function' && ALLOW.speed(1.8) === 1.8);
    ok('房间规则里的两个新键会被写进引擎 CFG',
      /'speed', 'aiSeats', 'spd'/.test(src), src.match(/for \(const k of \[[^\]]*\]\)/)[0]);
  }

  console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
