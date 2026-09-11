// m55：清混碰下顶部四栏与结算口径一致性 + 复现「底10 / 番2」
const { boot } = require('../proto/server/headless');
const { handSeed } = require('../proto/server/rng');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ❌ FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

const S = boot({ seed: handSeed(4242, 1, 0), instant: true });
const st = S.__state, CFG = st.CFG, G = st.G;
const T = { '1m':0,'2m':1,'3m':2,'4m':3,'5m':4,'6m':5,'7m':6,'8m':7,'9m':8,
  '1p':9,'2p':10,'3p':11,'4p':12,'5p':13,'6p':14,'7p':15,'8p':16,'9p':17,
  '1s':18,'2s':19,'3s':20,'4s':21,'5s':22,'6s':23,'7s':24,'8s':25,'9s':26,
  'E':27,'S':28,'W':29,'N':30,'Z':31,'F':32,'B':33 };
const mk = l => l.map(k => T[k]);

S.initGame();

function mkP(o){
  return Object.assign({ idx:0, hand:[], melds:[], flowers:[], discards:[], menqing:false,
    knocked:false, isBot:false, missHu:new Set(), pendingFlowers:[], drawn:null,
    drawnCount:0, noDiscard:null, noDiscardKind:null, knockWaits:[] }, o);
}
const M = (type, tile, n) => ({ type, tile, tiles: new Array(n).fill(tile), concealed:false, from:1 });

function probe(label, p){
  G.players[0] = p;
  const a = S.analyzeMe();
  console.log('  %s', label);
  console.log('    花数=%d  勒子=%j  附加番=%j', S.calcFlowers(p, null), S.leziTotal(p, {}).parts, S.extraFan(p, {}));
  console.log('    顶部栏：底=%s 番=%s 可得=%s', a.di, a.fan, a.score);
  // 结算口径对照：把这手牌当「已和」
  const hc = S.toCounts(p.hand);
  const ev = S.evaluateShape(hc, p.melds, { flowerCount: S.calcFlowers(p, null) });
  if (ev){
    const sc = S.scoreOf(ev, {}, p, 1);
    console.log('    结算：牌型=%s 底=%s 番=%s 每家=%s', ev.type, sc.di, sc.fan, sc.per);
    return { a, sc, ev, flowers: S.calcFlowers(p, null), lezi: S.leziTotal(p, {}) };
  }
  console.log('    结算：（当前手牌不是和牌型，无法直接对照）');
  return { a, ev: null, flowers: S.calcFlowers(p, null), lezi: S.leziTotal(p, {}) };
}

CFG.lajiHu = false;      // 清混碰
CFG.base = 2; CFG.unit = 1; CFG.lezi = 99; CFG.sevenPairs = false;

console.log('== A) 清混碰：4 副露（大吊车）+ 0 花 → 无花果 + 大吊车 ==');
{
  // 三萬碰 / 六筒碰 / 八筒碰 / 二索碰，手牌 5万5万（单钓将）
  const melds = [M('pung', T['3m'], 3), M('pung', T['6p'], 3), M('pung', T['8p'], 3), M('pung', T['2s'], 3)];
  const p = mkP({ hand: mk(['5m','5m']), melds, flowers: [] });
  const r = probe('4 副露 / 0 花 / 手牌 5万5万', p);
  ok('清混碰 4 副露：无花果成立', r.lezi.parts.some(x => x[0] === '无花果'), r.lezi.parts);
  ok('清混碰 4 副露：大吊车成立', r.lezi.parts.some(x => x[0] === '大吊车'), r.lezi.parts);
  ok('清混碰 勒子数 = 1+1 = 2', r.lezi.total === 2, r.lezi.total);
  ok('清混碰 底 = 10', r.a.di === 10, r.a.di);
  ok('清混碰 番 = 2', r.a.fan === 2, r.a.fan);
  ok('清混碰 可得 = 20', r.a.score === 20, r.a.score);
}

console.log('\n== B) 清混碰：4 副露 但有花（无花果不成立）==');
{
  const melds = [M('pung', T['3m'], 3), M('pung', T['6p'], 3), M('pung', T['8p'], 3), M('pung', T['2s'], 3)];
  const p = mkP({ hand: mk(['5m','5m']), melds, flowers: [120] });   // 一张季花
  const r = probe('4 副露 / 1 花', p);
  ok('有花 → 无花果不成立', !r.lezi.parts.some(x => x[0] === '无花果'), r.lezi.parts);
  ok('只算大吊车 1 勒', r.lezi.total === 1, r.lezi.total);
  ok('番 = 1', r.a.fan === 1, r.a.fan);
}

console.log('\n== C) 清混碰：无副露 0 花（只有无花果）==');
{
  const p = mkP({ hand: mk(['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','1p']), melds: [], flowers: [] });
  const r = probe('0 副露 / 0 花', p);
  ok('无花果 1 勒', r.lezi.total === 1, r.lezi.total);
  ok('底 = 10', r.a.di === 10, r.a.di);
}

