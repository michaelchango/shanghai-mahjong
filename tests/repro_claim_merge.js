// repro_claim_merge.js：v1.2.52 下家「杠/碰/吃」合并询问回归
// 规则：下家（唯一能吃者）为真人且杠/碰/吃同时可行 → 一次亮出全部按钮；
//       选吃时对家/上家的杠/碰仍优先（被碰则吃作废）；选杠/碰直接生效；过=全不要。
const { boot } = require('../proto/server/headless.js');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ❌ FAIL: ' + n + ' -> ' + JSON.stringify(x)); } };

function mkHarness(){
  const s = boot({ seed: 1, onRender(){}, onToast(){}, onSheet(){} });
  s.initGame();
  const G = s.__state.G;
  for (let i = 0; i < 4; i++){ G.players[i].isBot = false; G.players[i].name = ['我','下家','对家','上家'][i]; }
  return { s, G };
}

// mock claimOptions：谁有什么牌权
async function runCase(mock, answerFn){
  const { s } = mkHarness();
  s.claimOptions = mock;
  const askLog = [];
  s.onAsk = pend => {
    askLog.push({ seat: pend.seat, ks: pend.payload.opts.map(o => o.k) });
    answerFn(s, pend);
  };
  const res = await s.collectClaims(4, 3);   // tile=5萬, from=3(上家) → 下家=0
  return { res, askLog };
}
const PUNG = t => ({ k: 'pung', tile: t });
const CHOW = t => ({ k: 'chow', tile: t, combo: [t - 1, t + 1] });
const both = (p, tile, from, isNext) => (p.idx === 0 && isNext) ? [PUNG(tile), CHOW(tile)] : [];

(async () => {
  console.log('== T1 合并：一次询问带 碰+吃 ==');
  {
    const { res, askLog } = await runCase(both, (s, pend) => s.resolvePend(null));
    ok('只问一次', askLog.length === 1, askLog);
    ok('问的是下家(0)', askLog[0].seat === 0);
    ok('按钮同时含 碰+吃', askLog[0].ks.join(',') === 'pung,chow', askLog[0].ks);
    ok('过 → 无主', res === null, res);
  }
  console.log('== T2 选吃（别家无碰）→ 吃生效 ==');
  {
    const { res, askLog } = await runCase(both, (s, pend) => {
      s.resolvePend(pend.payload.opts.find(o => o.k === 'chow'));
    });
    ok('只问一次', askLog.length === 1, askLog);
    ok('返回 chow 且 idx=0', res.type === 'chow' && res.idx === 0, res);
  }
  console.log('== T3 选吃但下二家(1)要碰 → 碰吃优先级，吃作废 ==');
  {
    const mock = (p, tile, from, isNext) => {
      if (p.idx === 0 && isNext) return [PUNG(tile), CHOW(tile)];
      if (p.idx === 1) return [PUNG(tile)];
      return [];
    };
    const { res, askLog } = await runCase(mock, (s, pend) => {
      if (pend.seat === 0) s.resolvePend(pend.payload.opts.find(o => o.k === 'chow'));
      else s.resolvePend(pend.payload.opts[0]);
    });
    ok('两次询问：先下家选吃、再问 1 的碰', askLog.length === 2 && askLog[0].seat === 0 && askLog[1].seat === 1, askLog);
    ok('碰赢过吃（idx=1）', res.type === 'pung' && res.idx === 1, res);
  }
  console.log('== T4 选碰 → 直接生效，不再问别家 ==');
  {
    const mock = (p, tile, from, isNext) => {
      if (p.idx === 0 && isNext) return [PUNG(tile), CHOW(tile)];
      if (p.idx === 1) return [PUNG(tile)];
      return [];
    };
    const { res, askLog } = await runCase(mock, (s, pend) => {
      s.resolvePend(pend.payload.opts.find(o => o.k === 'pung') || pend.payload.opts[0]);
    });
    ok('只问一次（1 未被问）', askLog.length === 1 && askLog[0].seat === 0, askLog);
    ok('返回 pung idx=0', res.type === 'pung' && res.idx === 0, res);
  }
  console.log('== T5 过 → 继续问别家的杠/碰 ==');
  {
    const mock = (p, tile, from, isNext) => {
      if (p.idx === 0 && isNext) return [PUNG(tile), CHOW(tile)];
      if (p.idx === 1) return [PUNG(tile)];
      return [];
    };
    const { res, askLog } = await runCase(mock, (s, pend) => {
      if (pend.seat === 0) s.resolvePend(null);
      else s.resolvePend(pend.payload.opts[0]);
    });
    ok('两次询问', askLog.length === 2, askLog);
    ok('1 的碰生效', res.type === 'pung' && res.idx === 1, res);
  }
  console.log('== T6 别家能碰但下家只要吃（无合并路径）→ 仍先问碰 ==');
  {
    const mock = (p, tile, from, isNext) => {
      if (p.idx === 0 && isNext) return [CHOW(tile)];
      if (p.idx === 1) return [PUNG(tile)];
      return [];
    };
    const { res, askLog } = await runCase(mock, (s, pend) => {
      if (pend.seat === 1) s.resolvePend(null); else s.resolvePend(pend.payload.opts[0]);
    });
    ok('先问 1 的碰', askLog[0].seat === 1, askLog);
    ok('碰过了才轮到下家吃', askLog.length === 2 && askLog[1].seat === 0, askLog);
    ok('吃生效', res.type === 'chow' && res.idx === 0, res);
  }
  console.log('\n结果: pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})();
