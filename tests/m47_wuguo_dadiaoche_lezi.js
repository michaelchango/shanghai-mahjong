// m47：v1.2.37 无花果 / 大吊车 改为勒子牌型
//  规则（用户确认）：
//   · 无花果、大吊车 都按勒子算——敲麻 2 勒子、清混碰 1 勒子
//   · 与色牌型（清一色/清碰/风一色/风碰）勒子数**相加**（不取代）
//   · 无花果 + 大吊车 同时成立时也相加
//   · 走勒子档 ⇒ 底固定 10 花，不再叠底设置与花牌
//   · 无花果「只能自摸」的限制维持不变
const { boot } = require('../proto/server/headless');
const { handSeed } = require('../proto/server/rng');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

const S = boot({ seed: handSeed(9999, 1, 0), instant: true });
const st = S.__state, CFG = st.CFG, G = st.G;
const T = { '1m':0,'2m':1,'3m':2,'4m':3,'5m':4,'6m':5,'7m':6,'8m':7,'9m':8,
  '1p':9,'2p':10,'3p':11,'4p':12,'5p':13,'6p':14,'7p':15,'8p':16,'9p':17,
  '1s':18,'2s':19,'3s':20,'4s':21,'5s':22,'6s':23,'7s':24,'8s':25,'9s':26,
  'E':27,'S':28,'W':29,'N':30,'Z':31,'F':32,'B':33 };
const mk = l => l.map(k => T[k]);
const mkP = o => Object.assign({ idx:0, hand:[], melds:[], flowers:[], menqing:false, knocked:true, missHu:new Set(), pendingFlowers:[] }, o);
const partOf = (sc, name) => { const f = (sc.leziParts || []).find(x => x[0] === name); return f ? f[1] : 0; };

S.initGame();

console.log('== 1) 无花果 / 大吊车 的勒子数（按玩法） ==');
for (const laji of [true, false]){
  CFG.lajiHu = laji;
  const tag = laji ? '敲麻' : '清混碰';
  const want = laji ? 2 : 1;
  // 无花果：0 花、无副露
  const pW = mkP({});
  ok(tag + ' 无花果 勒子 = ' + want, S.specialLezi() === want && S.isWuGuoHua(pW) === true, { sp: S.specialLezi(), wu: S.isWuGuoHua(pW) });
  // 大吊车：4 副露（吃不算花）
  const pD = mkP({ melds: [
    { type:'chow', tile:0, concealed:false, from:1, tiles:[0,1,2] },
    { type:'chow', tile:3, concealed:false, from:2, tiles:[3,4,5] },
    { type:'chow', tile:6, concealed:false, from:3, tiles:[6,7,8] },
    { type:'chow', tile:27, concealed:false, from:1, tiles:[27,27,27] }
  ]});
  ok(tag + ' 大吊车 判定（4 副露）', S.isDaDiaoChe(pD) === true);
}

console.log('== 2) 单独成立：走勒子档（底 10 花） ==');
CFG.base = 2; CFG.unit = 1; CFG.lezi = 8; CFG.lajiHu = true;
let sc = S.scoreOf({ type: '垃圾胡', base: 0, lezi: 0, flowers: 0 }, {}, mkP({}), 1);
ok('敲麻 无花果：底10 × 番2 = 20', sc.di === 10 && sc.lezi === 2 && sc.per === 20, [sc.di, sc.lezi, sc.per]);
ok('敲麻 无花果 明细 = 2 勒子', partOf(sc, '无花果') === 2, sc.leziParts);

sc = S.scoreOf({ type: '碰碰胡', base: 1, lezi: 0, flowers: 1 }, {}, mkP({
  flowers: [100],
  melds: [ { type:'pung', tile:0, concealed:false, from:1 }, { type:'pung', tile:3, concealed:false, from:2 },
           { type:'pung', tile:6, concealed:false, from:3 }, { type:'pung', tile:9, concealed:false, from:1 } ]
}), 1);
ok('敲麻 大吊车：底10 × 番2 = 20', sc.di === 10 && sc.lezi === 2 && sc.per === 20, [sc.di, sc.lezi, sc.per, sc.leziParts]);

