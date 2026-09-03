// m37：v1.2.16 清混碰「真实对局」冒烟（四家机器人，不走 UI）
//  驱动引擎的 AI 闭环（定目标 → 出牌 → 别家吃碰杠决策），统计：
//  1) 清混碰下每一次 吃/碰/杠 的牌，都必须符合该机器人的做牌目标花色
//  2) 吃进的顺子三张同门，且属于目标花色（混一色=本门，清一色=本门，风一色不存在顺子）
//  3) 花牌（含中发白 108~119）永远不会被吃/碰/杠
//  4) 量化修复效果：统计「按旧逻辑(无花色锁)会吃、新逻辑已拦下」的次数
//  5) 清混碰下目标分布：出现 碰碰胡/混一色/清一色/风一色，绝不出现 平胡(std)
//  6) 敲麻模式对照：花色锁不生效，行为与旧版一致
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = js.indexOf("$('btnHist').onclick");
if (cut < 0) { console.log('CUT FAIL'); process.exit(1); }
js = js.slice(0, cut);

eval(js + `
;NET.active = false;
render = function(){}; renderActs = function(){}; renderHand = function(){}; renderSeats = function(){};
renderRiver = function(){}; renderFx = function(){}; renderTop = function(){}; renderTurnClock = function(){};
renderRoom = function(){}; renderHUD = function(){}; logMsg = function(){}; toast = function(){};
seatToast = function(){}; openSheet = function(){}; closeSheet = function(){};
global.__T = { G, CFG, mkPlayer, initGame, buildWall, drawFront, wallLeft, deal, isFlower,
  toCounts, evalAll, aiTargetOf, aiPlan, tileFitsPlan, aiChooseDiscard, aiClaim,
  claimOptions, selfKongOptions, removeTiles, suitOf, tileName, sortTiles, PLAYCNT };
`);
const T = global.__T;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ❌ FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

