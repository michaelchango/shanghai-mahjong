// m43：v1.2.36 计分口径（兜底番 + 勒子牌型）与「无花果只能自摸」
//  A) 牌型档位：敲麻 清一色2/清碰4/风一色4/风碰8 勒子；清混碰 1/2/2/4 勒子
//  B) 算分：普通牌型（兜底+牌型+附加）；勒子牌型（底固定 10 花、番=勒子数+附加）
//  C) 复算规则文档里用户给的两道例题（105 分 / 150 分）
//  D) 无花果只能自摸：点炮不给胡、抢杠不给抢、自摸照给
const { boot } = require('../proto/server/headless');
const { handSeed } = require('../proto/server/rng');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

const T = {
  '1m':0,'2m':1,'3m':2,'4m':3,'5m':4,'6m':5,'7m':6,'8m':7,'9m':8,
  '1p':9,'2p':10,'3p':11,'4p':12,'5p':13,'6p':14,'7p':15,'8p':16,'9p':17,
  '1s':18,'2s':19,'3s':20,'4s':21,'5s':22,'6s':23,'7s':24,'8s':25,'9s':26,
  'E':27,'S':28,'W':29,'N':30,'Z':31,'F':32,'B':33
};
const counts = list => { const c = new Array(34).fill(0); for (const k of list) c[T[k]]++; return c; };
const HAND_QING    = ['1m','2m','3m','4m','5m','6m','7m','8m','9m','9m','9m','2m','2m','2m'];  // 清一色
const HAND_QINGPENG= ['1m','1m','1m','5m','5m','5m','7m','7m','7m','9m','9m','9m','3m','3m'];// 清碰
const HAND_FENG    = ['E','E','E','S','S','S','W','W','W','N','N','N','E','E'];              // 风碰
const HAND_FENG1   = ['E','E','E','E','S','S','S','S','W','W','W','W','N','N'];              // 风一色(乱风向)
const HAND_MIX     = ['1m','2m','3m','4m','5m','6m','7m','8m','9m','E','E','E','N','N'];     // 混一色

