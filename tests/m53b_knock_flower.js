// m53b：定向复现「敲麻听牌后 摸到花 → 补花 → 打出」
//  1) 直接调 discardTurn：knocked + 有起手花待补 + 刚摸的牌 → 必须打刚摸的那张
//  2) 大样本：knocked 玩家「这一手摸过花」后出牌，必须仍是 p.drawn
const { boot } = require('../proto/server/headless');
const { handSeed } = require('../proto/server/rng');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ❌ FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };
const T = { '1m':0,'2m':1,'3m':2,'4m':3,'5m':4,'6m':5,'7m':6,'8m':7,'9m':8,
  '1p':9,'2p':10,'3p':11,'4p':12,'5p':13,'6p':14,'7p':15,'8p':16,'9p':17,
  '1s':18,'2s':19,'3s':20,'4s':21,'5s':22,'6s':23,'7s':24,'8s':25,'9s':26,
  'E':27,'S':28,'W':29,'N':30,'Z':31,'F':32,'B':33 };
const mk = l => l.map(k => T[k]);
// 花牌：敲麻 = 季花(120~127) + 中发白(108~119)。用 120 当一张季花。
const FLOWER = 120;

function mkPlayer(o){
  return Object.assign({ idx:0, hand:[], melds:[], flowers:[], discards:[], menqing:false,
    knocked:true, isBot:false, missHu:new Set(), pendingFlowers:[], drawn:null,
    drawnCount:0, noPromptSig:'', noDiscard:null, noDiscardKind:null, knockWaits:[] }, o);
}