console.log('== 3) 相加：勒子数叠加 ==');
// 色牌型 + 无花果
sc = S.scoreOf({ type: '清一色', base: 0, lezi: 2, flowers: 0 }, {}, mkP({}), 1);
ok('敲麻 清一色2 + 无花果2 = 4 勒子', sc.lezi === 4 && sc.di === 10, [sc.lezi, sc.leziParts]);
// 无花果 + 大吊车
const pBoth = mkP({ melds: [
  { type:'chow', tile:0, concealed:false, from:1, tiles:[0,1,2] },
  { type:'chow', tile:3, concealed:false, from:2, tiles:[3,4,5] },
  { type:'chow', tile:6, concealed:false, from:3, tiles:[6,7,8] },
  { type:'chow', tile:27, concealed:false, from:1, tiles:[27,27,27] }
]});
sc = S.scoreOf({ type: '混一色', base: 1, lezi: 0, flowers: 0 }, {}, pBoth, 1);
ok('敲麻 无花果2 + 大吊车2 = 4 勒子（混一色在勒子档下不计牌型番）', sc.lezi === 4 && sc.di === 10, [sc.lezi, sc.leziParts, sc.di]);
ok('敲麻 明细逐项列出', partOf(sc, '无花果') === 2 && partOf(sc, '大吊车') === 2, sc.leziParts);
CFG.lajiHu = false;
sc = S.scoreOf({ type: '混一色', base: 1, lezi: 0, flowers: 0 }, {}, pBoth, 1);
ok('清混碰 无花果1 + 大吊车1 = 2 勒子', sc.lezi === 2 && sc.di === 10, [sc.lezi, sc.leziParts]);

console.log('== 4) 无花果「只能自摸」不变 ==');
CFG.lajiHu = true; CFG.base = 2;
const hand13 = mk(['1m','1m','1m','2m','2m','2m','3m','3m','3m','4m','4m','4m','5m']);
const noFlower = mkP({ hand: hand13.slice(), menqing: true });
ok('0 花 → isWuGuoHua = true', S.isWuGuoHua(noFlower) === true);
let co = S.claimOptions(noFlower, T['5m'], 3, true);
ok('无花果：点炮不给「胡」', !co.some(o => o.k === 'hu'), JSON.stringify(co.map(o => o.k)));
const withFlower = mkP({ hand: hand13.slice(), menqing: true, flowers: [100] });
ok('带 1 花 → isWuGuoHua = false', S.isWuGuoHua(withFlower) === false);
co = S.claimOptions(withFlower, T['5m'], 3, true);
ok('非无花果：点炮给「胡」', co.some(o => o.k === 'hu'), JSON.stringify(co.map(o => o.k)));

console.log('== 5) 顶部 HUD 与结算一致（含无花果/大吊车） ==');
// 直接比对 analyzeMe 与 scoreOf：用 0 花听牌手
CFG.lajiHu = true; CFG.base = 2;
const hudP = G.players[0];
hudP.hand = mk(['1m','1m','1m','2m','2m','2m','3m','3m','3m','4m','4m','4m','5m']);
hudP.melds = []; hudP.flowers = []; hudP.menqing = true; hudP.knocked = true;
G.running = true; G.kaibao = false; G.huangfan = 0;
const df = S.playerDiFan(hudP);
ok('playerDiFan 走勒子档（底 10）', df.di === 10, df);
ok('playerDiFan 番含无花果（≥2）', df.fan >= 2, df);

