// m59：v1.2.53 大模型机器人（AI 大脑）
//  规则与安全边界（本测试的全部断言来源）：
//   · 本地启发式 aiChooseDiscard / aiClaim 是「本地大脑」，也是仿真与单测的确定性基准，
//     注入大模型后它们**一个字都不能变**；
//   · decideDiscard / decideClaim 是 async 包装：本地答案先算好 → 预算内问模型 →
//     答案不合法（不在手牌 / 命中禁打 / opts 里没有）或超时或报错 → 一律回退本地答案；
//   · 胡（有和必和）与敲定后的摸打是规则硬约束，**根本不问模型**；
//   · aiView 只输出该机器人自己看得见的信息（他人手牌、牌墙顺序绝不外泄）。
const cleanEnv = ['CLOUDBASE_ENV', 'TCB_ENV', 'TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY',
  'CLOUDBASE_API_KEY', 'CLOUDBASE_ACCESS_KEY', 'CLOUDBASE_SECRET',
  'AI_BASE', 'AI_BASE_REGION', 'AI_PROVIDER', 'AI_MODEL_GROUP', 'AI_AUTH',
  'AI_MODEL_FAST', 'AI_MODEL_STRONG', 'AI_TIMEOUT_MS', 'AI_BOT', 'AI_BOT_TIER'];
for (const k of cleanEnv) delete process.env[k];

const { boot } = require('../proto/server/headless');
const aibrain = require('../proto/server/aibrain');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

const T = { '1m':0,'2m':1,'3m':2,'4m':3,'5m':4,'6m':5,'7m':6,'8m':7,'9m':8,
  '1p':9,'2p':10,'3p':11,'4p':12,'5p':13,'6p':14,'7p':15,'8p':16,'9p':17,
  '1s':18,'2s':19,'3s':20,'4s':21,'5s':22,'6s':23,'7s':24,'8s':25,'9s':26,
  'E':27,'S':28,'W':29,'N':30,'Z':31,'F':32,'B':33 };
const mk = l => l.map(k => T[k]);

/* ========================================================================
   1) 服务端 aibrain 模块：未配置时必须「关闭而不是报错」
   ======================================================================== */
console.log('== 1) aibrain：未配置环境变量 → 安全关闭 ==');
ok('isEnabled() = false', aibrain.isEnabled() === false, aibrain.isEnabled());
ok('status().reason 给出原因', typeof aibrain.status().reason === 'string' && aibrain.status().reason.length > 0, aibrain.status().reason);
ok('modelFor(fast) = 默认快模型', aibrain.modelFor('fast') === 'hy3', aibrain.modelFor('fast'));
ok('modelFor(strong) 有值', typeof aibrain.modelFor('strong') === 'string' && aibrain.modelFor('strong').length > 0);
// v1.3.0：机器人 AI「默认启用」，联机托管档位默认也跟着开启（配了环境变量才有意义）；
// 想省额度 / 退回旧行为，显式设 AI_BOT_TIER=off。AI_ENV 在模块加载时求值，
// 所以这里只断言「未设变量时的默认值」，读档行为交给下面的 status() 相关用例。
ok('联机托管档位默认 strong（与「默认启用」一致）', aibrain.status().serverTier === 'strong', aibrain.status().serverTier);
ok('_env 暴露的是同一份环境快照', aibrain._env.serverTier === aibrain.status().serverTier);

console.log('== 2) aibrain：输出解析（容忍围栏 / 废话 / 畸形） ==');
ok('纯 JSON', JSON.stringify(aibrain.parseDecision('{"discard":"5筒","reason":"留搭子"}')) === JSON.stringify({ discard: '5筒', reason: '留搭子' }));
{
  const f = aibrain.parseDecision('```json\n{"discard":"1萬"}\n```');
  ok('markdown 围栏', !!f && f.discard === '1萬');
  const g = aibrain.parseDecision('我选择：{"action":"碰","reason":"进张"} 就是这样');
  ok('前后废话', !!g && g.action === '碰');
}
ok('空文本 → null', aibrain.parseDecision('') === null);
ok('非 JSON → null', aibrain.parseDecision('抱歉我不确定') === null);
ok('坏 JSON → null', aibrain.parseDecision('{"discard":') === null);
ok('reason 截断到 40 字', aibrain.parseDecision('{"discard":"1萬","reason":"' + 'x'.repeat(80) + '"}').reason.length === 40);

