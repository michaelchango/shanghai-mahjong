// m48：v1.2.37 端到端 —— 清一色+无花果 真实胡牌，全链路（scoreOf → settleHtml → 历史）
const { boot } = require('../proto/server/headless');
const { handSeed } = require('../proto/server/rng');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

const S = boot({ seed: handSeed(4242, 2, 0), instant: true });
const st = S.__state, CFG = st.CFG, G = st.G;
const T = { '1m':0,'2m':1,'3m':2,'4m':3,'5m':4,'6m':5,'7m':6,'8m':7,'9m':8,
  '1p':9,'2p':10,'3p':11,'4p':12,'5p':13,'6p':14,'7p':15,'8p':16,'9p':17,
  '1s':18,'2s':19,'3s':20,'4s':21,'5s':22,'6s':23,'7s':24,'8s':25,'9s':26,
  'E':27,'S':28,'W':29,'N':30,'Z':31,'F':32,'B':33 };
const mk = l => l.map(k => T[k]);
const mkP = o => Object.assign({ idx:0, hand:[], melds:[], flowers:[], menqing:false, knocked:true, missHu:new Set(), pendingFlowers:[], score:0 }, o);

S.initGame();

console.log('== 1) 清碰 + 无花果 自摸（敲麻）==');
CFG.lajiHu = true; CFG.base = 2; CFG.unit = 1; CFG.lezi = 8;
// 清一色万子：111 222 333 444 55（0 花 ⇒ 无花果；全刻子 ⇒ 清碰）
const qingWu = mk(['1m','1m','1m','2m','2m','2m','3m','3m','3m','4m','4m','4m','5m','5m']);
const p0 = mkP({ hand: qingWu.slice(), menqing: true, knocked: true, flowers: [] });
ok('手牌为 0 花', S.calcFlowers(p0, null) === 0, S.calcFlowers(p0, null));
ok('isWuGuoHua = true', S.isWuGuoHua(p0) === true);
const cnt = new Array(34).fill(0); for (const t of qingWu) cnt[t]++;
const shape = S.evaluateShape(cnt, p0.melds, { flowerCount: 0 });
ok('牌型 = 清碰（111/222/333/444 + 55 全刻子）', shape && shape.type === '清碰', shape);

const ev = { type: '清碰', base: 0, lezi: S.leziOf('清碰'), flowers: 0 };
ok('敲麻 清碰 基础勒子 = 4', S.leziOf('清碰') === 4, S.leziOf('清碰'));
const sc = S.scoreOf(ev, {}, p0, 1);
// 底 10，勒子 = 4（清碰）+ 2（无花果）= 6，附加番 = 门清 1 ⇒ 番 7 ⇒ 10×7 = 70
ok('勒子合计 = 6', sc.lezi === 6, sc.leziParts);
ok('底 = 10', sc.di === 10);
ok('番 = 7（6 勒子 + 门清 1）', sc.fan === 7, { fan: sc.fan, add: sc.add });
ok('自摸单份 = 70', sc.per === 70, sc.per);
const p1 = (sc.leziParts||[]).filter(x => x[0]==='无花果')[0];
ok('明细含「无花果 2 勒子」', p1 && p1[1] === 2, sc.leziParts);

console.log('== 2) 结算面板 HTML 含勒子明细 ==');
const html = S.fanBreakdownHtml(ev, sc.add, sc);
ok('面板含「无花果」', html.indexOf('无花果') >= 0);
ok('面板含「勒子（6 勒子」', html.indexOf('勒子（6 勒子') >= 0, html.slice(0, 300));
ok('面板家付 = 70 分', html.indexOf('70 分') >= 0);

console.log('== 3) 封顶生效（勒子很多时）==');
CFG.lezi = 2;  // 封顶 2 勒 = 20 分
const sc2 = S.scoreOf(ev, {}, p0, 1);
ok('理论分 70 > 封顶 20 → 按 20', sc2.raw === 70 && sc2.cap === 20 && sc2.per === 20, { raw: sc2.raw, cap: sc2.cap, per: sc2.per });
CFG.lezi = 8;

console.log('== 4) 清混碰：无花果 = 1 勒子 ==');
CFG.lajiHu = false;
// 清混碰下 清一色 只算 1 勒子，+ 无花果 1 = 2
const sc3 = S.scoreOf({ type: '清一色', base: 0, lezi: S.leziOf('清一色'), flowers: 0 }, {}, p0, 1);
ok('清混碰 清一色基础勒子 = 1', S.leziOf('清一色') === 1, S.leziOf('清一色'));
ok('清混碰 清一色1 + 无花果1 = 2 勒子', sc3.lezi === 2, sc3.leziParts);
ok('清混碰 番 = 3（2 勒子 + 门清 1，附加番两模式通用）', sc3.fan === 3, { fan: sc3.fan, add: sc3.add });
ok('清混碰 单份 = 10 × 3 = 30', sc3.per === 30, { fan: sc3.fan, per: sc3.per });
CFG.lajiHu = true;

console.log('== 5) 大吊车（4 副露）单钓 ==');
CFG.lajiHu = true;
const pD = mkP({ hand: mk(['5m','5m']), menqing: false, knocked: true, flowers: [100],
  melds: [
    { type:'chow', tile:T['1m'], concealed:false, from:1, tiles:[T['1m'],T['2m'],T['3m']] },
    { type:'chow', tile:T['4m'], concealed:false, from:2, tiles:[T['4m'],T['5m'],T['6m']] },
    { type:'chow', tile:T['7m'], concealed:false, from:3, tiles:[T['7m'],T['8m'],T['9m']] },
    { type:'pung', tile:T['E'], concealed:false, from:1 }
  ]});
ok('大吊车 判定', S.isDaDiaoChe(pD) === true);
ok('大吊车 非无花果（有 1 花）', S.isWuGuoHua(pD) === false);
const sc4 = S.scoreOf({ type: '垃圾胡', base: 0, lezi: 0, flowers: 0 }, {}, pD, 1);
ok('大吊车：底 10 × 番 2 = 20', sc4.lezi === 2 && sc4.di === 10 && sc4.per === 20, [sc4.lezi, sc4.di, sc4.per, sc4.leziParts]);

console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
