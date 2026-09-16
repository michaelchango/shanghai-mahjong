// m61：v1.3.1 设置面板 —— 机器人按座位分别设置（用AI / 不用AI + 跟着选择的子设置）
//
//  用户要的几件事，逐条锁死（防止以后再被改回去）：
//   1) 规则区（玩法部分）在最前，且**不含**「机器人速度」；
//   2) 每个机器人一行「用AI / 不用AI」：
//        用AI   → 显示 AI 连接状态（就是那个「实测调用成功 Nms」）；
//        不用AI → 选**这一台**自己的出牌速度（慢 / 中 / 快）；
//   3) 顺序：玩法 → 机器人设置 → 语音 → 样式；
//   4) 单机三台各设各的；联机只列还在的机器人（= 空位），并标清是「哪一家 / 哪个座位」；
//   5) AI 连接状态里必须有实测毫秒数 —— 打开设置就能看到，不用自己点「测试连接」。
//  顺序用「整段面板 HTML 里各分区首次出现的位置」来断言 —— 这正是玩家看到的上到下顺序。
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

/* 桩：让 index.html 的引擎段在 node 下能整段 eval。
   初始 location.protocol = 'file:' → probeAi 走「本地文件打开」分支，不联网、不依赖服务端。
   后面有一节会把 protocol 换成 http: 并塞一个假 fetch，专门验「自动实测 + 毫秒数」。 */
const noop = () => {};
global.document = {
  getElementById: () => ({ classList: { contains: () => false } }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop, removeEventListener: noop,
  createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, appendChild: noop }),
  documentElement: { dataset: {} },
  body: { appendChild: noop, classList: { add: noop, remove: noop } },
  head: { appendChild: noop }
};
global.location = { protocol: 'file:' };
global.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
global.addEventListener = noop;
global.matchMedia = () => ({ matches: false, addEventListener: noop });
global.requestAnimationFrame = cb => setTimeout(cb, 0);
global.cancelAnimationFrame = noop;

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = js.indexOf("$('btnHist').onclick");
if (cut < 0){ console.log('CUT FAIL：找不到 $(\'btnHist\').onclick'); process.exit(1); }
js = js.slice(0, cut);

const harness = `
;NET.roomNo = 0; NET.active = false;
var __sheet = '';
openSheet = function(h){ __sheet = h; };
closeSheet = function(){};
render = function(){}; renderActs = function(){}; renderHand = function(){};
renderSeats = function(){}; renderRiver = function(){}; renderFx = function(){};
renderTop = function(){}; renderTurnClock = function(){}; renderRoom = function(){};
renderHUD = function(){}; logMsg = function(){}; toast = function(){}; seatToast = function(){};
global.__api = {
  NET, CFG, AI_CFG, AI_SRV, BOTUI,
  openSet, cfgRows, botAiRows, botSpdRow, aiConnText, aiCfgAnyOn, applyAiCfg, applyAiTier,
  setAiSeat, setAiSpd, testAi, probeAi, aiBrainStat, aiBrainOn, aiSeatOn, spdOf,
  draft(){ return SETDRAFT; },        // SETDRAFT 会被整体替换，必须用取值函数而非快照
  clearDraft(){ SETDRAFT = null; },
  sheet(){ return __sheet; }
};
`;
eval(js + harness + '\n//# sourceURL=m61-engine');

const M = global.__api;
/* 各分区在面板 HTML 里的首次出现位置 —— 越小越靠上 */
function marks(){
  const s = M.sheet();
  return {
    html: s,
    cfg: s.indexOf('底（底花）'),          // 玩法部分（规则区）
    ai: s.indexOf('机器人设置'),            // 机器人分组
    voice: s.indexOf('语音播报') >= 0 ? s.indexOf('语音播报') : s.indexOf('我的音色'),
    felt: s.indexOf('台面颜色')             // 样式：台面
  };
}
/* 服务端可用（机器人真的走大模型）——面板据此显示「用AI / 不用AI」开关 */
function srvOn(){ M.AI_SRV.checked = true; M.AI_SRV.enabled = true; M.AI_SRV.models = { strong: 'hy3' }; M.AI_SRV.serverTier = 'strong'; M.applyAiTier(); }
function srvOff(){ M.AI_SRV.checked = true; M.AI_SRV.enabled = false; M.AI_SRV.reason = '测试：没配环境变量'; M.applyAiTier(); }

