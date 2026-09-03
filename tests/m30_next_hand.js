// m30：服务端 nextHand 多局流转（v1.2.14 问题2排查）
// 验证：一局结束后 nextHand → G.handNo 递增、新局正常开局、投影带新 handNo
const { boot } = require('../proto/server/headless');
const { projectFor } = require('../proto/server/view');
const { handSeed } = require('../proto/server/rng');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

(async () => {
  console.log('== 服务端多局 handNo 流转 ==');
  const S = boot({ seed: handSeed(777, 1, 0), instant: true });
  const st = S.__state;
  S.initGame();
  for (const p of st.G.players) p.isBot = true;
  st.G.handNo = 1; st.G.roundWind = 0;
  await S.runHand();
  ok('局1 正常结束', st.G.finished === true, st.G.finished);
  ok('局1 handNo 仍为 1', st.G.handNo === 1, st.G.handNo);

  // 模拟服务端「准备下一局」触发 nextHand
  const dealer = (st.G.result && st.G.result.dealer) != null ? st.G.result.dealer : 0;
  S.nextHand(dealer);
  // nextHand 内同步 G.handNo++，随即 fire-and-forget runHand()
  ok('nextHand 后 handNo 递增到 2', st.G.handNo === 2, st.G.handNo);
  ok('nextHand 后 finished 重置', st.G.finished === false, st.G.finished);
  await new Promise(r => setTimeout(r, 80));   // 等 instant runHand 推进
  const v = projectFor(S, 0);
  ok('新局投影 handNo = 2', v.table.handNo === 2, v.table.handNo);
  ok('新局投影 roundWind 未越界', v.table.roundWind === 0, v.table.roundWind);

  // 第 4 局后应回第 1 局并进南风
  st.G.handNo = 4;
  S.nextHand(dealer);
  ok('第 5 局 handNo 回 1、roundWind 进南风(1)', st.G.handNo === 1 && st.G.roundWind === 1, [st.G.handNo, st.G.roundWind]);

  console.log('结果: ' + (fail ? '❌ ' + fail + ' 项失败' : '✅ ' + pass + ' 通过 / 0 失败'));
  process.exit(fail ? 1 : 0);
})();
