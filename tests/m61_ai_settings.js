// m61：v1.3.0 设置面板重排（AI 开关 + 条件显示的「机器人速度」+ 分区顺序）
//
//  用户要的三件事，逐条锁死，防止以后再被改回去：
//   1) 规则区（玩法部分）在最前，且**不再**包含「机器人速度」；
//   2) 紧跟一行「机器人是否启用AI」：只有一个开关（启用 / 不启用，默认启用），
//      说明精简成一句话，不再解释「快 / 强」两档；AI 状态行保留；
//   3) 机器人**真的**没用大模型时才显示「机器人速度」；
//      再往后是语音设置，最后才是样式（台面 / 印花）。
//  顺序用「整段面板 HTML 里各分区首次出现的位置」来断言 —— 这正是玩家看到的上到下顺序。
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

/* 桩：让 index.html 的引擎段在 node 下能整段 eval。
   location.protocol = 'file:' → probeAi 走「本地文件打开」分支，不联网、不依赖服务端。 */
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
  NET, CFG, AI_CFG, AI_SRV, SETDRAFT,
  openSet, cfgRows, speedRows, aiRows, aiStatusText, aiActive, applyAiTier, setAiTier,
  aiBrainStat, aiBrainOn,
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
    ai: s.indexOf('机器人是否启用AI'),      // AI 开关
    speed: s.indexOf('机器人速度'),         // 机器人速度（条件显示）
    voice: s.indexOf('语音播报') >= 0 ? s.indexOf('语音播报') : s.indexOf('我的音色'),
    felt: s.indexOf('台面颜色')             // 样式：台面
  };
}