(async () => {
  console.log('== 1) 规则区不再包含「机器人速度」 ==');
  {
    const c = M.cfgRows(false), cRoom = M.cfgRows(true, true);
    ok('单机 cfgRows 不含「机器人速度」', c.indexOf('机器人速度') < 0);
    ok('单机 cfgRows 不含 sgSpeed', c.indexOf('sgSpeed') < 0);
    ok('联机 cfgRows 也不含「机器人速度」', cRoom.indexOf('机器人速度') < 0);
    ok('规则区仍有「玩法」行', c.indexOf('玩法') >= 0);
    ok('「机器人速度」这个全局行已删除（改成每台机器人各设各的）', typeof global.speedRows === 'undefined' && !/function speedRows/.test(js));
  }

  console.log('== 2) 单机：三台机器人各一行开关，写清楚是哪一家 ==');
  {
    srvOn();
    M.openSet();
    const m = marks();
    ok('有「机器人设置」分组', m.ai >= 0);
    ok('三台机器人都列出来了', /机器人1 · 阿芳/.test(m.html) && /机器人2 · 阿明/.test(m.html) && /机器人3 · 阿强/.test(m.html), null);
    ok('标明下家 / 对家 / 上家', /下家/.test(m.html) && /对家/.test(m.html) && /上家/.test(m.html));
    ok('每台都有「用AI / 不用AI」两个按钮',
      (m.html.match(/>用AI</g) || []).length === 3 && (m.html.match(/>不用AI</g) || []).length === 3);
    ok('开关带座位号（setAiSeat(值,座位)）',
      m.html.indexOf('setAiSeat(1,1)') >= 0 && m.html.indexOf('setAiSeat(0,2)') >= 0 && m.html.indexOf('setAiSeat(1,3)') >= 0);
    ok('顺序：玩法 < 机器人设置', m.cfg >= 0 && m.ai > m.cfg, [m.cfg, m.ai]);
    ok('顺序：机器人设置 < 语音 < 样式', m.voice > m.ai && m.felt > m.voice, [m.ai, m.voice, m.felt]);
  }

  console.log('== 3) 选了「用AI」→ 显示 AI 连接状态（含实测毫秒） ==');
  {
    M.AI_SRV.probe = { ok: true, ms: 2449 };
    M.openSet();
    let h = M.sheet();
    ok('状态行写着实测毫秒', h.indexOf('实测调用成功 2449ms') >= 0, M.aiConnText());
    ok('三台都显示连接状态（HTML 里出现 3 次）', (h.match(/AI 状态/g) || []).length === 3, (h.match(/AI 状态/g) || []).length);
    // 失败时也要如实写出来，而不是空着
    M.AI_SRV.probe = { ok: false, detail: 'AI_MODEL_NOT_SUPPORTED' };
    ok('实测失败 → 写明失败原因', M.aiConnText().indexOf('❌') >= 0 && M.aiConnText().indexOf('AI_MODEL_NOT_SUPPORTED') >= 0, M.aiConnText());
    M.AI_SRV.probe = { ok: true, ms: 2449 };
  }

  console.log('== 4) 选了「不用AI」→ 只有这一台换成速度设置 ==');
  {
    M.setAiSeat(0, 2);                       // 关掉对家（座位 2）
    ok('AI_CFG.seats[2] = false', M.AI_CFG.seats[2] === false, M.AI_CFG.seats);
    ok('落进引擎读的 CFG.aiSeats[2]', M.CFG.aiSeats[2] === false, M.CFG.aiSeats);
    ok('另外两台不受影响', M.CFG.aiSeats[1] === true && M.CFG.aiSeats[3] === true);
    let h = M.sheet();
    ok('这一台出现「出牌速度」', h.indexOf('出牌速度') >= 0);
    ok('速度段落带座位号 setAiSpd(值,2)', h.indexOf('setAiSpd(0.6,2)') >= 0 && h.indexOf('setAiSpd(1.8,2)') >= 0);
    ok('只有这一台有速度设置（其余两台仍是 AI 状态）',
      (h.match(/出牌速度/g) || []).length === 1 && (h.match(/AI 状态/g) || []).length === 2);
    ok('汇总行写明几台走大模型 / 几台走本地', h.indexOf('本机机器人') >= 0 && h.indexOf('2 台走大模型') >= 0 && h.indexOf('1 台走本地逻辑') >= 0);

    M.setAiSpd(1.8, 2);
    ok('速度写进 AI_CFG.spd[2] 与 CFG.spd[2]', M.AI_CFG.spd[2] === 1.8 && M.CFG.spd[2] === 1.8, [M.AI_CFG.spd, M.CFG.spd]);
    ok('引擎按座位取到快档', M.spdOf({ isBot: true, idx: 2 }) === 1.8);
    ok('没单独设过的座位用全局速度', M.spdOf({ isBot: true, idx: 3 }) === M.CFG.speed);

    console.log('   — 三台全关：引擎干脆不注入大脑（零网络开销） —');
    M.setAiSeat(0, 1); M.setAiSeat(0, 3);
    ok('三台都关掉了', M.aiCfgAnyOn() === false, M.CFG.aiSeats);
    ok('aiBrainOn() = false', M.aiBrainOn() === false);
    ok('面板三行都变成速度设置', (M.sheet().match(/出牌速度/g) || []).length === 3);
    M.setAiSeat(1, 1); M.setAiSeat(1, 3);        // 复原
    ok('恢复「用AI」后大脑重新注入', M.aiBrainOn() === true && M.aiBrainStat().tier === 'strong', M.aiBrainStat());
  }

  console.log('== 5) 服务端没有大模型：不显示开关，只按各自速度出牌 ==');
  {
    srvOff();
    M.openSet();
    const h = M.sheet();
    ok('说明服务端未配置大模型', h.indexOf('服务端未配置大模型') >= 0);
    ok('不再显示「用AI / 不用AI」（点了也没用）', h.indexOf('>用AI<') < 0 && h.indexOf('>不用AI<') < 0);
    ok('三台都给出速度设置', (h.match(/出牌速度/g) || []).length === 3);
    ok('顺序仍然是 玩法 < 机器人设置 < 语音 < 样式', (() => { const m = marks(); return m.ai > m.cfg && m.voice > m.ai && m.felt > m.voice; })());
    srvOn();
  }

  console.log('== 6) 联机：只列还在的机器人，并说清是哪一家 / 哪个座位 ==');
  {
    M.NET.roomNo = '8888'; M.NET.isHost = false; M.NET.tableOn = false;
    M.NET.mySeat = 2;                                  // 我坐座位 2
    // 座位 0、2 有真人（2 是我）；座位 1、3 空着 → 开局补机器人
    M.NET.players = [{ name: '张三' }, null, { name: '我', host: true }, null];
    M.openSet();
    let m = marks(), h = m.html;
    ok('联机分组名一致（机器人设置）', m.ai >= 0);
    ok('只列机器人：两台', (h.match(/>用AI</g) || []).length === 2, (h.match(/>用AI</g) || []).length);
    ok('标明下家 + 真实座位号', h.indexOf('机器人 · 下家') >= 0 && h.indexOf('座位 3 · 空位') >= 0, h);
    ok('标明上家 + 真实座位号', h.indexOf('机器人 · 上家') >= 0 && h.indexOf('座位 1 · 空位') >= 0, h);
    ok('真人坐的位子（对家｜座位 0）不列出来', h.indexOf('机器人 · 对家') < 0 && h.indexOf('座位 0 · 空位') < 0);
    ok('开关的段落 id 按机器人序号', h.indexOf('id="sgAiSeat1"') >= 0 && h.indexOf('id="sgAiSeat3"') >= 0);
    ok('汇总写明本桌几台机器人', h.indexOf('本桌机器人') >= 0 && h.indexOf('2 台走大模型') >= 0);
    ok('非房主只读（span 而非 button）', h.indexOf('class="seg ro"') >= 0 && h.indexOf('<button class="on" onclick="setAiSeat') < 0);
    ok('联机顺序仍是 玩法 < 机器人设置 < 语音 < 样式', m.ai > m.cfg && m.voice > m.ai && m.felt > m.voice);

    console.log('   — 房主：改的是房间草稿，随「确定」一起提交 —');
    M.NET.isHost = true;
    M.clearDraft();
    M.openSet();
    let hh = M.sheet();
    ok('房主可改，且开关带**真实**座位号（下家=座位3 / 上家=座位1）',
      hh.indexOf('onclick="setAiSeat(1,3)"') >= 0 && hh.indexOf('onclick="setAiSeat(0,1)"') >= 0, hh);
    M.setAiSeat(0, 3);                                 // 关掉下家（座位 3）
    ok('写进房间草稿 SETDRAFT.aiSeats[3]', M.draft() && M.draft().aiSeats[3] === false, M.draft() && M.draft().aiSeats);
    M.setAiSpd(0.6, 1);
    ok('速度也写进草稿 SETDRAFT.spd[1]', M.draft().spd[1] === 0.6, M.draft().spd);
    M.clearDraft();
    M.NET.roomNo = 0; M.NET.isHost = false; M.NET.mySeat = -1; M.NET.players = [];
    M.CFG.aiSeats = [true, true, true, true]; M.CFG.spd = [1, 1, 1, 1];
  }

  console.log('== 7) AI 状态里的毫秒是自动测出来的（打开设置就能看到） ==');
  {
    // 切到 http: 环境 + 假 fetch：状态接口说「可用」，probe 细节只在 ?probe=1 时给
    global.location = { protocol: 'http:', hostname: 'game.example.com' };
    const calls = [];
    global.fetch = url => {
      calls.push(String(url));
      const body = /probe=1/.test(String(url))
        ? { enabled: true, models: { strong: 'hy3' }, serverTier: 'strong', probe: { ok: true, ms: 1234 } }
        : { enabled: true, models: { strong: 'hy3' }, serverTier: 'strong' };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    };
    M.AI_SRV.checked = false; M.AI_SRV.probe = null; M.AI_SRV.probing = false;
    M.probeAi();                                       // 普通状态查询
    await new Promise(r => setTimeout(r, 30));
    ok('查到可用后会**自动**补一次真实调用', calls.some(u => /probe=1/.test(u)), calls);
    ok('自动实测的结果留在 AI_SRV.probe 里', !!M.AI_SRV.probe && M.AI_SRV.probe.ms === 1234, M.AI_SRV.probe);
    ok('状态文案带上毫秒数', M.aiConnText().indexOf('实测调用成功 1234ms') >= 0, M.aiConnText());
    ok('测试中会显示「正在实测调用…」', (M.AI_SRV.probing = true) && M.aiConnText().indexOf('正在实测调用') >= 0);
    M.AI_SRV.probing = false;
    M.probeAi();                                       // 再查一次：不应该再打模型（省额度）
    await new Promise(r => setTimeout(r, 30));
    ok('自动实测每页只做一次（不反复刷额度）', calls.filter(u => /probe=1/.test(u)).length === 1, calls);

    console.log('   — 服务端把 probe 冷却挡回时，不能显示成一个假的「实测失败」 —');
    M.AI_SRV.probe = { ok: true, ms: 2449 };
    global.fetch = url => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
      { enabled: true, models: { strong: 'hy3' }, serverTier: 'strong', probe: { ok: false, detail: 'probe 被限流（probe_cd）' } }) });
    M.AI_SRV.probing = false;
    M.testAi();                                        // 立刻再测一次 → 被 20 秒冷却挡回
    await new Promise(r => setTimeout(r, 30));
    ok('记住了「正在冷却」', M.AI_SRV.limited === true, M.AI_SRV);
    ok('上一次的真实耗时仍然显示着', M.AI_SRV.probe && M.AI_SRV.probe.ok && M.aiConnText().indexOf('2449ms') >= 0, M.aiConnText());
    ok('状态行没有出现假的「❌ 实测失败」', M.aiConnText().indexOf('❌') < 0, M.aiConnText());
    M.AI_SRV.probe = null;
    ok('没有旧结论时如实说「冷却中」（而不是失败）', M.aiConnText().indexOf('冷却') >= 0 && M.aiConnText().indexOf('❌') < 0, M.aiConnText());
    M.AI_SRV.limited = false;
    global.location = { protocol: 'file:' };
  }

  console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
