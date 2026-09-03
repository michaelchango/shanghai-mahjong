/**
 * 服务端规则引擎验证（无头仿真）
 *
 * 验证三件事：
 *   1. 能跑 —— index.html 的规则引擎搬到 Node 后，能完整打完一局
 *   2. 能对 —— 连续跑多局，结果分布合理、无异常无死循环
 *   3. 能复现 —— 同一种子跑两次，牌局与结果完全一致（联机防作弊/复盘的基础）
 *
 * 用法：node proto/server/simulate.js [局数]
 */
const { boot } = require('./headless');
const { handSeed } = require('./rng');
const { projectFor } = require('./view');

/** 打一局（四家全 AI 自动出牌） */
async function playHand(seed, roomNo, handNo){
  const S = boot({ seed, instant: true });
  const st = S.__state;
  S.initGame();
  for (const p of st.G.players) p.isBot = true;      // 全 AI，不经过 ask()
  st.G.handNo = handNo || 1;

  await S.runHand();

  const G = st.G;
  return {
    finished: !!G.finished,
    views: [0, 1, 2, 3].map(s => projectFor(S, s)),
    result: G.result ? G.result.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '(无)',
    scores: G.players.map(p => p.score),
    logs: G.logs.slice(),
    discards: G.players.map(p => p.discards.length),
    melds: G.players.map(p => p.melds.length),
    flowers: G.players.map(p => p.flowers.length),
    wallLeft: S.wallLeft()
  };
}

function withTimeout(p, ms, tag){
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('超时 ' + ms + 'ms: ' + tag)), ms))
  ]);
}

/* ---------------- 1. 单局演示 ---------------- */
async function demo(){
  console.log('\n═══ 1. 单局演示 ═══');
  const r = await withTimeout(playHand(handSeed(100001, 1, 0), 100001, 1), 15000, '单局');
  console.log('  已结算      :', r.finished ? '✅' : '❌');
  console.log('  各家分数    :', JSON.stringify(r.scores));
  console.log('  各家出牌数  :', JSON.stringify(r.discards));
  console.log('  各家副露数  :', JSON.stringify(r.melds), ' 花数:', JSON.stringify(r.flowers));
  console.log('  牌墙剩余    :', r.wallLeft);
  console.log('  出牌记录    :', r.logs.length, '条，前 6 条：');
  for (const s of r.logs.slice(0, 6)) console.log('     · ' + s);
  console.log('  结算摘要    :', r.result);
  return r;
}

/* ---------------- 2. 同种子复现 ---------------- */
async function reproducible(){
  console.log('\n═══ 2. 同种子可复现 ═══');
  const seed = handSeed(100001, 7, 2);
  const a = await withTimeout(playHand(seed, 100001, 7), 15000, '复现A');
  const b = await withTimeout(playHand(seed, 100001, 7), 15000, '复现B');
  const same = JSON.stringify(a.scores) === JSON.stringify(b.scores)
            && JSON.stringify(a.logs) === JSON.stringify(b.logs);
  console.log('  种子        :', seed);
  console.log('  第一次分数  :', JSON.stringify(a.scores));
  console.log('  第二次分数  :', JSON.stringify(b.scores));
  console.log('  出牌记录一致:', a.logs.length === b.logs.length ? '✅ ' + a.logs.length + ' 条' : '❌');
  console.log('  完全一致    :', same ? '✅ 同种子必然洗出同一副牌' : '❌ 不可复现');
  return same;
}

/* ---------------- 3. 多局压力统计 ---------------- */
async function stress(n){
  console.log('\n═══ 3. 多局压力测试（' + n + ' 局）═══');
  let ok = 0, bad = 0, unfinished = 0;
  const kind = { 自摸: 0, 点炮: 0, 流局: 0, 八花齐: 0, 其他: 0 };
  let totalSteps = 0, maxSteps = 0, zeroSum = 0;
  const t0 = Date.now();

  for (let i = 0; i < n; i++){
    const room = 200000 + i;
    const hand = (i % 4) + 1;
    const seed = handSeed(room, hand, Math.floor(i / 4) % 4);
    try{
      const r = await withTimeout(playHand(seed, room, hand), 15000, '第 ' + (i + 1) + ' 局');
      totalSteps += r.logs.length;
      maxSteps = Math.max(maxSteps, r.logs.length);
      if (!r.finished){ unfinished++; bad++; continue; }
      // 零和校验：四家分数相加应为 0
      const sum = r.scores.reduce((s, x) => s + x, 0);
      if (sum === 0) zeroSum++;
      // 结局类型
      if (r.result.includes('自摸')) kind.自摸++;
      else if (r.result.includes('点炮') || r.result.includes('胡')) kind.点炮++;
      else if (r.result.includes('流局')) kind.流局++;
      else if (r.result.includes('八花齐')) kind.八花齐++;
      else kind.其他++;
      ok++;
    }catch(e){
      bad++;
      console.log('  ❌ 第 ' + (i + 1) + ' 局异常：' + e.message);
      if (bad > 3) break;
    }
  }

  const dt = Date.now() - t0;
  console.log('  成功 / 失败 :', ok + ' / ' + bad, ' 未完成:', unfinished);
  console.log('  零和校验    :', zeroSum + '/' + ok, '局四家分数合计为 0');
  console.log('  结局分布    :', JSON.stringify(kind));
  console.log('  平均每局手数:', (totalSteps / Math.max(1, ok)).toFixed(1), ' 最多:', maxSteps);
  console.log('  耗时        :', dt + 'ms  平均 ' + (dt / Math.max(1, n)).toFixed(1) + 'ms/局');
  return { ok, bad, unfinished, zeroSum };
}