(async () => {
  const S = boot({ seed: handSeed(4343, 1, 0), instant: true });
  const st = S.__state;
  S.initGame();
  const CFG = st.CFG;
  const mkP = o => Object.assign({ idx: 0, hand: [], melds: [], flowers: [], menqing: false, knocked: true, missHu: new Set(), pendingFlowers: [] }, o);
  const evOf = h => S.evaluateShape(counts(h), [], { flowerCount: 0 });

  console.log('== A) 牌型档位 ==');
  CFG.lajiHu = true;
  const a1 = evOf(HAND_QING), a2 = evOf(HAND_QINGPENG), a3 = evOf(HAND_FENG), a4 = evOf(HAND_FENG1);
  ok('敲麻 清一色 = 2 勒子', a1 && a1.type === '清一色' && a1.lezi === 2 && a1.base === 0, a1);
  ok('敲麻 清碰 = 4 勒子', a2 && a2.type === '清碰' && a2.lezi === 4, a2);
  ok('敲麻 风碰 = 8 勒子', a3 && a3.type === '风碰' && a3.lezi === 8, a3);
  ok('敲麻 风一色 = 4 勒子', a4 && a4.type === '风一色' && a4.lezi === 4, a4);
  ok('敲麻 混一色 = 1 番（兜底另计）', (() => { const e = evOf(HAND_MIX); return e && e.type === '混一色' && e.base === 1 && e.lezi === 0; })(), evOf(HAND_MIX));
  CFG.lajiHu = false;
  const b1 = evOf(HAND_QING), b2 = evOf(HAND_QINGPENG), b3 = evOf(HAND_FENG), b4 = evOf(HAND_FENG1);
  ok('清混碰 清一色 = 1 勒子', b1 && b1.lezi === 1, b1);
  ok('清混碰 清碰 = 2 勒子', b2 && b2.lezi === 2, b2);
  ok('清混碰 风碰 = 4 勒子', b3 && b3.lezi === 4, b3);
  ok('清混碰 风一色 = 2 勒子', b4 && b4.lezi === 2, b4);

  console.log('== B) 算分口径 ==');
  CFG.base = 2; CFG.unit = 1; CFG.lezi = 8;
  // 普通牌型：敲麻 兜底 1 番
  CFG.lajiHu = true;
  let sc = S.scoreOf({ type: '碰碰胡', base: 1, lezi: 0, flowers: 3 }, {}, mkP({ flowers: [100,101,102] }), 1);
  ok('敲麻 碰碰胡（3 花）= 底5 × 番2（兜底1+牌型1）', sc.di === 5 && sc.fan === 2 && sc.per === 10, [sc.di, sc.fan, sc.per]);
  sc = S.scoreOf({ type: '垃圾胡', base: 0, lezi: 0, flowers: 1 }, {}, mkP({ flowers: [100] }), 1);
  ok('敲麻 垃圾胡（1 花）= 底3 × 番1（兜底）', sc.di === 3 && sc.fan === 1 && sc.per === 3, [sc.di, sc.fan, sc.per]);
  // v1.2.37：无花果改成勒子牌型（敲麻 2 勒）——0 花的手牌走勒子档（底 10 花、番 = 勒子数）
  sc = S.scoreOf({ type: '垃圾胡', base: 0, lezi: 0, flowers: 0 }, {}, mkP({}), 1);
  ok('敲麻 垃圾胡零花（无花果 2 勒）= 底10 × 番2 = 20', sc.di === 10 && sc.fan === 2 && sc.per === 20, [sc.di, sc.fan, sc.per]);
  // 清混碰：无兜底
  CFG.lajiHu = false;
  sc = S.scoreOf({ type: '碰碰胡', base: 1, lezi: 0, flowers: 3 }, {}, mkP({ flowers: [100,101,102] }), 1);
  ok('清混碰 碰碰胡 = 底5 × 番1（无兜底）', sc.di === 5 && sc.fan === 1 && sc.per === 5, [sc.di, sc.fan, sc.per]);
  // 勒子牌型：底恒 10，不看花数
  CFG.lajiHu = true;
  sc = S.scoreOf({ type: '风一色', base: 0, lezi: 4, flowers: 0 }, {}, mkP({ flowers: [100,101,102,103,104], melds: [{ type:'kong', tile:27, concealed:true, from:-1 }] }), 1);
  ok('敲麻 勒子牌型底恒为 10 花（多花多杠不影响底）', sc.di === 10, sc.di);
  ok('勒子牌型番 = 勒子数（4）', sc.fan === 4, sc.fan);
  sc = S.scoreOf({ type: '风碰', base: 0, lezi: 8, flowers: 1 }, {}, mkP({ flowers: [100] }), 1);
  ok('敲麻 风碰 8 勒子：底10 × 番8 = 每家 80', sc.di === 10 && sc.fan === 8 && sc.per === 80, [sc.di, sc.fan, sc.per]);
  CFG.lajiHu = false;
  sc = S.scoreOf({ type: '清碰', base: 0, lezi: 2, flowers: 1 }, {}, mkP({ flowers: [100] }), 1);
  ok('清混碰 清碰 2 勒子：底10 × 番2 = 每家 20', sc.di === 10 && sc.fan === 2 && sc.per === 20, [sc.di, sc.fan, sc.per]);
  // 封顶 / 不封顶
  CFG.lezi = 3;                     // 3 勒 = 30 分封顶
  sc = S.scoreOf({ type: '风碰', base: 0, lezi: 4, flowers: 1 }, {}, mkP({ flowers: [100] }), 1);
  ok('3 勒封顶：40 → 截断为 30', sc.raw === 40 && sc.per === 30, [sc.raw, sc.per]);
  CFG.lezi = 99;
  sc = S.scoreOf({ type: '风碰', base: 0, lezi: 4, flowers: 1 }, {}, mkP({ flowers: [100] }), 1);
  ok('不封顶：不截断（40）', sc.per === 40, sc.per);
  CFG.lezi = 8;

  console.log('== C) 复算规则文档例题 ==');
  CFG.base = 1; CFG.lajiHu = true;
  // v1.2.37：大吊车改判「4 副露」→ 本例只有 1 个暗杠，不再算大吊车（原来靠 ctx.diaoche 硬传）
  //   番 = 兜底1 + 混一色1 + 门清1 + 海底1 = 4；底 = 底1 + 花6（3 花牌 + 风暗杠 3 花）= 7
  const p1 = mkP({ flowers: [100,101,102], melds: [{ type:'kong', tile:27, concealed:true, from:-1 }], menqing: true });
  sc = S.scoreOf({ type: '混一色', base: 1, lezi: 0, flowers: S.calcFlowers(p1, null) }, { haidi: true }, p1, 1);
  ok('例1 敲麻：底7 × 番4 × 3 家 = 84', sc.di === 7 && sc.fan === 4 && sc.per * 3 === 84, [sc.di, sc.fan, sc.per]);
  CFG.lajiHu = false;
  const p2 = mkP({ flowers: [], melds: [{ type:'pung', tile:27, concealed:false, from:1 }] });
  sc = S.scoreOf({ type: '风碰', base: 0, lezi: 4, flowers: S.calcFlowers(p2, null) }, { haidi: true }, p2, 1);
  ok('例2 清混碰：底10 × 番5 × 3 家 = 150', sc.di === 10 && sc.fan === 5 && sc.per * 3 === 150, [sc.di, sc.fan, sc.per]);

  console.log('== D) 无花果只能自摸 ==');
  CFG.lajiHu = true; CFG.base = 2;
  // 13 张、0 花的清碰听牌手（听 5万）
  const hand13 = [T['1m'],T['1m'],T['1m'],T['2m'],T['2m'],T['2m'],T['3m'],T['3m'],T['3m'],T['4m'],T['4m'],T['4m'],T['5m']];
  const noFlower = mkP({ hand: hand13.slice(), knocked: true, menqing: true });
  ok('wuGuoHuaAt：0 花手牌 = true', S.wuGuoHuaAt(noFlower, T['5m']) === true);
  let co = S.claimOptions(noFlower, T['5m'], 3, true);
  ok('无花果：点炮不给「胡」选项', !co.some(o => o.k === 'hu'), JSON.stringify(co.map(o => o.k)));
  const withFlower = mkP({ hand: hand13.slice(), knocked: true, menqing: true, flowers: [100] });
  ok('wuGuoHuaAt：带 1 张花 = false', S.wuGuoHuaAt(withFlower, T['5m']) === false);
  co = S.claimOptions(withFlower, T['5m'], 3, true);
  ok('非无花果：点炮正常给「胡」', co.some(o => o.k === 'hu' && o.ev.type === '清碰'), JSON.stringify(co.map(o => o.k)));
  // 风刻破无花果：手牌里补一组风暗刻
  const windHand = mkP({ hand: [T['E'],T['E'],T['E'],T['1m'],T['1m'],T['1m'],T['2m'],T['2m'],T['2m'],T['3m'],T['3m'],T['3m'],T['4m'],T['4m']].slice(0, 13), knocked: true, menqing: true });
  ok('风暗刻算花 → 破无花果', S.wuGuoHuaAt(windHand, T['4m']) === false, S.wuGuoHuaAt(windHand, T['4m']));
  const coW = S.claimOptions(windHand, T['4m'], 3, true);
  ok('风刻破无花果后可点炮胡（混碰）', coW.some(o => o.k === 'hu' && o.ev.type === '混碰'), JSON.stringify(coW.map(o => o.k)));
  // v1.2.37：无花果不再是 +1 附加番，而是独立的勒子来源（敲麻 2 勒 / 清混碰 1 勒）
  //   番 = 勒子数（清碰4 + 无花果2 = 6）+ 附加番（此手 menqing → 门清 +1）= 7
  const scNo = S.scoreOf({ type: '清碰', base: 0, lezi: 4, flowers: 0 }, {}, noFlower, 1);
  ok('自摸路径：0 花走勒子档（清碰4 + 无花果2 = 6 勒子）', scNo.lezi === 6 && scNo.di === 10, [scNo.lezi, scNo.di, scNo.fan]);
  ok('0 花勒子档番 = 勒子6 + 门清1 = 7', scNo.fan === 7, scNo.fan);
  ok('无花果 不在附加番里了', !S.extraFan(noFlower, {}).some(x => x[0] === '无花果'), JSON.stringify(S.extraFan(noFlower, {})));
  ok('无花果 勒子明细含「无花果 2」', (scNo.leziParts || []).some(x => x[0] === '无花果' && x[1] === 2), JSON.stringify(scNo.leziParts));
  // 抢杠：0 花不给抢；带花可抢
  const tryRob = (robber) => {
    let captured = null;
    const realFinish = S.finish;
    S.finish = async r => { captured = r; };
    st.G.players = [mkP({ idx: 0 }), robber, mkP({ idx: 2 }), mkP({ idx: 3 })];
    st.G.players[0].melds = [{ type: 'pung', tiles: [T['5m'],T['5m'],T['5m']], tile: T['5m'], concealed: false, from: 2 }];
    st.G.players[0].hand = [T['5m']];
    st.G.players[0].flowers = [100];
    st.G.wall = [0,0,0,0,0,0,0,0]; st.G.wpos = 0; st.G.wtail = 7;
    st.G.finished = false; st.G.abort = false;
    return S.applySelfKong(st.G.players[0], { k: 'chakan', tile: T['5m'], meld: st.G.players[0].melds[0] })
      .then(() => { S.finish = realFinish; return captured; });
  };
  const robNo = await tryRob(mkP({ idx: 1, hand: hand13.slice(), knocked: true, knockWaits: [T['5m']] }));
  ok('抢杠：0 花的听牌者不给抢', robNo === null, robNo && robNo.type);
  const robYes = await tryRob(mkP({ idx: 1, hand: hand13.slice(), knocked: true, knockWaits: [T['5m']], flowers: [100] }));
  ok('抢杠：带花的听牌者可以抢', !!robYes && robYes.type === 'dianpao' && robYes.wins[0].robKong === true, robYes && robYes.type);

  console.log('结果: ' + (fail ? '❌ ' + fail + ' 项失败' : '✅ ' + pass + ' 通过 / 0 失败'));
  process.exit(fail ? 1 : 0);
})();