console.log('== 3) aibrain：系统提示逐字稳定（命中上下文缓存的前提） ==');
{
  const a = aibrain.buildMessages('discard', { hand: ['1萬'] })[0].content;
  const b = aibrain.buildMessages('discard', { hand: ['2筒', '3筒'], wallLeft: 10 })[0].content;
  ok('同一 kind 的 system 段完全一致', a === b);
  ok('user 段承载局面', JSON.parse(aibrain.buildMessages('discard', { hand: ['1萬'] })[1].content).hand[0] === '1萬');
  ok('claim 用另一套 system', aibrain.buildMessages('claim', {})[0].content !== a);

  // 强档：view 带 candidates → 换用「候选内定夺」那套 system，且同样逐字稳定
  const WITH_CAND = { hand: ['1萬'], candidates: [{ tile: '一萬', shanten: 1, danger: 0 }] };
  const c = aibrain.buildMessages('discard', WITH_CAND)[0].content;
  const d = aibrain.buildMessages('discard', { hand: ['9筒'], candidates: [{ tile: '九筒', shanten: 2, danger: 1 }] })[0].content;
  ok('有候选 → 换用强档 system', c !== a && /candidates/.test(c));
  ok('强档 system 也逐字稳定', c === d);
  ok('强档 system 明确限定只能在候选中选', /候选/.test(c) && /只能/.test(c));
  ok('空候选数组 → 回落到快档 system（不会误用强档提示）',
    aibrain.buildMessages('discard', { hand: ['1萬'], candidates: [] })[0].content === a);
  ok('claim 即便带 candidates 也用 claim 那套', aibrain.buildMessages('claim', WITH_CAND)[0].content !== c);
}

/* ========================================================================
   2) 引擎侧适配层：注入假大脑，逐个验证「接管 / 回退 / 不问」
   ======================================================================== */
