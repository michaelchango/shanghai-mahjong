// m64：v1.3.5 大模型「配额」治理（AI_RPM_MAX 主动节流 + 429/EXCEED_* 退避）
//  背景（本测试的全部断言来源）：
//   · CloudBase 网关对模型限 60 请求/分钟，超了返回 429 文案 `model RPM limit 60`；
//     而且这 60 次/分是**与其他应用共享**的 —— 用户实测「刚开服务第 1 次调用就撞 429」。
//   · 原来的 aibrain 把 429 与网络故障一样算作「失败」，连败 3 次开 30 秒熔断；
//     熔断期内 decide() 立刻返回 error:'breaker'，机器人零思考走本地 ——
//     玩家看到的就是「打着打着 AI 掉了、变回快速出牌的机器人」。
//  两条纪律：
//   ① **主动节流**：窗口内超过额度 → 直接本地回退（不发请求、不计失败、不动熔断）。
//   ② **配额不是故障**：429 / EXCEED_* 归为 'quota'，不计入熔断，改短退避（逐次翻倍、上限 30s、成功清零）。
//      真故障（网络/鉴权/解析）仍走 3 连败熔断 —— 否则模型真挂了也会被无限重试。
const cleanEnv = ['CLOUDBASE_ENV', 'TCB_ENV', 'CLOUDBASE_API_KEY', 'CLOUDBASE_ACCESS_KEY',
  'CLOUDBASE_SECRET', 'AI_BASE', 'AI_BASE_REGION', 'AI_PROVIDER', 'AI_MODEL_GROUP', 'AI_AUTH',
  'AI_MODEL_FAST', 'AI_MODEL_STRONG', 'AI_TIMEOUT_MS', 'AI_BOT', 'AI_BOT_TIER', 'AI_RPM_MAX', 'AI_RPM_PAUSE_MS'];
for (const k of cleanEnv) delete process.env[k];

