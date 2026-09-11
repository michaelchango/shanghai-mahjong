// m53：v1.2.41 排查 —— 敲麻听牌（knocked）后「摸到花 → 补花 → 打出」会不会打错牌
// 不变量：已敲定的玩家，每一次打出都必须是「刚摸到的那张」（p.drawn）。
// 用 Object.defineProperty 拦截 p.discards 的重新赋值（runHand 每局都会重建），逐次记录。
const { boot } = require('../proto/server/headless');
const { handSeed } = require('../proto/server/rng');

const HANDS = Number(process.env.M53_HANDS || 120);

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ❌ FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

const records = [];

function instrument(S){
  const G = S.__state.G;
  for (const p of G.players){
    let cur = p.discards || [];
    Object.defineProperty(p, 'discards', {
      configurable: true,
      get(){ return cur; },
      set(v){
        cur = v;
        const real = cur.push.bind(cur);
        cur.push = function(t){
          records.push({
            idx: p.idx, tile: t,
            drawn: (p.drawn === undefined ? '__undef__' : p.drawn),
            knocked: !!p.knocked,
            flowers: (p.flowers || []).length,
            handHas: (p.hand || []).includes(t),
            handLen: (p.hand || []).length
          });
          return real(t);
        };
      }
    });
  }
}

(async () => {
  let huCount = 0, liuju = 0;
  for (let h = 0; h < HANDS; h++){
    const S = boot({ seed: handSeed(7000 + h, 1, 0), instant: true });
    const st = S.__state;
    S.initGame();
    for (const p of st.G.players) p.isBot = true;
    CFG_LOOP: {
      st.CFG.lajiHu = true;            // 敲麻（用户报告的是敲麻）
      st.CFG.autoKnock = false;
      st.CFG.autoHu = false;
    }
    instrument(S);
    try{
      await S.runHand();
    }catch(e){
      console.log('  局 ' + h + ' 异常: ' + e.message);
      fail++;
      continue;
    }
    if (st.G.result && st.G.result.html){
      const r = st.G.result.html;
      if (r.indexOf('荒庄') >= 0 || r.indexOf('流局') >= 0) liuju++; else huCount++;
    }
  }

  console.log('打了 ' + HANDS + ' 局：胡 ' + huCount + ' / 流局 ' + liuju);
  const knockedRecs = records.filter(r => r.knocked);
  console.log('共记录出牌 ' + records.length + ' 次，其中已敲定玩家出牌 ' + knockedRecs.length + ' 次');

  // 不变量：已敲定 ⇒ 打出的必须是 p.drawn
  const bad = knockedRecs.filter(r => r.drawn !== r.tile);
  console.log('其中「打出的不是刚摸那张」的次数：' + bad.length);
  for (const b of bad.slice(0, 12)){
    console.log('   座' + b.idx + ' 打 ' + b.tile + ' 但 p.drawn=' + b.drawn +
                ' | 手里有这张=' + b.handHas + ' | 手牌数=' + b.handLen + ' | 花数=' + b.flowers);
  }

  // 统计「已敲定 + 打出前花数增加（= 摸到花补花）」的场景是否覆盖到
  let flowerThenDiscard = 0;
  const lastFlower = {};
  for (const r of records){
    const prev = lastFlower[r.idx];
    if (r.knocked && prev !== undefined && r.flowers > prev) flowerThenDiscard++;
    lastFlower[r.idx] = r.flowers;
  }
  console.log('已敲定玩家「这手摸过花」后出牌的场景：' + flowerThenDiscard + ' 次');

  ok('已敲定玩家从不打错牌', bad.length === 0, bad.length);
  ok('覆盖到已敲定玩家的出牌场景', knockedRecs.length > 0, knockedRecs.length);

  console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