console.log('== 6) 统一逻辑：用户给的 4 个标准例题（敲麻）==');
// 规则：只要沾勒子（牌型勒子 或 无花果 或 大吊车），底一律拉满 10 花，
//       其余（勒子数 + 附加番）全部加在番乘区。
CFG.lajiHu = true; CFG.base = 2; CFG.unit = 1; CFG.lezi = 8;
{
  // 1) 垃圾胡 + 无花果 → 2 勒子 → 10 × 2 = 20
  const s1 = S.scoreOf({ type:'垃圾胡', base:0, lezi:0, flowers:0 }, {}, mkP({}), 1);
  ok('例1 垃圾胡+无花果 = 10×2 = 20', s1.di === 10 && s1.fan === 2 && s1.per === 20, [s1.di, s1.fan, s1.per]);
  ok('例1 兜底不加（沾勒子）', s1.fan === 2, s1.fan);

  // 2) 清一色 + 无花果 → 4 勒子 → 10 × 4 = 40
  const s2 = S.scoreOf({ type:'清一色', base:0, lezi:2, flowers:0 }, {}, mkP({}), 1);
  ok('例2 清一色+无花果 = 10×4 = 40', s2.di === 10 && s2.fan === 4 && s2.per === 40, [s2.di, s2.fan, s2.per]);
  ok('例2 勒子 = 2+2', s2.lezi === 4, s2.leziParts);

  // 3) 清一色 + 无花果 + 门清 → 4 勒子 + 1 番 = 5 番 → 50
  const s3 = S.scoreOf({ type:'清一色', base:0, lezi:2, flowers:0 }, {}, mkP({ menqing:true }), 1);
  ok('例3 清一色+无花果+门清 = 10×5 = 50', s3.di === 10 && s3.fan === 5 && s3.per === 50, [s3.di, s3.fan, s3.per]);

  // 4) 清一色 + 无花果 + 门清 + 杠上开花 → 4 勒子 + 2 番 = 6 番 → 60
  const s4 = S.scoreOf({ type:'清一色', base:0, lezi:2, flowers:0 }, { kongDraw:true }, mkP({ menqing:true }), 1);
  ok('例4 再+杠上开花 = 10×6 = 60', s4.di === 10 && s4.fan === 6 && s4.per === 60, [s4.di, s4.fan, s4.per]);
}

console.log('== 7) 「沾勒子 ⇒ 底拉满 10」对普通牌型也成立 ==');
{
  CFG.base = 3; CFG.unit = 2;
  // 9 张花 + 底 3 ⇒ 没沾勒子时底 = 12
  const plain = S.scoreOf({ type:'碰碰胡', base:1, lezi:0, flowers:9 }, {}, mkP({ flowers:[100,101,102,103,104,105,106,107,108] }), 1);
  ok('没沾勒子：底 = 底3 + 花9 = 12', plain.di === 12, [plain.di, plain.fan]);
  // 同一手若换成无花果（0 花）⇒ 底被拉满为 10（即使花多也不叠）
  const lez = S.scoreOf({ type:'垃圾胡', base:0, lezi:0, flowers:0 }, {}, mkP({}), 1);
  ok('沾勒子：底固定 10（不叠底设置与花数）', lez.di === 10, lez.di);
  CFG.base = 2; CFG.unit = 1;
}

console.log('== 8) 前 5 种牌型只影响「番」，不动底 ==');
{
  for (const [t, base] of [['垃圾胡',0],['碰碰胡',1],['混一色',1],['混碰',1],['七小对',1]]){
    const p = mkP({ flowers:[100] });                 // 1 花 ⇒ 不是无花果，不会误触勒子
    const sc = S.scoreOf({ type:t, base, lezi:0, flowers:1 }, {}, p, 1);
    const wantDi = CFG.base + 1, wantFan = base + 1;  // 敲麻兜底 +1
    ok(t + ' 底 = 底设置2 + 花1 = 3', sc.di === wantDi, sc.di);
    ok(t + ' 番 = 牌型' + base + ' + 兜底1 = ' + wantFan, sc.fan === wantFan, sc.fan);
  }
}

console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