const aibrain0 = require('../proto/server/aibrain');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main(){
  console.log('== 1) 默认值：主动节流 50 次/分（网关硬限 60，留余量） ==');
  ok('默认 rpmMax = 50', aibrain0._env.rpmMax === 50, aibrain0._env.rpmMax);
  ok('窗口 60 秒', aibrain0._env.rpmWin === 60000, aibrain0._env.rpmWin);
  ok('退避基准 5000ms / 上限 30s', aibrain0._env.rpmPauseMs === 5000 && aibrain0._env.rpmPauseMax === 30000,
    [aibrain0._env.rpmPauseMs, aibrain0._env.rpmPauseMax]);
  const s0 = aibrain0.status().rpm;
  ok('status().rpm 暴露水位（含 strikes / pauseLeftMs）',
    s0 && s0.max === 50 && s0.strikes === 0 && s0.pauseLeftMs === 0, s0);

  console.log('== 2) 配额内放行 / 超配额立即回退且不发请求 ==');
  const http = require('http');
  const calls = [];
  let mode = 'ok';
  const stub = http.createServer((req, res) => {
    let buf = '';
    req.on('data', c => buf += c);
    req.on('end', () => {
      calls.push({ url: req.url });
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
      };
      if (mode === 'ok') return send(200, { choices: [{ message: { role: 'assistant', content: '{"discard":"五筒","reason":"留搭子"}' } }] });
      // 真实网关的 429 原文（无 code 字段）
      if (mode === 'rpm429') return send(429, { error: { message: 'The request rate exceeds the current model RPM limit 60. Please reduce the request frequency or contact Tencent Cloud support to request a higher quota.' } });
      if (mode === 'exceed') return send(200, { code: 'EXCEED_REQUEST_LIMIT', message: '请求次数超限' });
      if (mode === 'netdown') return req.socket.destroy();
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));

  // AI_ENV 在模块加载时快照，环境变量必须在 require 之前设好
  process.env.CLOUDBASE_ENV = 'unit-test-env';
  process.env.CLOUDBASE_API_KEY = 'k'.repeat(120);
  process.env.AI_BASE = 'http://127.0.0.1:' + stub.address().port;
  process.env.AI_AUTH = 'bearer';
  process.env.AI_TIMEOUT_MS = '800';
  delete require.cache[require.resolve('../proto/server/aibrain')];
  const ab = require('../proto/server/aibrain');

  const viewOf = i => ({ mode: '敲麻', seat: 0, hand: ['一萬', '二萬', '三萬'], legal: ['一萬'], banned: [], table: [], tag: i });
  const ask = i => ab.decide({ kind: 'discard', tier: 'fast', view: viewOf(i) });
  const reset = (max, win) => { ab._reset(); mode = 'ok'; calls.length = 0; ab._env.rpmMax = max; if (win) ab._env.rpmWin = win; };

  reset(3);
  const r1 = await ask(1), r2 = await ask(2), r3 = await ask(3);
  ok('配额内前 3 次都放行', r1.ok && r2.ok && r3.ok, [r1.ok, r2.ok, r3.ok]);
  ok('确实发出了 3 次请求', calls.length === 3, calls.length);
  const before = ab.status().failStreak;
  const r4 = await ask(4);
  ok('第 4 次被节流（error=throttled）', r4.ok === false && r4.error === 'throttled', r4);
  ok('被节流时**没有**发请求', calls.length === 3, calls.length);
  ok('被节流**不算失败**（failStreak 不涨）', ab.status().failStreak === before, [before, ab.status().failStreak]);
  ok('被节流不会开熔断（仍报 throttled 而非 breaker）', (await ask(5)).error === 'throttled');
  ok('skipped 计数可在 status 看到', ab.status().rpm.skipped === 2, ab.status().rpm);
  ok('status().rpm.used 反映窗口占用', ab.status().rpm.used === 3, ab.status().rpm);

  console.log('== 3) 滑动窗口：额度按时间释放，配额一松自动用回来 ==');
  reset(3, 400);
  await ask(1); await ask(2); await ask(3);
  ok('窗口占满', (await ask(4)).error === 'throttled');
  await sleep(500);
  ok('窗口滑走后恢复放行', (await ask(9)).ok === true, ab.status().rpm);

  console.log('== 4) 命中缓存优先于节流（缓存不花钱，不该被配额挡） ==');
  reset(1, 60000);
  ok('第 1 次走真实调用', (await ask(1)).ok === true);
  ok('第 2 次同局面被节流…', (await ask(2)).error === 'throttled');
  const c3 = await ask(1);
  ok('…但同局面命中缓存仍可返回', c3.ok === true && c3.cached === true, c3);

  console.log('== 5) AI_RPM_MAX=0 → 关掉节流（自托管/单测用） ==');
  reset(0);
  let allOk = true;
  for (let i = 0; i < 8; i++){ const r = await ask(100 + i); if (!r.ok) allOk = false; }
  ok('不限速时连续 8 次全部放行', allOk);
  ok('status().rpm.max = 0', ab.status().rpm.max === 0, ab.status().rpm);

  console.log('== 6) _reset() 清空配额窗口 ==');
  reset(2);
  await ask(1); await ask(2);
  ok('窗口已占满', (await ask(3)).error === 'throttled');
  ab._reset();
  ok('reset 后窗口清空、可继续调用', (await ask(3)).ok === true);
  ok('reset 也清掉 skip 计数', ab.status().rpm.skipped === 0, ab.status().rpm);

  /* ======================================================================
     7) 核心：429 / EXCEED_* 是「配额被占」不是「模型故障」
        —— 不计熔断，改短退避；否则「偶尔让位一手」会被放大成「AI 整个掉线」
     ====================================================================== */
  console.log('== 7) 429 → 归类 quota、不计熔断、短退避后自动恢复 ==');
  ab._reset(); ab._env.rpmMax = 0; ab._env.rpmPauseMs = 40; calls.length = 0;
  mode = 'rpm429';
  const q1 = await ask(1);
  ok('429 → error = quota（不是 http / breaker）', q1.ok === false && q1.error === 'quota', q1);
  ok('429 **不计入** failStreak（这是关键：熔断不被配额触发）', ab.status().failStreak === 0, ab.status().failStreak);
  ok('429 的原文透传出来（便于线上排查）', /RPM limit 60/.test(String(q1.detail || '')), String(q1.detail).slice(0, 60));
  ok('记一次 strikes 并给出退避时长', ab.status().rpm.strikes === 1 && ab.status().rpm.pauseLeftMs > 0, ab.status().rpm);

  const nBefore = calls.length;
  const q2 = await ask(2);
  ok('退避期内直接回退（throttled），不再打网关', q2.error === 'throttled' && calls.length === nBefore, [q2.error, calls.length, nBefore]);

  // 连续撞多次 429：每一次都不该让 failStreak 上涨，更不该出现 breaker。
  // 注意退避是**逐次翻倍**的，所以这几次里可能夹着「还在退避中」的 throttled —— 那也正常，
  // 这里断言的是「绝不出现 breaker」，而不是「每一次都是 quota」。
  let sawBreaker = false, quotaSeen = 0;
  for (let i = 0; i < 5; i++){
    await sleep(1200);                      // 等退避窗口过去，让它真的再打一次网关
    const r = await ask(10 + i);
    if (r.error === 'breaker') sawBreaker = true;
    if (r.error === 'quota') quotaSeen++;
  }
  ok('连续多次 429 至少 3 次真的又打到了网关并仍归为 quota', quotaSeen >= 3, quotaSeen);
  ok('连续多次 429 也没有触发熔断', sawBreaker === false && ab.status().failStreak === 0,
    [sawBreaker, ab.status().failStreak]);
  ok('退避逐次翻倍（strikes 累加）', ab.status().rpm.strikes >= 5, ab.status().rpm.strikes);

  mode = 'ok';
  await sleep(2200);                        // 退避已翻倍到 1280ms，等它过去
  const rec = await ask(99);
  ok('配额恢复后自动用回来', rec.ok === true, rec);
  ok('成功后清掉退避状态', ab.status().rpm.strikes === 0 && ab.status().rpm.pauseLeftMs === 0, ab.status().rpm);

  console.log('== 8) 额度类 api 错误（EXCEED_*）同样按配额处理 ==');
  ab._reset(); ab._env.rpmMax = 0; ab._env.rpmPauseMs = 40;
  mode = 'exceed';
  const e1 = await ask(1);
  ok('EXCEED_REQUEST_LIMIT → quota', e1.ok === false && e1.error === 'quota', e1);
  ok('EXCEED_* 也不计入熔断', ab.status().failStreak === 0, ab.status().failStreak);

  console.log('== 9) 真故障仍走老规矩：网络错 → 3 连败开熔断 ==');
  ab._reset(); ab._env.rpmMax = 0; ab._env.rpmPauseMs = 40;
  mode = 'netdown';
  const f1 = await ask(1), f2 = await ask(2), f3 = await ask(3);
  ok('网络错归类不是 quota', f1.error !== 'quota' && f2.error !== 'quota' && f3.error !== 'quota', [f1.error, f2.error, f3.error]);
  ok('3 连败 → 开熔断', (await ask(4)).error === 'breaker', ab.status().failStreak);
  ok('熔断与配额退避互不干扰（strikes 仍为 0）', ab.status().rpm.strikes === 0, ab.status().rpm);

  await new Promise(r => stub.close(r));
  for (const k of cleanEnv) delete process.env[k];
  delete require.cache[require.resolve('../proto/server/aibrain')];

  console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('测试异常：', e && e.stack || e); process.exit(1); });