console.log('\n== D) 同一手牌跨玩法对照（直接验证「顶部栏按玩法算」）==');
{
  // 同一手：4 副露（大吊车）+ 0 花（无花果）。两种玩法的勒子单价不同：
  //   敲麻 无花果/大吊车 各 2 勒；清混碰 各 1 勒 —— 底都固定 10 花，番不同。
  const melds = [M('pung', T['3m'], 3), M('pung', T['6p'], 3), M('pung', T['8p'], 3), M('pung', T['2s'], 3)];
  const mkHand = () => mkP({ hand: mk(['5m','5m']), melds: melds.map(m => Object.assign({}, m)), flowers: [] });

  CFG.lajiHu = false;
  G.players[0] = mkHand();
  const qhp = S.analyzeMe();
  CFG.lajiHu = true;
  G.players[0] = mkHand();
  const km = S.analyzeMe();
  CFG.lajiHu = false;

  console.log('  清混碰：底=%s 番=%s 可得=%s', qhp.di, qhp.fan, qhp.score);
  console.log('  敲麻  ：底=%s 番=%s 可得=%s', km.di, km.fan, km.score);

  ok('清混碰 番 = 1+1 = 2', qhp.fan === 2, qhp.fan);
  ok('敲麻 番 = 2+2 = 4', km.fan === 4, km.fan);
  ok('两种玩法底都固定 10 花', qhp.di === 10 && km.di === 10, { qhp: qhp.di, km: km.di });
  ok('两种玩法得分不同 → 顶部栏确实按玩法算', qhp.score === 20 && km.score === 40, { qhp: qhp.score, km: km.score });
}

console.log('\n== E) 敲麻对照：同样 4 副露 0 花 → 无花果 + 大吊车 各 2 勒 ==');
{
  CFG.lajiHu = true;
  const melds = [M('pung', T['3m'], 3), M('pung', T['6p'], 3), M('pung', T['8p'], 3), M('pung', T['2s'], 3)];
  const p = mkP({ hand: mk(['5m','5m']), melds, flowers: [] });
  const r = probe('敲麻 / 4 副露 / 0 花', p);
  ok('敲麻 勒子 = 2+2 = 4', r.lezi.total === 4, r.lezi.total);
  ok('敲麻 番 = 4', r.a.fan === 4, r.a.fan);
  CFG.lajiHu = false;
}

console.log('\n== F) 顶部栏 vs 结算：口径一致性（清混碰）==');
{
  const cases = [
    ['4副露0花', mkP({ hand: mk(['5m','5m']), flowers: [], melds: [M('pung', T['3m'],3),M('pung',T['6p'],3),M('pung',T['8p'],3),M('pung',T['2s'],3)] })],
    ['4副露1花', mkP({ hand: mk(['5m','5m']), flowers: [120], melds: [M('pung', T['3m'],3),M('pung',T['6p'],3),M('pung',T['8p'],3),M('pung',T['2s'],3)] })],
    ['0副露1花', mkP({ hand: mk(['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','1p']), flowers: [120], melds: [] })],
  ];
  let checked = 0;
  for (const [name, p] of cases){
    G.players[0] = p;
    const a = S.analyzeMe();
    const ev = S.evaluateShape(S.toCounts(p.hand), p.melds, { flowerCount: S.calcFlowers(p, null) });
    if (!ev) continue;
    const sc = S.scoreOf(ev, {}, p, 1);
    checked++;
    ok('[' + name + '] 顶部底 == 结算底', a.di === sc.di, { hud: a.di, settle: sc.di });
    ok('[' + name + '] 顶部番 == 结算番', a.fan === sc.fan, { hud: a.fan, settle: sc.fan });
  }
  ok('一致性用例覆盖数 > 0', checked > 0, checked);
}

console.log('\n== G) v1.2.43 顶部栏口径明细 hudBreakdown() ==');
{
  const cases = [
    ['清混碰 4副露0花', false, mkP({ hand: mk(['5m','5m']), flowers: [],
      melds: [M('pung',T['3m'],3),M('pung',T['6p'],3),M('pung',T['8p'],3),M('pung',T['2s'],3)] }),
      ['无花果', '大吊车', '10 花']],
    ['清混碰 0副露1花', false, mkP({ hand: mk(['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','1p']), flowers: [120], melds: [] }),
      ['底设置', '花 1', '3 花']],
  ];
  for (const [name, laji, p, musts] of cases){
    CFG.lajiHu = laji;
    G.players[0] = p;
    const html = S.hudBreakdown();
    const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    console.log('  [%s] %s', name, txt.slice(0, 150));
    ok('[' + name + '] 明细含玩法名', txt.indexOf(laji ? '敲麻' : '清混碰') >= 0, txt.slice(0, 60));
    for (const m of musts) ok('[' + name + '] 明细含「' + m + '」', txt.indexOf(m) >= 0, txt.slice(0, 160));
    ok('[' + name + '] 明细含合计行', txt.indexOf('合计') >= 0, txt.slice(-80));
  }
  CFG.lajiHu = false;
}

console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
