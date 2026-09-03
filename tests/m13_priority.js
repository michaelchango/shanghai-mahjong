// 无头验证：collectClaims 分轮顺序（胡 > 杠碰 > 吃）
const { boot } = require('/workspace/shanghai-knock-mahjong/proto/server/headless.js');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n); } };

function mkHarness(){
  const s = boot({ seed: 1, onRender(){}, onToast(){}, onSheet(){} });
  s.initGame();
  const G = s.__state.G;
  for (let i = 0; i < 4; i++){ G.players[i].isBot = false; G.players[i].name = ['我','下家','对家','上家'][i]; }
  return { s, G };
}

async function runCase(claimFn, answerFn){
  const { s, G } = mkHarness();
  s.claimOptions = claimFn;
  const askLog = [];
  s.onAsk = pend => { askLog.push({ kind: pend.kind, seat: pend.seat, payload: pend.payload }); answerFn(s, pend); };
  const res = await s.collectClaims(4, 3);   // tile=5萬, from=上家(3)
  return { res, askLog };
}

(async () => {
  console.log('== 场景1：有人能胡 → 只问胡，胡优先 ==');
  {
    const { res, askLog } = await runCase(
      (p, tile, from, isNext) => {
        if (p.idx === 2) return [{ k: 'hu', tile }];
        if (p.idx === 0) return [{ k: 'pung', tile }];
        if (p.idx === 1 && isNext) return [{ k: 'chow', tile, combo: [tile - 1, tile + 1] }];
        return [];
      },
      (s, pend) => { if (pend.seat === 2) s.resolvePend({ k:'hu', tile: pend.payload.tile }); else s.resolvePend(null); }
    );
    ok('首个询问是对家(2)胡', askLog[0] && askLog[0].seat === 2);
    ok('返回 hu 且 winner=2', res.type === 'hu' && res.players[0] === 2);
    ok('只问一轮（没继续问碰/吃）', askLog.length === 1);
  }

  console.log('== 场景2：没人胡 → 问杠碰（杠=碰同级，一起问）==');
  {
    const { res, askLog } = await runCase(
      (p, tile, from, isNext) => {
        if (p.idx === 0) return [{ k: 'pung', tile }];
        if (p.idx === 1) return [{ k: 'kong', tile }];
        return [];
      },
      (s, pend) => { if (pend.seat === 0) s.resolvePend({ k:'pung', tile: pend.payload.tile }); else s.resolvePend(null); }
    );
    // 分轮：第2轮从 from+1 开始问杠碰（下家1→对家2→上家3→我0 顺序，但排除 from=3）
    // 顺序：1(下家,kong) → 2(对家,无) → 0(我,pung)
    ok('杠碰轮询问了能杠碰的人', askLog.length >= 1);
    ok('返回 pung（我碰）', res.type === 'pung' && res.idx === 0);
  }

  console.log('== 场景3：没人碰 → 问下家吃 ==');
  {
    const { res, askLog } = await runCase(
      (p, tile, from, isNext) => {
        // from=3(上家)，下家=(3+1)%4=0(我)
        if (p.idx === 0 && isNext) return [{ k: 'chow', tile, combo: [tile - 1, tile + 1] }];
        return [];
      },
      (s, pend) => { s.resolvePend({ k:'chow', tile: pend.payload.tile, combo: pend.payload.opts[0].combo }); }
    );
    ok('吃轮只问下家(0)', askLog.length === 1 && askLog[0].seat === 0);
    ok('返回 chow 且 idx=0', res && res.type === 'chow' && res.idx === 0);
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
