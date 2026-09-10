// m46：v1.2.37 顶部 HUD（底/番/得分）与结算 scoreOf() 口径一致性回归
//  背景：顶部「番」曾显示成「底 × 番」的乘积（听口比较值被当成番存回 out.fan），
//        且无花果判定用 calcFlowers(p,hc)（含手牌风刻）而结算用 calcFlowers(p,null)，差 1 番。
//  本测试：对若干典型手牌，断言 HUD 的 底/番/得分 === 结算 scoreOf 的 底/番/每家支付。
const { boot } = require('../proto/server/headless');
const { handSeed } = require('../proto/server/rng');
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

const T = { '1m':0,'2m':1,'3m':2,'4m':3,'5m':4,'6m':5,'7m':6,'8m':7,'9m':8,
  '1p':9,'2p':10,'3p':11,'4p':12,'5p':13,'6p':14,'7p':15,'8p':16,'9p':17,
  '1s':18,'2s':19,'3s':20,'4s':21,'5s':22,'6s':23,'7s':24,'8s':25,'9s':26,
  'E':27,'S':28,'W':29,'N':30,'Z':31,'F':32,'B':33 };
const mk = l => l.map(k => T[k]);

const S = boot({ seed: handSeed(9999, 1, 0), instant: true });
const st = S.__state, CFG = st.CFG, G = st.G;

// headless 把 analyzeMe 覆盖成空函数了，这里从引擎源码把真身取回来注入沙箱
const src = fs.readFileSync(path.join(__dirname, '../proto/server/engine.js'), 'utf8');
const fnSrc = src.match(/function analyzeMe\(\)\{[\s\S]*?\n\}\n/);
ok('能从 engine.js 取到 analyzeMe 源码', !!fnSrc);
vm.runInContext('analyzeMe = ' + fnSrc[0], S);

// 极端手牌用例：覆盖 勒子档 / 兜底档 / 无花果 / 门清 / 未听
// 注：手牌张数必须是 3n+1（听牌）或 3n+2（刚摸牌），否则 analyzeMe 走不到正常分支
const CASES = [
  ['清一色（2 勒子）听牌',   ['1m','2m','3m','4m','5m','6m','7m','8m','9m','9m','9m','2m','2m']],
  ['风一色（4 勒子）听牌',   ['E','E','E','S','S','S','W','W','W','N','N','E','E']],
  ['混一色（1 番）听牌',     ['1m','2m','3m','4m','5m','6m','E','E','E','N','N','7m','8m']],
  ['垃圾胡（兜底 1 番）',    ['1m','2m','3m','4m','5m','6m','7p','8p','9p','1s','1s','1s','2s']],
  ['碰碰胡（1 番）未听',     ['1m','1m','1m','5m','5m','5m','7p','7p','7p','9p','9p','9p','2s']],
];

(async () => {
  S.initGame();
  console.log('== HUD 与结算口径一致性（敲麻） ==');
  for (const [name, hand] of CASES){
    // 分别测 敲麻 / 清混碰 两套番表
    for (const laji of [true, false]){
      CFG.base = 2; CFG.unit = 1; CFG.lezi = 8; CFG.lajiHu = laji; CFG.sevenPairs = false;
      G.kaibao = false; G.huangfan = 0;
      const p = G.players[0];
      p.hand = mk(hand); p.melds = []; p.flowers = []; p.menqing = true; p.knocked = true;
      p.settleFan = null; p.settleDi = null;
      G.running = true;

      const a = vm.runInContext('analyzeMe()', S);
      // 结算真值：以 HUD 选中的最佳听口（或当前真实牌型）走 scoreOf。
      // 注：清混碰下「垃圾胡」这类牌型本身不能胡（evaluateShape 返回 null），此时没有真实 ev，
      //     HUD 只做方向粗估——这种「无 real ev」的用例跳过严格比对，避免用假 ev 去比。
      let ev = a.best && a.best.ev;
      let realEv = true;
      if (!ev){
        const cur = S.evaluateShape(S.toCounts(p.hand), p.melds, { flowerCount: a.flowers });
        if (cur) ev = cur;
        else { ev = S.evalAll(S.toCounts(p.hand), p.melds.length); realEv = false; }
      }
      const tag = (laji ? '敲麻' : '清混碰') + ' / ' + name;
      if (!realEv){
        ok(tag + ' 无真实牌型时仍有番数（粗估）', typeof a.fan === 'number' && a.fan > 0, a.fan);
        ok(tag + ' 无真实牌型时得分 = 底×番', a.score === Math.min(a.di * Math.max(1, a.fan) * CFG.unit, CFG.lezi * 10 * CFG.unit), { di: a.di, fan: a.fan, sc: a.score });
        continue;
      }
      const sc = S.scoreOf(Object.assign({}, ev, { flowers: a.flowers }), {}, p, 1);
      ok(tag + ' 底一致', a.di === sc.di, { hud: a.di, settle: sc.di });
      ok(tag + ' 番一致', a.fan === sc.fan, { hud: a.fan, settle: sc.fan });
      ok(tag + ' 得分一致', a.score === sc.per, { hud: a.score, settle: sc.per });
    }
  }

  // 番不是「底 × 番」的乘积（回归本次 bug 的直接断言）
  console.log('== 番不得为「底 × 番」的乘积 ==');
  CFG.base = 2; CFG.unit = 1; CFG.lezi = 8; CFG.lajiHu = true; CFG.sevenPairs = false;
  const p = G.players[0];
  p.hand = mk(['1m','2m','3m','4m','5m','6m','7m','8m','9m','9m','9m','2m','2m']);
  p.melds = []; p.flowers = []; p.menqing = true; p.knocked = true; G.running = true;
  const a = vm.runInContext('analyzeMe()', S);
  ok('清一色 底=10 番=4（非 40）', a.di === 10 && a.fan === 4, { di: a.di, fan: a.fan });
  ok('清一色 得分 = 10×4 = 40', a.score === 40, a.score);

  // renderHUD 只是把 analyzeMe() 的 di/fan/score 原样写进 DOM 三个栏位
  // （见 index.html renderHUD：$('mDi')=a.di、$('mFan')=a.fan、$('mScore')=a.score），
  // 上面的断言已覆盖取数口径；DOM 写入由浏览器端 ui_hud 冒烟覆盖。

  console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