async function main(){
  console.log('== 4) 引擎：注入点与包装函数存在 ==');
  const S = boot({ instant: false });      // 需要真实计时器：测「预算内接管」与「超时回退」
  const st = S.__state, CFG = st.CFG, G = st.G;
  CFG.speed = 1.8;                          // 机器人速度：只影响本地逻辑的出牌节奏，与 AI 预算无关
  S.initGame();
  ok('setAiBrain 可注入', typeof S.setAiBrain === 'function');
  ok('decideDiscard / decideClaim 存在', typeof S.decideDiscard === 'function' && typeof S.decideClaim === 'function');
  ok('aiBrainStat 存在', typeof S.aiBrainStat === 'function');

  const P = G.players[0];
  function reset(){
    P.idx = 0;
    P.melds = []; P.flowers = []; P.discards = []; P.knocked = false; P.missHu = new Set();
    P.name = '我'; P.target = null; P.aiWhy = '';
  }
  function fakeAsk(reply, opts){
    const box = { calls: 0, last: null };
    box.brain = { ask: payload => { box.calls++; box.last = payload; return (opts && opts.never) ? new Promise(() => {}) : Promise.resolve(reply); } };
    return box;
  }
  const HAND = ['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','2p','3p','5p'];

  console.log('== 5) 本地一致性：不注入 → 与本地启发式逐张相同 ==');
  {
    const hands = [
      HAND,
      ['1m','1m','1m','3p','4p','5p','7s','8s','9s','E','E','F','B'],
      ['2p','3p','4p','2s','3s','4s','6m','6m','6m','9m','9m','N','N']
    ];
    let same = true;
    for (const h of hands){
      reset(); P.hand = mk(h);
      S.setAiBrain(null, 'local');
      if (S.aiChooseDiscard(P, []) !== await S.decideDiscard(P, [])) same = false;
    }
    ok('AI_BRAIN 为空 → decideDiscard 与 aiChooseDiscard 完全一致', same);
    ok('未注入时 aiBrainStat().on = false', S.aiBrainStat().on === false);
  }

  console.log('== 6) 出牌：合法答案由模型接管 ==');
  {
    reset(); P.hand = mk(HAND);
    const box = fakeAsk({ discard: '五筒', reason: '留搭子' });
    S.setAiBrain(box.brain, 'fast');
    const d = await S.decideDiscard(P, []);
    ok('采用模型的牌', d === T['5p'], d);
    ok('恰好问了一次', box.calls === 1, box.calls);
    ok('payload 带 tier / view', !!box.last && box.last.tier === 'fast' && !!box.last.view && !!box.last.view.mode);
    ok('reason 记录到玩家 aiWhy（供后续思考气泡）', P.aiWhy === '留搭子', P.aiWhy);
    ok('记了一次命中', S.aiBrainStat().hits === 1, S.aiBrainStat());

    // 容错：模型写成「5筒 / 5p / 五筒」都要认出同一张牌
    for (const alt of ['5筒', '5p', '5P', '5筒 ']){
      reset(); P.hand = mk(HAND);
      const bx = fakeAsk({ discard: alt });
      S.setAiBrain(bx.brain, 'fast');
      ok('容错写法「' + alt + '」→ 五筒', await S.decideDiscard(P, []) === T['5p'], alt);
    }
    reset(); P.hand = mk(HAND);
    const bz = fakeAsk({ discard: '1万' });
    S.setAiBrain(bz.brain, 'fast');
    ok('容错写法「1万」→ 一萬', await S.decideDiscard(P, []) === T['1m']);
  }

  console.log('== 7) 出牌：模型答非法 → 回退本地（三种非法） ==');
  {
    const cases = [
      { name: '手里没有这张', reply: { discard: '九條' }, bans: [] },
      { name: '胡说八道（非牌名）', reply: { discard: '麻将' }, bans: [] },
      { name: '打了本回合禁打的牌', reply: { discard: '三萬' }, bans: [T['3m']] }
    ];
    let reply = null;
    const box = { calls: 0, brain: { ask: () => Promise.resolve(reply) } };
    S.setAiBrain(box.brain, 'fast');
    const m0 = S.aiBrainStat().miss;
    let allFallback = true;
    for (const c of cases){
      reply = c.reply;
      reset(); P.hand = mk(HAND);
      const local = S.aiChooseDiscard(P, c.bans);
      const d = await S.decideDiscard(P, c.bans);
      if (d !== local){ allFallback = false; console.log('     ↳ ' + c.name + ' 未回退：' + d + ' vs ' + local); }
    }
    ok('三种非法答案全部回退本地', allFallback);
    ok('非法计数累加了 3 次', S.aiBrainStat().miss - m0 === 3, S.aiBrainStat().miss - m0);
  }

  console.log('== 8) 出牌：超时 / 抛异常 / 垃圾输出 → 回退本地，且不卡死 ==');
  {
    reset(); P.hand = mk(HAND);
    const local = S.aiChooseDiscard(P, []);
    const never = fakeAsk(null, { never: true });
    S.setAiBrain(never.brain, 'fast');
    const t0 = Date.now();
    const d1 = await S.decideDiscard(P, []);
    const ms = Date.now() - t0;
    ok('超时回退本地', d1 === local, d1);
    // 预算要容得下模型一次真实往返（实测 hy3 约 1.1~1.6s），否则每手都会回退本地
    ok('等待时间落在预算附近（1.6~3.0s，快档 base 2200ms）', ms >= 1600 && ms <= 3000, ms);
    ok('失败原因记为 timeout', S.aiBrainStat().err === 'timeout', S.aiBrainStat().err);

    reset(); P.hand = mk(HAND);
    S.setAiBrain({ ask: () => Promise.reject(new Error('network down')) }, 'fast');
    ok('抛异常也回退本地', (await S.decideDiscard(P, [])) === local);

    reset(); P.hand = mk(HAND);
    S.setAiBrain({ ask: () => Promise.resolve('我不知道打什么') }, 'fast');
    ok('垃圾输出也回退本地', (await S.decideDiscard(P, [])) === local);
  }

  console.log('== 8b) 强档：引擎先算候选，模型只在候选里定夺 ==');
  {
    // 候选排序本身要靠谱：向听优者在前，且候选不超 K 张、不含禁打牌
    reset(); P.hand = mk(HAND);
    const rank = S.aiRankDiscards(P, [], 4);
    ok('aiRankDiscards 返回不超过 K 张', Array.isArray(rank) && rank.length > 0 && rank.length <= 4, rank.length);
    let sorted = true;
    for (let i = 1; i < rank.length; i++) if (rank[i].val > rank[i - 1].val) sorted = false;
    ok('候选按综合分降序', sorted);
    ok('候选首张就是本地启发式的选择', rank[0].t === S.aiChooseDiscard(P, []), rank[0].t);
    ok('候选带 shanten / danger 两个判据', typeof rank[0].sh === 'number' && typeof rank[0].danger === 'number', rank[0]);
    {
      const banned = [rank[0].t];
      const r2 = S.aiRankDiscards(P, banned, 4);
      ok('禁打牌不进候选', r2.every(c => banned.indexOf(c.t) < 0), r2.map(c => c.t));
    }

    // 强档的 view 里要真的带上候选，且 payload 的 tier = strong
    reset(); P.hand = mk(HAND);
    {
      const box = fakeAsk({ discard: '五筒' });
      S.setAiBrain(box.brain, 'strong');
      await S.decideDiscard(P, []);
      ok('payload tier = strong', box.last.tier === 'strong', box.last.tier);
      const cs = box.last.view.candidates;
      ok('view.candidates 是牌名数组', Array.isArray(cs) && cs.length > 0 && typeof cs[0].tile === 'string', cs && cs[0]);
      ok('候选里的牌名可被引擎还原', S.tileFromName(cs[0].tile) != null, cs[0].tile);
      ok('候选不泄漏他人手牌（只看得到牌河与副露）',
        !('hands' in box.last.view) && box.last.view.table.every(q => !('hand' in q)));
    }

    // 关键纪律：强档下模型若选了候选以外的牌 → 必须回退本地
    reset(); P.hand = mk(HAND);
    {
      const local = S.aiChooseDiscard(P, []);
      const cands = S.aiRankDiscards(P, [], 4).map(c => c.t);
      const outside = mk(HAND).find(t => cands.indexOf(t) < 0 && P.hand.indexOf(t) >= 0);
      ok('该手牌确实存在「候选之外」的牌可打（否则本用例无意义）', outside != null);
      const box = fakeAsk({ discard: S.tileName(outside), reason: '我偏要打这张' });
      S.setAiBrain(box.brain, 'strong');
      const d = await S.decideDiscard(P, []);
      ok('模型越出候选 → 回退本地答案', d === local, [S.tileName(d), S.tileName(local)]);
      ok('越界记一次未命中', S.aiBrainStat().miss >= 1, S.aiBrainStat().miss);
    }

    // 强档的预算要比快档宽（够模型把候选表读完）
    reset();
    S.setAiBrain(null, 'local'); CFG.speed = 1;
    const bLocal = S.aiBudget();
    S.setAiBrain(fakeAsk({ discard: '五筒' }).brain, 'fast');
    const bFast = S.aiBudget();
    S.setAiBrain(fakeAsk({ discard: '五筒' }).brain, 'strong');
    const bStrong = S.aiBudget();
    ok('预算：强档 > 快档', bStrong > bFast, [bFast, bStrong]);
    ok('预算容得下模型一次往返（快档 ≥ 2s）', bFast >= 2000, bFast);
    ok('预算 = 档位基准，不随 local 档变化', bLocal === bFast, [bLocal, bFast]);
    // v1.3.0：「机器人速度」调的是本地逻辑的节奏，走大模型时它不该影响预算 ——
    // 否则速度设「快」→ 预算被砍 25% → 每手超时静默回退，看着像「AI 没生效」。
    CFG.speed = 0.6; const bSlow = S.aiBudget();
    CFG.speed = 1.8; const bQuick = S.aiBudget();
    ok('速度档不再影响 AI 预算（防静默回退）', bSlow === bStrong && bQuick === bStrong, [bSlow, bStrong, bQuick]);
    CFG.speed = 1.8;
    S.setAiBrain(null, 'local');
  }

  console.log('== 9) 规则硬约束：敲定后不问模型 ==');
  {
    reset(); P.hand = mk(HAND); P.knocked = true;
    const box = fakeAsk({ discard: '5筒' });
    S.setAiBrain(box.brain, 'fast');
    const d = await S.decideDiscard(P, []);
    ok('敲定后一次都没问', box.calls === 0, box.calls);
    ok('结果等于本地答案', d === S.aiChooseDiscard(P, []), d);
  }

  console.log('== 10) 碰吃杠：模型可决定，但必须落在 opts 之内 ==');
  {
    const hand = mk(['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','1p','E','E']);
    const setup = () => { reset(); P.hand = hand.slice(); };

    setup();
    const opts1 = S.claimOptions(P, T['1p'], 3, true);
    ok('该局面确实有碰选项', opts1.some(o => o.k === 'pung'), opts1.map(o => o.k));

    setup();
    {
      const box = fakeAsk({ action: '碰', reason: '进张' });
      S.setAiBrain(box.brain, 'fast');
      const pick = await S.decideClaim(P, T['1p'], 3, opts1, true);
      ok('模型说碰 → 返回 pung 选项', !!pick && pick.k === 'pung', pick && pick.k);
      ok('reason 落到 aiWhy', P.aiWhy === '进张', P.aiWhy);
    }

    setup();
    {
      const box = fakeAsk({ action: '过', reason: '不亮牌' });
      S.setAiBrain(box.brain, 'fast');
      ok('模型说过 → null（碰吃都不要）', (await S.decideClaim(P, T['1p'], 3, opts1, true)) === null);
    }

    setup();
    {
      const box = fakeAsk({ action: '杠', reason: '胡闹' });   // opts 里没有杠 → 非法
      S.setAiBrain(box.brain, 'fast');
      const local = S.aiClaim(P, T['1p'], 3, opts1, true);
      ok('模型选了不存在的动作 → 回退本地', (await S.decideClaim(P, T['1p'], 3, opts1, true)) === local);
    }

    setup();
    {
      const box = fakeAsk({ action: '碰' }, { never: true });
      S.setAiBrain(box.brain, 'fast');
      const local = S.aiClaim(P, T['1p'], 3, opts1, true);
      ok('碰吃决策超时 → 回退本地', (await S.decideClaim(P, T['1p'], 3, opts1, true)) === local);
    }
  }

  console.log('== 11) 规则硬约束：有和必和，胡不进模型 ==');
  {
    reset();
    P.hand = mk(['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','2p','3p']);
    CFG.lajiHu = true; P.knocked = true;
    const opts = [{ k: 'hu', tile: T['3p'] }];
    const box = fakeAsk({ action: '过' });
    S.setAiBrain(box.brain, 'fast');
    const pick = await S.decideClaim(P, T['3p'], 1, opts, false);
    ok('有和必和：直接返回 hu', !!pick && pick.k === 'hu', pick && pick.k);
    ok('一次都没问模型', box.calls === 0, box.calls);
  }

  console.log('== 12) 视野纪律：aiView 不含他人手牌 / 牌墙顺序 ==');  {
    reset();
    P.hand = mk(HAND);
    // 给别家塞一手「独有牌」（白板），并保证牌河/副露里都不出现白板
    for (let i = 1; i < 4; i++){
      G.players[i].hand = mk(Array(13).fill('B'));
      G.players[i].discards = mk(['1s']);
      G.players[i].melds = [];
    }
    P.discards = mk(['9s']);
    const view = S.aiView(P, 'discard', { bans: [] });
    const s = JSON.stringify(view);
    ok('view 不含他人手牌里的白板', s.indexOf('白') < 0, s.slice(0, 120));
    ok('view 只暴露公开的牌河/副露', Array.isArray(view.table) && view.table.length === 4 &&
        Object.keys(view.table[0]).sort().join(',') === 'discards,melds', Object.keys(view.table[0]));
    ok('view 不含牌墙内容', !('wall' in view) && !('wallTiles' in view));
    ok('合法出牌列表非空且带禁打字段', Array.isArray(view.legal) && view.legal.length > 0 && 'banned' in view);
    ok('view.hand 是自己的手牌', view.hand.length === 13 && view.hand[0] === '一萬', view.hand);
  }

  console.log('== 13) 牌名归一化：模型的各种写法都要认出同一张牌 ==');
  {
    const cases = [
      ['五筒', '五筒'], ['5筒', '五筒'], ['5p', '五筒'], ['5P', '五筒'],
      ['1万', '一萬'], ['三條', '三條'], ['7s', '七條'],
      ['东', '東'], ['东风', '東'], ['东風', '東'],
      ['发', '發'], ['发财', '發'], ['白板', '白'], ['红中', '中'],
      [' 四萬 ', '四萬'], ['９筒', '九筒']
    ];
    let all = true;
    for (const [raw, want] of cases){
      const got = S.normTileName(raw);
      if (got !== want){ all = false; console.log('     ↳ ' + raw + ' → ' + got + '（期望 ' + want + '）'); }
    }
    ok('全部写法归一化正确', all);
    ok('编码表可反查', S.tileFromName('五筒') === T['5p'] && S.tileFromName('一萬') === T['1m'] && S.tileFromName('東') === T['E']);
    ok('乱输入返回 null（不抛异常）', S.tileFromName('麻将') === null && S.tileFromName('') === null && S.tileFromName(null) === null);
  }

  console.log('== 14) HTTP 传输层：请求形态 / 鉴权重试 / 错误分类（本地桩服务） ==');
  {
    const http = require('http');
    const calls = [];
    let mode = 'ok';
    const stub = http.createServer((req, res) => {
      let buf = '';
      req.on('data', c => buf += c);
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(buf); } catch (e){}
        calls.push({ url: req.url, auth: req.headers.authorization, body });
        const send = (code, obj) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
        };
        const CHOICE = c => send(200, { choices: [{ message: { role: 'assistant', content: c } }], usage: { total_tokens: 42 } });
        if (mode === 'ok') return CHOICE('{"discard":"五筒","reason":"留搭子"}');
        // 只认裸 key（模拟「Bearer 不认、裸 key 认」的网关）→ 验自动重试
        if (mode === 'rawonly') return (req.headers.authorization || '').startsWith('Bearer ')
          ? send(401, { code: 'INVALID_CREDENTIALS' })
          : CHOICE('{"discard":"五筒"}');
        if (mode === 'authfail') return send(401, { code: 'INVALID_CREDENTIALS', message: 'Credentials are invalid.' });
        if (mode === 'apiErr') return send(200, { code: 'AI_MODEL_NOT_SUPPORTED', message: 'not enabled' });
        if (mode === 'badJson') return send(200, 'this-is-not-json');
        if (mode === 'noChoice') return send(200, { ok: true });
        if (mode === 'hang') return;                 // 不回包 → 触发超时
      });
    });
    await new Promise(r => stub.listen(0, '127.0.0.1', r));
    const port = stub.address().port;

    // AI_ENV 在模块加载时快照，所以环境变量必须在 require 之前设好
    const KEY = 'k'.repeat(120);
    process.env.CLOUDBASE_ENV = 'unit-test-env';
    process.env.CLOUDBASE_API_KEY = KEY;
    process.env.AI_BASE = 'http://127.0.0.1:' + port;
    process.env.AI_AUTH = 'auto';
    process.env.AI_TIMEOUT_MS = '500';
    delete require.cache[require.resolve('../proto/server/aibrain')];
    const ab = require('../proto/server/aibrain');
    const VIEW = { mode: '敲麻', seat: 0, hand: ['一萬'], legal: ['一萬'], banned: [], table: [], wallLeft: 5 };
    const ask = () => ab.decide({ kind: 'discard', tier: 'fast', view: VIEW });

    ab._reset();
    const r1 = await ask();
    ok('桩服务正常返回 → ok + 解析出答案', r1.ok === true && r1.discard === '五筒' && r1.reason === '留搭子', r1);
    ok('打到 /v1/ai/{provider}/chat/completions', calls[0].url === '/v1/ai/cloudbase/chat/completions', calls[0].url);
    ok('默认 Authorization 用 Bearer + 完整 key', calls[0].auth === 'Bearer ' + KEY, String(calls[0].auth).slice(0, 24) + '…');
    ok('请求体是 OpenAI 形态，system 段在前', calls[0].body.model === 'hy3' &&
      calls[0].body.messages[0].role === 'system' && calls[0].body.messages[1].role === 'user');
    ok('usage 透传', !!r1.usage && r1.usage.total_tokens === 42, r1.usage);
    ok('同局面命中缓存 → 不再发第二次请求', (await ask()).cached === true && calls.length === 1, calls.length);
    ok('status() 只报 key 长度不泄漏密钥', ab.status().keyLen === 120 && ab.status().enabled === true, ab.status());

    calls.length = 0; mode = 'rawonly'; ab._reset();
    const r2 = await ask();
    ok('Bearer 被拒时自动换裸 key 重试成功', r2.ok === true && calls.length === 2 && calls[1].auth === KEY, calls.map(c => String(c.auth).slice(0, 8)));

    mode = 'authfail'; ab._reset();
    const r3 = await ask();
    ok('两种写法都 401 → 报 auth（回退本地由上层做）', r3.ok === false && r3.error === 'auth', r3);

    mode = 'apiErr'; ab._reset();
    const r4 = await ask();
    ok('网关业务错码 → 归类 api 并翻译成人话', r4.ok === false && r4.error === 'api' && /未在此环境启用/.test(r4.detail), r4);

    mode = 'badJson'; ab._reset();
    ok('非 JSON 响应 → parse 错误', (await ask()).error === 'parse');

    mode = 'noChoice'; ab._reset();
    ok('响应没有 choices → parse 错误', (await ask()).error === 'parse');

    mode = 'hang'; ab._reset();
    {
      const t0 = Date.now();
      const r5 = await ask();
      const ms = Date.now() - t0;
      ok('不回包 → 超时中止，不挂死', r5.ok === false && r5.error === 'timeout' && ms < 2000, { r5, ms });
    }

    mode = 'ok'; ab._reset();
    ok('probe() 真实打一次 → ok', (await ab.probe(true)).ok === true);
    mode = 'authfail';
    ok('probe() 失败时带原因', (await ab.probe(true)).ok === false);

    await new Promise(r => stub.close(r));
    for (const k of cleanEnv) delete process.env[k];
    delete require.cache[require.resolve('../proto/server/aibrain')];
  }

  console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('测试异常：', e && e.stack || e); process.exit(1); });