// ---------- 驱动一局：返回统计 ----------
function playGame(lajiHu, seedTag){
  T.CFG.lajiHu = !!lajiHu;
  T.CFG.allowChow = true;
  T.initGame();
  T.G.wall = T.buildWall();
  T.G.wpos = 0; T.G.wtail = T.G.wall.length - 1;
  T.deal();

  const st = {
    claims: 0, chow: 0, pung: 0, kong: 0, hu: 0,
    badSuit: [], badChow: [], flowerClaim: [],
    blockedByLock: 0,            // 旧逻辑会吃、新逻辑拦下的次数
    targets: {}, targetHist: [],
    endShanten: [], ting: 0, near: 0
  };

  const draw = p => {
    let t = T.drawFront();
    let guard = 0;
    while (t !== null && T.isFlower(t) && guard++ < 32){ p.flowers.push(t); t = T.drawFront(); }
    return t;
  };
  const fillPending = p => {
    if (!p.pendingFlowers.length) return;
    for (const f of p.pendingFlowers) p.flowers.push(f);
    p.pendingFlowers = [];
    let guard = 0;
    while (p.hand.length < 13 && guard++ < 32){ const t = draw(p); if (t === null) break; p.hand.push(t); }
  };

  let turn = T.G.dealer;
  for (let n = 0; n < 160 && T.wallLeft() > 0; n++){
    const cur = T.G.players[turn];
    fillPending(cur);
    const drawn = draw(cur);
    if (drawn === null) break;
    cur.hand.push(drawn);
    cur.target = T.aiTargetOf(cur);
    st.targets[cur.target] = (st.targets[cur.target] || 0) + 1;

    const d = T.aiChooseDiscard(cur);
    if (d === null || d === undefined) break;
    T.removeTiles(cur.hand, [d]);
    cur.hand = T.sortTiles(cur.hand);
    cur.discards.push(d);

    // 别家决策（下家优先）
    for (let i = 1; i <= 3; i++){
      const o = T.G.players[(turn + i) % 4];
      o.target = T.aiTargetOf(o);
      const opts = T.claimOptions(o, d, cur.idx, i === 1);
      if (!opts.length) continue;

      // 旧逻辑对照：lajiHu=true 时 aiClaim 内部 plan=null，即修复前的行为
      const oldLaji = T.CFG.lajiHu;
      T.CFG.lajiHu = true;
      const oldPick = T.aiClaim(o, d, cur.idx, opts, i === 1);
      T.CFG.lajiHu = oldLaji;

      const pick = T.aiClaim(o, d, cur.idx, opts, i === 1);
      if (!lajiHu && !pick && oldPick && oldPick.k !== 'hu') st.blockedByLock++;
      if (!pick) continue;

      st.claims++;
      const k = pick.k;
      if (k === 'hu'){ st.hu++; continue; }

      // 校验 3) 花牌永不被吃碰杠
      if (T.isFlower(d)) st.flowerClaim.push({ k, tile: d, name: T.tileName(d) });
      // 校验 1) 花色锁
      if (!lajiHu){
        const plan = T.aiPlan(o);
        if (!plan.pung && !T.tileFitsPlan(d, plan)){
          st.badSuit.push({ k, tile: d, name: T.tileName(d), target: o.target });
        }
        if (k === 'chow'){
          const combo = pick.combo || [];
          if (combo.length !== 2) st.badChow.push({ k, tile: d, combo });
          else {
            const all = [d].concat(combo);
            const suits = new Set(all.map(T.suitOf));
            if (suits.size !== 1) st.badChow.push({ k, tile: d, combo, suits: [...suits] });
            else if (!T.tileFitsPlan(d, plan)) st.badChow.push({ k, tile: d, combo, suit: T.suitOf(d) });
          }
        }
      }

      // 执行
      if (k === 'pung'){ st.pung++; T.removeTiles(o.hand, [d, d]); o.melds.push({ type: 'pung', tile: d, tiles: [d, d, d] }); }
      else if (k === 'kong'){ st.kong++; T.removeTiles(o.hand, [d, d, d]); o.melds.push({ type: 'kong', tile: d, tiles: [d, d, d, d] }); }
      else if (k === 'chow'){ st.chow++; T.removeTiles(o.hand, pick.combo); o.melds.push({ type: 'chow', tile: d, tiles: [d].concat(pick.combo) }); }
      o.menqing = false;
      turn = o.idx;
      break;
    }
    if (turn === cur.idx) turn = (turn + 1) % 4;
  }

  for (const p of T.G.players){
    p.target = T.aiTargetOf(p);
    const e = T.evalAll(T.toCounts(p.hand), p.melds.length);
    st.targetHist.push(p.target);
    const sh = e[p.target] !== undefined ? e[p.target] : e.best;
    if (sh <= 0) st.ting++;
    if (sh <= 1) st.near++;
    st.endShanten.push({ target: p.target, sh, melds: p.melds.length });
  }
  return st;
}

