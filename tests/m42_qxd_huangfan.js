// m42：v1.2.35 两条规则修正
//  1) 「七小对算胡牌」开关：关掉后，只能靠七对成胡的牌型不能胡（乱风向/风一色 是传统牌型，恒有效）
//  2) 荒番：被用掉（有人胡牌并已按倍数结算）后下一局整体清零；流局才 +1（上限 3 级）
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
const HAND_MIXED_SEVEN  = ['1m','1m','2p','2p','3s','3s','4m','4m','5p','5p','6s','6s','7m','7m'];                   // 三门七对
const HAND_ONE_SUIT     = ['1m','1m','2m','2m','4m','4m','5m','5m','7m','7m','8m','8m','9m','9m'];                   // 单门七对（凑不成标准形）
const HAND_SUIT_HONOR   = ['1m','1m','2m','2m','4m','4m','5m','5m','7m','7m','8m','8m','E','E'];                     // 单门+字牌七对（非标准形）
const HAND_ALL_HONOR    = ['E','E','S','S','W','W','N','N','Z','Z','F','F','B','B'];                                 // 乱风向（全字牌七对）
const HAND_SEVEN_STD    = ['1m','1m','2m','2m','3m','3m','4m','4m','5m','5m','6m','6m','7m','7m'];                   // 既是七对也是标准形

(async () => {
  const S = boot({ seed: handSeed(4242, 1, 0), instant: true });
  const st = S.__state;
  S.initGame();

  const counts = list => {
    const c = new Array(34).fill(0);
    for (const k of list) c[T[k]]++;
    return c;
  };
  const evOf = hand => S.evaluateShape(counts(hand), [], { flowerCount: 0 });

  console.log('== 1) 七小对开关 ==');
  st.CFG.sevenPairs = false;
  ok('关门：三门七对不能胡', evOf(HAND_MIXED_SEVEN) === null, evOf(HAND_MIXED_SEVEN));
  ok('关门：单门七对(非标准形)不能胡', evOf(HAND_ONE_SUIT) === null, evOf(HAND_ONE_SUIT));
  ok('关门：单门+字七对(非标准形)不能胡', evOf(HAND_SUIT_HONOR) === null, evOf(HAND_SUIT_HONOR));
  const hAllOff = evOf(HAND_ALL_HONOR);
  ok('关门：乱风向恒为 风一色(敲麻 4 勒子)', !!hAllOff && hAllOff.type === '风一色' && hAllOff.lezi === 4, hAllOff);
  const hStdOff = evOf(HAND_SEVEN_STD);
  ok('关门：七对+标准形 → 仍按清一色(敲麻 2 勒子)', !!hStdOff && hStdOff.type === '清一色' && hStdOff.lezi === 2, hStdOff);

  st.CFG.sevenPairs = true;
  const a = evOf(HAND_MIXED_SEVEN), b = evOf(HAND_ONE_SUIT), c = evOf(HAND_SUIT_HONOR);
  ok('开门：三门七对 → 七小对(1番)', !!a && a.type === '七小对' && a.base === 1, a);
  ok('开门：单门七对(非标准形) → 七小对(1番)', !!b && b.type === '七小对' && b.base === 1, b);
  ok('开门：单门+字七对(非标准形) → 七小对(1番)', !!c && c.type === '七小对' && c.base === 1, c);
  st.CFG.sevenPairs = false;   // 复位

  console.log('== 2) 荒番清零 ==');
  // 流局：+1（上限 3）
  st.G.huangfan = 2;
  await S.finish({ type: 'liuju' });
  ok('流局：荒番 2 → 3', st.G.huangfan === 3, st.G.huangfan);
  st.G.huangfan = 3;
  await S.finish({ type: 'liuju' });
  ok('流局：荒番 3 → 封顶仍为 3', st.G.huangfan === 3, st.G.huangfan);

  // 自摸：清零
  st.G.huangfan = 2;
  await S.finish({ type: 'zimo', idx: 0, ev: { type: '垃圾胡', base: 0, total: 0, flowers: 0 }, ctx: {}, tile: 0 });
  ok('自摸胡牌：荒番 2 → 0', st.G.huangfan === 0, st.G.huangfan);

  // 点炮：清零（含一炮多响）
  st.G.huangfan = 3;
  await S.finish({ type: 'dianpao', from: 1, wins: [{ idx: 0, ev: { type: '垃圾胡', base: 0, total: 0, flowers: 0 }, tile: 0, diaoche: false }] });
  ok('点炮胡牌：荒番 3 → 0', st.G.huangfan === 0, st.G.huangfan);

  st.G.huangfan = 2;
  await S.finish({ type: 'dianpao', from: 2, wins: [
    { idx: 0, ev: { type: '垃圾胡', base: 0, total: 0, flowers: 0 }, tile: 0, diaoche: false },
    { idx: 3, ev: { type: '垃圾胡', base: 0, total: 0, flowers: 0 }, tile: 0, diaoche: false }
  ] });
  ok('一炮多响：荒番 2 → 0', st.G.huangfan === 0, st.G.huangfan);

  console.log('== 3) 封顶显示（不封顶不写数字） ==');
  st.G.kaibao = false; st.G.huangfan = 0;
  st.CFG.lezi = 8; st.CFG.unit = 1;
  ok('8 勒：封顶显示为数字 80', S.capText(S.capValue()) === 80, S.capText(S.capValue()));
  st.CFG.lezi = 99;
  ok('选不封：封顶栏显示「不封顶」', S.capText(S.capValue()) === '不封顶', S.capText(S.capValue()));
  ok('选不封：结算明细也用「不封顶」', S.capText(990) === '不封顶', S.capText(990));
  st.CFG.lezi = 8;

  console.log('结果: ' + (fail ? '❌ ' + fail + ' 项失败' : '✅ ' + pass + ' 通过 / 0 失败'));
  process.exit(fail ? 1 : 0);
})();
