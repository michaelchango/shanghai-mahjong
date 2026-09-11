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

console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