(async () => {
  console.log('== 1) 规则区不再包含「机器人速度」 ==');
  {
    const c = M.cfgRows(false), cRoom = M.cfgRows(true, true);
    ok('单机 cfgRows 不含「机器人速度」', c.indexOf('机器人速度') < 0);
    ok('单机 cfgRows 不含 sgSpeed', c.indexOf('sgSpeed') < 0);
    ok('联机 cfgRows 也不含「机器人速度」', cRoom.indexOf('机器人速度') < 0);
    ok('规则区仍有「玩法」行', c.indexOf('玩法') >= 0);
    const sp = M.speedRows(false);
    ok('speedRows 独立成行且可改', sp.indexOf('机器人速度') >= 0 && sp.indexOf('setCfg6') >= 0);
  }

  console.log('== 2) AI 行：名称 / 一句话说明 / 单开关 ==');
  {
    const r = M.aiRows(false);
    ok('名称就是「机器人是否启用AI」', r.indexOf('机器人是否启用AI') >= 0);
    ok('不再出现旧名「机器人 AI」', r.indexOf('机器人 AI') < 0);
    ok('不再解释「大模型·快 / 大模型·强」两档', r.indexOf('大模型·快') < 0 && r.indexOf('大模型·强') < 0);
    ok('不再出现「本地」档字样', r.indexOf('>本地<') < 0);
    ok('开关就是 启用 / 不启用', r.indexOf('>启用<') >= 0 && r.indexOf('>不启用<') >= 0);
    ok('保留「AI 状态」行', r.indexOf('AI 状态') >= 0);
    const desc = (r.match(/机器人是否启用AI<small>([\s\S]*?)<\/small>/) || [])[1] || '';
    ok('说明精简成一句话（无第二句、≤ 40 字）',
      desc.length > 0 && desc.length <= 40 && desc.indexOf('；') < 0, desc);
  }

  console.log('== 3) 默认启用 ==');
  ok('AI_CFG.on 默认 true', M.AI_CFG.on === true, M.AI_CFG);

  console.log('== 4) 单机顺序：玩法 → AI →(速度)→ 语音 → 样式 ==');
  {
    // 场景 A：服务端不可用（本地逻辑）→ 机器人速度应当出现
    M.AI_SRV.checked = true; M.AI_SRV.enabled = false; M.AI_SRV.reason = '测试';
    M.applyAiTier();
    M.openSet();
    let m = marks();
    ok('顺序：玩法 < AI', m.cfg >= 0 && m.ai > m.cfg, [m.cfg, m.ai]);
    ok('顺序：AI < 速度', m.speed > m.ai, [m.ai, m.speed]);
    ok('顺序：速度 < 语音', m.voice > m.speed, [m.speed, m.voice]);
    ok('顺序：语音 < 样式', m.felt > m.voice, [m.voice, m.felt]);
    ok('机器人没走大模型 → 显示「机器人速度」', m.speed >= 0);
    ok('开关仍是「启用」（用户没关，只是服务端不可用）',
      /<button class="on" onclick="setAiTier\(1\)">启用<\/button>/.test(m.html), null);
    ok('状态行如实说明已回退本地', m.html.indexOf('已回退本地逻辑') >= 0);

    // 场景 B：服务端可用（机器人真的走大模型）→ 速度必须消失
    M.AI_SRV.enabled = true; M.AI_SRV.models = { strong: 'hy3' };
    M.applyAiTier();
    M.openSet();
    m = marks();
    ok('机器人真的走大模型 → 隐藏「机器人速度」', m.speed < 0, m.speed);
    ok('顺序：AI < 语音（速度让位后无缝衔接）', m.voice > m.ai, [m.ai, m.voice]);
    ok('顺序：语音 < 样式', m.felt > m.voice, [m.voice, m.felt]);
    ok('状态行显示已连接的模型', m.html.indexOf('已连接大模型 hy3') >= 0);
    ok('引擎真的注入了大脑，且档位是 strong',
      M.aiBrainOn() === true && M.aiBrainStat().tier === 'strong', M.aiBrainStat());
  }

  console.log('== 5) 关掉 AI：速度回来，顺序不乱 ==');
  {
    M.setAiTier(0);
    ok('开关落到「不启用」', M.AI_CFG.on === false);
    ok('引擎不再注入大脑（零网络开销）', M.aiBrainOn() === false);
    ok('状态行改为本地逻辑', M.aiStatusText().indexOf('本地逻辑') >= 0, M.aiStatusText());
    const m = marks();
    ok('关闭后「机器人速度」回来了', m.speed > 0);
    ok('速度仍在 AI 之后、语音之前', m.speed > m.ai && m.speed < m.voice, [m.ai, m.speed, m.voice]);
    ok('关闭后顺序仍是：玩法 < AI < 速度 < 语音 < 样式',
      m.cfg >= 0 && m.ai > m.cfg && m.speed > m.ai && m.voice > m.speed && m.felt > m.voice, m);
    // 复原，免得影响后面的用例
    M.setAiTier(1);
    ok('开关回到「启用」', M.AI_CFG.on === true);
    // 本测试跑在 file:// 桩环境下：probeAi 会如实判定「没有服务端」，
    // 于是即使开关是「启用」也不注入大脑 —— 正是我们要的降级行为（不报错、不卡牌）。
    ok('file:// 打开时如实降级（没有服务端就不注入大脑）', M.aiBrainOn() === false);
    ok('降级原因写在状态行里', M.aiStatusText().indexOf('本地文件打开') >= 0, M.aiStatusText());
    M.AI_SRV.checked = true; M.AI_SRV.enabled = true; M.applyAiTier();
    ok('服务端一可用就注入大脑（strong 档）',
      M.aiBrainOn() === true && M.aiBrainStat().tier === 'strong', M.aiBrainStat());
  }

  console.log('== 6) 联机：档位只读、跟随服务端，顺序与单机一致 ==');
  {
    M.AI_SRV.serverTier = 'off';
    let r = M.aiRows(true);
    ok('联机行名称一致', r.indexOf('机器人是否启用AI') >= 0);
    ok('联机只读（span 而非 button）', r.indexOf('<span') >= 0 && r.indexOf('<button') < 0);
    ok('服务端 off → 显示「不启用」', /<span class="on">不启用<\/span>/.test(r), r);
    ok('服务端 off → 提示走本地逻辑', r.indexOf('走本地逻辑') >= 0);
    M.AI_SRV.serverTier = 'strong';
    r = M.aiRows(true);
    ok('服务端 strong → 显示「启用」', /<span class="on">启用<\/span>/.test(r), r);
    ok('服务端 strong → 提示由服务端出牌', r.indexOf('服务端已启用大模型') >= 0);

    // 等待页（非房主）：完整面板顺序
    M.NET.roomNo = '8888'; M.NET.isHost = false; M.NET.tableOn = false;
    M.AI_SRV.serverTier = 'off'; M.openSet();
    const m = marks();
    ok('联机顺序：玩法 < AI < 速度 < 语音 < 样式',
      m.cfg >= 0 && m.ai > m.cfg && m.speed > m.ai && m.voice > m.speed && m.felt > m.voice, m);
    ok('联机非房主：规则区只读', m.html.indexOf('class="seg ro"') >= 0);
    // 服务端启用 AI 时，联机也不该再显示「机器人速度」
    M.AI_SRV.serverTier = 'strong'; M.openSet();
    const m2 = marks();
    ok('联机且服务端启用 AI → 隐藏「机器人速度」', m2.speed < 0, m2.speed);
    ok('联机且服务端启用 AI → 顺序仍正确', m2.ai > m2.cfg && m2.voice > m2.ai && m2.felt > m2.voice);
    M.NET.roomNo = 0; M.NET.isHost = false;
    M.AI_SRV.serverTier = 'off';
  }

  console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