(async () => {
  // 统一的「起手建局」：initGame 不建墙（那是 runHand 的事），这里手动建好并按需安排牌尾
  function fresh(seed){
    const S = boot({ seed: handSeed(seed, 1, 0), instant: true });
    const st = S.__state, G = st.G, CFG = st.CFG;
    S.initGame();
    CFG.lajiHu = true; CFG.speed = 8;
    for (const p of G.players) p.isBot = true;
    G.wall = S.buildWall();
    G.wpos = 0; G.wtail = G.wall.length - 1;
    return { S, st, G, CFG };
  }
  // 把牌尾安排成 tailSpec（从牌尾往回数），返回时牌尾已就位
  function rigTail(G, tailSpec){
    for (let i = 0; i < tailSpec.length; i++) G.wall[G.wtail - i] = tailSpec[i];
  }

  console.log('== 1) 直接调 discardTurn：knocked + 起手花待补 ==');
  {
    const { S, st, G } = fresh(555);
    rigTail(G, [T['9s']]);                  // 补花摸上来的是 9索（非花）
    const p = G.players[0];
    p.hand = mk(['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','1p']);
    p.melds = []; p.flowers = [];
    p.pendingFlowers = [FLOWER];            // 有一张起手花还没补
    p.knocked = true; p.knockWaits = [T['1p']];
    p.drawn = T['1p'];                       // 刚从墙上摸到 1筒
    p.hand.push(T['1p']);                    // 12 张听牌 + 摸张
    G.running = true; G.turn = 0;
    const before = p.hand.length;

    const d = await S.discardTurn(p, T['1p'], false);
    ok('knocked + 待补花：打出的仍是刚摸的 1筒', d === T['1p'], { d, drawn: T['1p'] });
    ok('起手花已补进 flowers', p.flowers.indexOf(FLOWER) >= 0, p.flowers.length);
    ok('补进的牌进了手牌（before+1-1）', p.hand.length === before, { before, after: p.hand.length });
    ok('p.drawn 已清空', p.drawn === null, p.drawn);
    ok('打掉一张 1筒后手里还剩 2 张（原本 3 张：2 听牌 + 1 摸张）',
       p.hand.filter(x => x === T['1p']).length === 2, p.hand.filter(x => x === T['1p']).length);
  }

  console.log('\n== 2) 直接调 discardTurn：knocked + 补上来的又是花（循环补）==');
  {
    const { S, st, G } = fresh(556);
    const want = T['9m'];
    rigTail(G, [FLOWER, FLOWER, want]);     // drawTail 从牌尾往回拿：花、花、9万
    const p = G.players[0];
    p.hand = mk(['1m','2m','3m','4m','5m','6m','7m','8m','1p','1p']);
    p.melds = []; p.flowers = []; p.pendingFlowers = [FLOWER];
    p.knocked = true; p.knockWaits = [T['1p']];
    p.drawn = want; p.hand.push(want);
    G.running = true; G.turn = 0;

    const d = await S.discardTurn(p, want, false);
    ok('循环补花后仍打刚摸的那张', d === want, { d, want });
    ok('三张花都进了 flowers', p.flowers.filter(x => x === FLOWER).length === 3,
       p.flowers.filter(x => x === FLOWER).length);
  }

  console.log('\n== 2b) 防御：drawn 参数是「手里根本没有的牌」时不能硬打 ==');
  {
    const { S, st, G } = fresh(557);
    const p = G.players[0];
    p.hand = mk(['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','1p','2p']);
    p.melds = []; p.flowers = []; p.pendingFlowers = [];
    p.knocked = true; p.knockWaits = [T['1p']];
    p.drawn = T['2p'];
    G.running = true; G.turn = 0;
    // 故意传一个不在手里的牌（模拟任何路径给出的脏 drawn）
    const d = await S.discardTurn(p, 99, false);
    ok('脏 drawn → 绝不打 99（不在手里）', d !== 99, d);
    ok('脏 drawn → 打的是手里真实有的牌', p.hand.concat([d]).indexOf(d) >= 0, { d, hand: p.hand });
    ok('出牌后手牌数 -1（12 → 11）', p.hand.length === 11, p.hand.length);
  }

  console.log('\n== 2c) 防御：drawn 参数漏传时，用 p.drawn 兜底（而不是打手牌）==');
  {
    const { S, st, G } = fresh(558);
    rigTail(G, [T['8s']]);
    const p = G.players[0];
    p.hand = mk(['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','1p','2p']);
    p.melds = []; p.flowers = []; p.pendingFlowers = [];
    p.knocked = true; p.knockWaits = [T['1p']];
    p.drawn = T['2p']; p.hand.push(T['2p']);       // 刚摸到 2筒
    G.running = true; G.turn = 0;
    const d = await S.discardTurn(p, null, false);  // 模拟调用方漏传 drawn
    ok('漏传 drawn → 用 p.drawn 兜底（打刚摸的 2筒）', d === T['2p'], { d, drawn: p.drawn });
  }

  console.log('\n== 3) 大样本：已敲定 + 「这手摸过花」后出牌 ==');
  {
    const HANDS = Number(process.env.M53B_HANDS || 200);
    const records = [];
    let huCount = 0;
    for (let h = 0; h < HANDS; h++){
      const S = boot({ seed: handSeed(9000 + h, 1, 0), instant: true });
      const st = S.__state;
      S.initGame();
      for (const p of st.G.players) p.isBot = true;
      st.CFG.lajiHu = true; st.CFG.autoKnock = true; st.CFG.autoHu = true; st.CFG.speed = 8;
      for (const p of st.G.players){
        let cur = p.discards || [];
        Object.defineProperty(p, 'discards', { configurable: true,
          get(){ return cur; },
          set(v){
            cur = v;
            const real = cur.push.bind(cur);
            cur.push = function(t){
              records.push({ idx: p.idx, tile: t,
                drawn: (p.drawn === undefined ? '__undef__' : p.drawn),
                knocked: !!p.knocked, flowers: (p.flowers || []).length,
                handLen: (p.hand || []).length, melds: (p.melds || []).length });
              return real(t);
            };
          }});
      }
      try{ await S.runHand(); }catch(e){ console.log('  局 ' + h + ' 异常: ' + e.message); }
      if (st.G.result && st.G.result.html && st.G.result.html.indexOf('荒庄') < 0) huCount++;
    }
    const kn = records.filter(r => r.knocked);
    const bad = kn.filter(r => r.drawn !== r.tile);
    // 「这手摸过花」= 与该玩家上一次出牌相比 flowers 增加
    const lastF = {}; let flowerCase = 0, flowerBad = 0;
    for (const r of records){
      const prev = lastF[r.idx];
      if (r.knocked && prev !== undefined && r.flowers > prev){
        flowerCase++;
        if (r.drawn !== r.tile) flowerBad++;
      }
      lastF[r.idx] = r.flowers;
    }
    console.log('局数 ' + HANDS + '（胡 ' + huCount + '）| 已敲定出牌 ' + kn.length +
                ' 次 | 摸过花后出牌 ' + flowerCase + ' 次 | 打错 ' + bad.length + ' 次');
    for (const b of bad.slice(0, 8))
      console.log('   座' + b.idx + ' 打 ' + b.tile + ' 但 drawn=' + b.drawn + ' | 手牌数=' + b.handLen + ' 花=' + b.flowers);
    ok('大样本：已敲定玩家从不打错牌', bad.length === 0, bad.length);
    ok('大样本：摸过花后出牌也不打错', flowerBad === 0, flowerBad);
    ok('覆盖到「摸过花后出牌」场景', flowerCase > 0, flowerCase);
  }

  console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