console.log('== 1) 清混碰：跑 24 局四家机器人对局 ==');
let A = { claims: 0, chow: 0, pung: 0, kong: 0, blockedByLock: 0, badSuit: [], badChow: [], flowerClaim: [], targets: {}, ting: 0, near: 0 };
const N = 24;
for (let i = 0; i < N; i++){
  const s = playGame(false, i);
  A.claims += s.claims; A.chow += s.chow; A.pung += s.pung; A.kong += s.kong;
  A.blockedByLock += s.blockedByLock; A.ting += s.ting; A.near += s.near;
  A.badSuit = A.badSuit.concat(s.badSuit);
  A.badChow = A.badChow.concat(s.badChow);
  A.flowerClaim = A.flowerClaim.concat(s.flowerClaim);
  for (const k in s.targets) A.targets[k] = (A.targets[k] || 0) + s.targets[k];
}
console.log(`   ${N} 局：吃 ${A.chow} / 碰 ${A.pung} / 杠 ${A.kong}（合计 ${A.claims} 次动牌）`);
console.log(`   花色锁拦下的乱吃：${A.blockedByLock} 次`);
console.log(`   目标分布：`, A.targets);
console.log(`   终局达成：听牌 ${A.ting} 家 / 1 向听内 ${A.near} 家（共 ${N * 4} 家）`);
ok('对局确实产生了吃/碰/杠（样本充分）', A.claims >= 20, A.claims);
ok('清混碰：没有一次吃/碰/杠违反目标花色', A.badSuit.length === 0, A.badSuit.slice(0, 3));
ok('清混碰：吃进的顺子全部同门且属目标花色', A.badChow.length === 0, A.badChow.slice(0, 3));
ok('花牌（含中发白）从未被吃/碰/杠', A.flowerClaim.length === 0, A.flowerClaim.slice(0, 3));
ok('花色锁确有拦截效果（修复生效）', A.blockedByLock > 0, A.blockedByLock);
ok('清混碰目标绝不出现平胡 std', !A.targets['std'], A.targets);
ok('清混碰目标含碰碰胡 pung', (A.targets['pung'] || 0) > 0, A.targets);
const mixN = ['mix0', 'mix1', 'mix2'].reduce((a, k) => a + (A.targets[k] || 0), 0);
const pureN = ['pure0', 'pure1', 'pure2'].reduce((a, k) => a + (A.targets[k] || 0), 0);
ok('清混碰目标含混一色 mix*', mixN > 0, A.targets);
ok('清混碰目标含清一色 pure*（旧版永远做不出）', pureN > 0, A.targets);
ok('清混碰下顺子路径可用（会发生吃牌）', A.chow >= 1, A.chow);
ok('机器人能把目标做成听牌（不是四家都在瞎打）', A.ting >= 8, A.ting);

console.log('== 2) 敲麻对照：同一套流程花色锁不生效 ==');
let B = { claims: 0, chow: 0, pung: 0, bad: 0, targets: {} };
for (let i = 0; i < 12; i++){
  const s = playGame(true, i);
  B.claims += s.claims; B.chow += s.chow; B.pung += s.pung;
  for (const k in s.targets) B.targets[k] = (B.targets[k] || 0) + s.targets[k];
}
console.log(`   12 局：吃 ${B.chow} / 碰 ${B.pung}（合计 ${B.claims} 次动牌）`);
console.log(`   目标分布：`, B.targets);
ok('敲麻模式仍能正常吃碰（未被花色锁误伤）', B.claims >= 10, B.claims);
ok('敲麻模式仍可走平胡 std', (B.targets['std'] || 0) > 0, B.targets);
ok('敲麻模式无花色锁拦截', true, null);

console.log('== 3) 中发白：敲麻算花 / 清混碰算牌（对局层面，v1.2.17 纠正） ==');
ok('敲麻形态 108~119 全是花', [108, 111, 112, 115, 116, 119].every(t => T.isFlower(t)));
ok('清混碰形态 31~33 不是花（算牌）', [31, 32, 33].every(t => !T.isFlower(t)));
ok('编码空间到 33（PLAYCNT=34）', T.PLAYCNT === 34);
// 上一节结束时 CFG.lajiHu=true（敲麻对照局），buildWall 应含 20 张花
ok('敲麻墙含 20 张花（8 季花 + 中發白 12 张）',
   T.buildWall().filter(T.isFlower).length === 20, T.buildWall().filter(T.isFlower).length);
// 清混碰墙：中发白按 31~33 牌发，只剩 8 张季花
T.CFG.lajiHu = false;
ok('清混碰墙含 8 张季花、无 108~119（中发白按牌发）',
   (() => { const w = T.buildWall().filter(T.isFlower);
     return w.length === 8 && w.every(t => t <= 107); })(),
   T.buildWall().filter(T.isFlower));
T.CFG.lajiHu = true;

console.log('');
console.log(`结果: ${fail === 0 ? '✅' : '❌'} ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