/* ---------------- 4. 可见性裁剪 ---------------- */
async function verifyView(){
  console.log('\n═══ 4. 可见性裁剪（联机安全边界）═══');
  const r = await withTimeout(playHand(handSeed(300001, 2, 1), 300001, 2), 15000, '投影');
  const views = r.views;
  const checks = [];
  const T = (name, cond, extra) => {
    checks.push({ name, ok: !!cond, extra: extra || '' });
  };

  for (let s = 0; s < 4; s++){
    const v = views[s];
    // 自己能看到自己的手牌，别人看不到
    T('seat' + s + ' 可见自己手牌', Array.isArray(v.players[s].hand) && v.players[s].hand.length > 0,
      v.players[s].hand ? v.players[s].hand.length + ' 张' : 'null');
    const others = [0, 1, 2, 3].filter(i => i !== s);
    T('seat' + s + ' 看不到其他三家手牌',
      others.every(i => v.players[i].hand === null && v.players[i].waits === null));
    // 但要知道别人手里几张牌（画牌背用）
    T('seat' + s + ' 知道他人手牌张数',
      others.every(i => typeof v.players[i].handCount === 'number' && v.players[i].handCount >= 0),
      others.map(i => v.players[i].handCount).join('/'));
    // 牌墙内容永不外发
    T('seat' + s + ' 只拿到牌墙剩余张数',
      v.table.wallLeft != null && JSON.stringify(v).indexOf('"wall"') < 0,
      '剩余 ' + v.table.wallLeft);
  }

  // 公开信息四家看到的一致
  const pubKey = v => JSON.stringify(v.players.map(p => [p.flowers, p.melds, p.discards, p.score, p.knocked]));
  T('四家看到的公开信息一致',
    new Set(views.map(pubKey)).size === 1);
  T('四家看到的牌桌状态一致',
    new Set(views.map(v => JSON.stringify(v.table))).size === 1);

  // 数据量：投影比完整状态小多少
  const full = JSON.stringify({ players: views[0].players.map(p => ({ hand: p.hand, flowers: p.flowers })) , wall: new Array(145).fill(0) });
  const proj = JSON.stringify(views[0]);
  const allProj = views.reduce((s, v) => s + JSON.stringify(v).length, 0);

  for (const c of checks) console.log('  ' + (c.ok ? '✅' : '❌') + ' ' + c.name + (c.extra ? '  (' + c.extra + ')' : ''));
  console.log('  单份投影大小 : ' + (proj.length / 1024).toFixed(1) + ' KB');
  console.log('  四份投影合计 : ' + (allProj / 1024).toFixed(1) + ' KB（每局只发一次快照，之后走增量事件）');

  return checks.every(c => c.ok);
}

/* ---------------- main ---------------- */
(async function(){
  const n = Number(process.argv[2] || 60);
  console.log('上海敲麻 · 服务端规则引擎验证');
  console.log('（引擎由 proto/tools/extract.js 从 index.html 抽取，规则逻辑零改动）');
  try{
    await demo();
    const same = await reproducible();
    const s = await stress(n);
    const viewOk = await verifyView();
    console.log('\n═══ 总结 ═══');
    console.log('  引擎可在 Node 无头运行 :', s.ok > 0 ? '✅' : '❌');
    console.log('  规则结果自洽（零和）   :', s.zeroSum === s.ok ? '✅ ' + s.zeroSum + '/' + s.ok : '❌');
    console.log('  同种子可复现           :', same ? '✅' : '❌');
    console.log('  无死循环 / 无异常       :', s.bad === 0 ? '✅' : '❌ ' + s.bad + ' 局异常');
    console.log('  可见性裁剪有效         :', viewOk ? '✅' : '❌');
    process.exit(s.bad === 0 && same && s.unfinished === 0 && viewOk ? 0 : 1);
  }catch(e){
    console.error('\n❌ 验证失败：' + e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
