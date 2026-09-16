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
openSheet = function(h, kind){ __sheet = h; SHEET_KIND = kind || ''; };   // v1.3.3：桩也要记弹窗种类
closeSheet = function(){ SHEET_KIND = ''; };
render = function(){}; renderActs = function(){}; renderHand = function(){};
renderSeats = function(){}; renderRiver = function(){}; renderFx = function(){};
renderTop = function(){}; renderTurnClock = function(){}; renderRoom = function(){};
renderHUD = function(){}; logMsg = function(){}; toast = function(){}; seatToast = function(){};
global.__api = {
  NET, CFG, AI_CFG, AI_SRV, BOTUI,
  openSet, cfgRows, botAiRows, botSpdRow, aiConnText, aiCfgAnyOn, applyAiCfg, applyAiTier,
  setAiSeat, testAi, probeAi, probeBusy, saveAi, aiBrainStat, aiBrainOn, aiSeatOn, spdOf,
  draft(){ return SETDRAFT; },        // SETDRAFT 会被整体替换，必须用取值函数而非快照
  clearDraft(){ SETDRAFT = null; },
  refreshSet, sheetOpen,              // v1.3.3：结果回来后的「原地重绘」链路
  sheetKind(){ return SHEET_KIND; },
  openOtherSheet(h){ openSheet(h); },  // 模拟打开「别的」弹窗（规则 / 记录）
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

  console.log('== 4) 选了「不用AI」→ 走本地逻辑，出牌节奏固定「快」（v1.3.2 不再让玩家选速度） ==');
  {
    M.setAiSeat(0, 2);                       // 关掉对家（座位 2）
    ok('AI_CFG.seats[2] = false', M.AI_CFG.seats[2] === false, M.AI_CFG.seats);
    ok('落进引擎读的 CFG.aiSeats[2]', M.CFG.aiSeats[2] === false, M.CFG.aiSeats);
    ok('另外两台不受影响', M.CFG.aiSeats[1] === true && M.CFG.aiSeats[3] === true);
    let h = M.sheet();
    ok('这一台换成「出牌节奏」说明行', h.indexOf('出牌节奏') >= 0 && h.indexOf('出牌快') >= 0);
    ok('面板里已经没有速度开关', h.indexOf('setAiSpd') < 0 && h.indexOf('sgSpdSeat') < 0);
    ok('只有这一台有节奏说明（其余两台仍是 AI 状态）',
      (h.match(/出牌节奏/g) || []).length === 1 && (h.match(/AI 状态/g) || []).length === 2);
    ok('汇总行写明几台走大模型 / 几台走本地', h.indexOf('本机机器人') >= 0 && h.indexOf('2 台走大模型') >= 0 && h.indexOf('1 台走本地逻辑') >= 0);

    ok('引擎按座位取到的节奏恒为「快」', M.spdOf({ isBot: true, idx: 2 }) === 1.8 && M.spdOf({ isBot: true, idx: 1 }) === 1.8);
    ok('全局兜底速度也是「快」', M.CFG.speed === 1.8, M.CFG.speed);
    ok('存档不再保存 spd（只有一个座位开关）', M.saveAi.toString().indexOf('spd') < 0, M.saveAi.toString());

    console.log('   — 三台全关：引擎干脆不注入大脑（零网络开销） —');
    M.setAiSeat(0, 1); M.setAiSeat(0, 3);
    ok('三台都关掉了', M.aiCfgAnyOn() === false, M.CFG.aiSeats);
    ok('aiBrainOn() = false', M.aiBrainOn() === false);
    ok('面板三行都变成节奏说明', (M.sheet().match(/出牌节奏/g) || []).length === 3);
    M.setAiSeat(1, 1); M.setAiSeat(1, 3);        // 复原
    ok('恢复「用AI」后大脑重新注入', M.aiBrainOn() === true && M.aiBrainStat().tier === 'strong', M.aiBrainStat());
  }

  console.log('== 5) 服务端没有大模型：不显示开关，只用本地逻辑（节奏固定快） ==');
  {
    srvOff();
    M.openSet();
    const h = M.sheet();
    ok('说明服务端未配置大模型', h.indexOf('服务端未配置大模型') >= 0);
    ok('不再显示「用AI / 不用AI」（点了也没用）', h.indexOf('>用AI<') < 0 && h.indexOf('>不用AI<') < 0);
    ok('三台都给出节奏说明', (h.match(/出牌节奏/g) || []).length === 3);
    ok('面板里没有速度开关', h.indexOf('setAiSpd') < 0);
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
    ok('草稿里的 spd 仍是 4 元数组、值固定「快」', Array.isArray(M.draft().spd) && M.draft().spd[1] === 1.8, M.draft() && M.draft().spd);
    ok('关掉后那一台的子设置变成节奏说明（不再是速度开关）',
      M.sheet().indexOf('出牌节奏') >= 0 && M.sheet().indexOf('setAiSpd') < 0);
    M.clearDraft();
    M.NET.roomNo = 0; M.NET.isHost = false; M.NET.mySeat = -1; M.NET.players = [];
    M.CFG.aiSeats = [true, true, true, true]; M.CFG.spd = [1.8, 1.8, 1.8, 1.8];
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

  console.log('== 8) 探测加固：卡住也不会永远停在「测试中」（看门狗 + 冷却后自动重测） ==');
  {
    global.location = { protocol: 'http:', hostname: 'game.example.com' };
    srvOn();
    // (a) 请求挂住不返回 → 看门狗到点自动放行，如实说超时，界面不再停在「测试中」
    global.fetch = () => new Promise(() => {});            // 永不 settle
    M.AI_SRV.probe = null; M.AI_SRV.probing = false; M.AI_SRV.probeAt = 0; M.AI_SRV.limited = false;
    M.probeAi(true);
    ok('刚发出去时确实显示「正在实测」', M.probeBusy() === true);
    M.AI_SRV.probeAt = Date.now() - 31000;                  // 模拟已经卡了 31 秒
    ok('看门狗自动放行（不再显示「测试中」）', M.probeBusy() === false);
    ok('并如实记下超时原因', /超时/.test(M.AI_SRV.probeErr), M.AI_SRV.probeErr);
    ok('状态文案不再停在「正在实测调用…」', M.aiConnText().indexOf('正在实测调用') < 0, M.aiConnText());

    // (b) 被服务端 20 秒冷却挡回 → 自己安排一次重测，不指望玩家反复点
    M.AI_SRV.probing = false; M.AI_SRV.probeAt = 0; M.AI_SRV.probe = null; M.AI_SRV.limited = false;
    global.fetch = url => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
      { enabled: true, models: { strong: 'hy3' }, serverTier: 'strong', probe: { ok: false, detail: 'probe 被限流（probe_cd）' } }) });
    M.probeAi(true);
    await new Promise(r => setTimeout(r, 40));
    ok('冷却被如实记下', M.AI_SRV.limited === true);
    ok('并承诺冷却结束后自动重测', M.aiConnText().indexOf('自动重测') >= 0, M.aiConnText());

    // (c) 服务端不可达 / 超时的文案：说清「先走本地逻辑」
    M.AI_SRV.enabled = false; M.AI_SRV.down = true; M.AI_SRV.reason = '响应超时（20 秒）';
    ok('文案说清先走本地逻辑', M.aiConnText().indexOf('响应超时') >= 0 && M.aiConnText().indexOf('本地逻辑') >= 0, M.aiConnText());
    M.AI_SRV.down = false; M.AI_SRV.reason = '';

    // (d) 回到正常态：按钮显示「测试连接」，面板里没有任何「测试中」
    M.AI_SRV.probing = false; M.AI_SRV.probeAt = 0;
    srvOn();
    M.openSet();
    ok('按钮回到「测试连接」', M.sheet().indexOf('测试连接') >= 0 && M.sheet().indexOf('测试中…') < 0);

    // (e) 点「测试连接」时，探测中不会重复发请求
    let n = 0;
    global.fetch = url => { n++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
      { enabled: true, models: { strong: 'hy3' }, serverTier: 'strong', probe: { ok: true, ms: 999 } }) }); };
    M.AI_SRV.probing = false; M.AI_SRV.probeAt = 0; M.AI_SRV.probe = null;
    M.testAi();                                             // 第一下：真发
    M.testAi();                                             // 第二下：还在飞 → 不该重复发
    await new Promise(r => setTimeout(r, 40));
    ok('连点「测试连接」只发一个请求', n === 1, n);
    ok('实测结果拿到毫秒', !!M.AI_SRV.probe && M.AI_SRV.probe.ms === 999 && M.aiConnText().indexOf('999ms') >= 0, M.aiConnText());
    global.location = { protocol: 'file:' };
  }

  console.log('== 9) 【v1.3.3 回归】实测结果回来时，正开着的设置面板要自己重绘 ==');
  {
    // 控制弹窗显隐：真实实现看的是 #mask 上有没有 .hide（不是 #sheet 上的 .on）
    const mask = { hidden: false };
    global.document.getElementById = id => (id === 'mask')
      ? { classList: { contains: c => (c === 'hide' ? mask.hidden : false),
                       add: c => { if (c === 'hide') mask.hidden = true; },
                       remove: c => { if (c === 'hide') mask.hidden = false; } } }
      : { classList: { contains: () => false }, style: {}, appendChild: noop, innerHTML: '' };
    global.location = { protocol: 'http:', hostname: 'game.example.com' };
    srvOn();

    mask.hidden = false;
    M.AI_SRV.probe = null; M.AI_SRV.limited = false;
    M.AI_SRV.lastTryAt = Date.now();        // 别让「打开就补测」干扰这一段
    M.openSet();
    ok('打开的设置面板被标记成「设置」弹窗（SHEET_KIND=set）', M.sheetKind() === 'set', M.sheetKind());
    ok('面板开着时 sheetOpen() 为真', M.sheetOpen() === true);
    ok('此时面板上还看不到毫秒（只有开关）', M.sheet().indexOf('实测调用成功') < 0);

    // 模拟「探测结果刚刚回来」：状态写好 → 走一次刷新链路
    M.AI_SRV.probe = { ok: true, ms: 1688 };
    M.refreshSet();
    ok('面板被原地重绘：毫秒当场出现（不用切开关再看）',
      M.sheet().indexOf('实测调用成功 1688ms') >= 0, M.aiConnText());

    // 面板关着 → 不许重绘、更不许把弹窗自己弹出来
    mask.hidden = true;
    const closed = M.sheet();
    M.refreshSet();
    ok('面板关着时不重绘（也不会自己弹出来）', M.sheet() === closed && M.sheetOpen() === false);

    console.log('   — 别的弹窗开着时，AI 结果不能把它顶成设置面板 —');
    mask.hidden = false;
    M.openOtherSheet('<h2><span>本局记录</span></h2>');
    const rec = M.sheet();
    ok('记录弹窗不是设置面板', M.sheetKind() === '' && rec.indexOf('本局记录') >= 0);
    M.refreshSet();
    ok('记录弹窗没被顶掉', M.sheet() === rec, M.sheet().slice(0, 40));

    console.log('   — 打开设置面板时若还没测过，会自动补测（不用玩家点） —');
    mask.hidden = true;
    let n = 0;
    global.fetch = url => { if (/probe=1/.test(String(url))) n++;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
        { enabled: true, models: { strong: 'hy3' }, serverTier: 'strong', probe: { ok: true, ms: 4321 } }) }); };
    M.AI_SRV.probe = null; M.AI_SRV.probing = false; M.AI_SRV.probeAt = 0;
    M.AI_SRV.lastTryAt = 0; M.AI_SRV.limited = false;
    M.openSet();                                        // 打开面板 → openSet 里会自动补测
    await new Promise(r => setTimeout(r, 40));
    ok('打开设置就自动测了一把', n >= 1, n);
    ok('结果落到 AI_SRV 并出现在文案里', !!M.AI_SRV.probe && M.aiConnText().indexOf('4321ms') >= 0, M.aiConnText());
    const n1 = n;
    M.openSet(); M.openSet();                           // 反复重绘不该反复发请求
    await new Promise(r => setTimeout(r, 40));
    ok('已经有成功结论后不再重复探测', n === n1, [n1, n]);
    global.location = { protocol: 'file:' };
  }

  console.log('== 10) 【v1.3.3】冷却期间服务端直接回上次结论 → 立刻显示毫秒 ==');
  {
    global.location = { protocol: 'http:', hostname: 'game.example.com' };
    srvOn();
    // 服务端在 20 秒冷却里不再回「限流」，而是把上一次的实测结论带回来（cached:true）
    global.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
      { enabled: true, models: { strong: 'hy3' }, serverTier: 'strong',
        probe: { at: Date.now(), ok: true, ms: 1368, detail: '', cached: true, cooldown: true } }) });
    M.AI_SRV.probe = null; M.AI_SRV.probing = false; M.AI_SRV.probeAt = 0;
    M.AI_SRV.limited = false; M.AI_SRV.lastTryAt = 0;
    M.probeAi(true);
    await new Promise(r => setTimeout(r, 40));
    ok('认下这份结论（毫秒当场就有）', !!M.AI_SRV.probe && M.AI_SRV.probe.ok && M.AI_SRV.probe.ms === 1368, M.AI_SRV.probe);
    ok('没有被当成「冷却中」', M.AI_SRV.limited === false);
    ok('文案写着毫秒 + 说明是沿用的结论', M.aiConnText().indexOf('实测调用成功 1368ms') >= 0 && M.aiConnText().indexOf('沿用') >= 0, M.aiConnText());
    ok('不再出现「❌ 实测失败」', M.aiConnText().indexOf('❌') < 0, M.aiConnText());
    global.location = { protocol: 'file:' };
  }

  console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
