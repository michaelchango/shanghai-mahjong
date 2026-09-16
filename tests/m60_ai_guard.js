/**
 * m60 — /api/ai/* 防滥用闸门（同源校验 / 单 IP 限流 / 全局限流 / probe 冷却）
 *
 * 为什么值得单测：这两个接口是公开的，而每次调用都花真实的模型额度。
 * 闸门坏掉不会有任何功能报错 —— 只会安静地把钱烧掉。所以必须有回归保护。
 *
 * 做法：把 server.js 里的闸门函数原样抠出来（不启服务、不连网、不花钱），
 * 用假 req 对象直接验证判定结果。若 server.js 结构大改导致抠不出来，本测试会失败 —— 这是故意的。
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const i = src.indexOf('const AI_RATE =');
const j = src.indexOf('const server = http.createServer');
if (i < 0 || j < 0 || j <= i){
  console.log('✗ 无法从 server.js 抽出闸门代码段（结构变了？请同步更新本测试）');
  process.exit(1);
}
const make = new Function('URL', src.slice(i, j) + '; return { aiAllowed: aiAllowed, AI_RATE: AI_RATE, clientIp: clientIp, sameOrigin: sameOrigin };');
const G = make(URL);

/* 假 req：headers + socket.remoteAddress */
const req = o => ({ headers: (o && o.headers) || {}, socket: { remoteAddress: (o && o.ip) || '10.0.0.1' } });
function reset(){
  G.AI_RATE.gt0 = 0; G.AI_RATE.gn = 0; G.AI_RATE.hits.clear();
}

console.log('== 1) 同源校验：挡掉「拿别人网页当代理刷额度」 ==');
{
  reset();
  ok('无 Origin（curl / 老客户端）放行', G.aiAllowed(req({}), false) === '');
  ok('Origin=null 放行（沙箱 iframe / file://）', G.aiAllowed(req({ headers: { origin: 'null' } }), false) === '');
  ok('Origin 与 Host 一致 → 放行',
    G.aiAllowed(req({ headers: { origin: 'https://game.example.com', host: 'game.example.com' } }), false) === '');
  ok('端口不同也算不同源 → 挡',
    G.aiAllowed(req({ headers: { origin: 'https://game.example.com:8443', host: 'game.example.com' } }), false) === 'origin');
  ok('跨站 Origin → 挡',
    G.aiAllowed(req({ headers: { origin: 'https://evil.example.com', host: 'game.example.com' } }), false) === 'origin');
  ok('畸形 Origin → 挡（不抛异常）',
    G.aiAllowed(req({ headers: { origin: 'not a url', host: 'game.example.com' } }), false) === 'origin');
  ok('有 Origin 但没 Host → 挡',
    G.aiAllowed(req({ headers: { origin: 'https://game.example.com' } }), false) === 'origin');
}

console.log('== 2) 单 IP 限流：正常牌局远够用，刷子会被挡 ==');
{
  reset();
  let allowed = 0, blocked = 0, firstWhy = '';
  // 300 次以内：单 IP 闸（240）先于总闸（300）触发，所以第一次被挡的原因应是 rate
  for (let k = 0; k < 300; k++){
    const r = G.aiAllowed(req({ ip: '1.1.1.1' }), false);
    if (r === '') allowed++; else { blocked++; if (!firstWhy) firstWhy = r; }
  }
  ok('单 IP 放行数 = max(240)', allowed === 240, allowed);
  ok('超出部分被挡住', blocked === 60, blocked);
  ok('第一次被挡的原因是 rate（单 IP 闸先触发）', firstWhy === 'rate', firstWhy);

  // 另一 IP 应当有独立配额（但会被全局闸约束，见下一节）
  reset();
  let a2 = 0;
  for (let k = 0; k < 10; k++) if (G.aiAllowed(req({ ip: '2.2.2.2' }), false) === '') a2++;
  ok('换一个 IP 重新计算配额', a2 === 10, a2);
}

console.log('== 3) 全局限流：XFF 可伪造，所以必须有进程级总闸 ==');
{
  reset();
  let allowed = 0, blocked = 0, why = '';
  // 每次换一个伪造 IP —— 单 IP 闸形同虚设，只有总闸能兜住
  for (let k = 0; k < 360; k++){
    const r = G.aiAllowed(req({ headers: { 'x-forwarded-for': '9.9.9.' + (k % 250) } }), false);
    if (r === '') allowed++; else { blocked++; why = why || r; }
  }
  ok('伪造 250 个 IP 连打 360 次，放行数收敛到 globalMax(300)', allowed === 300, allowed);
  ok('超出部分被总闸挡住', blocked === 60, blocked);
  ok('挡下的原因是 global（而不是 rate）', why === 'global', why);
}

console.log('== 4) probe 冷却：?probe=1 会真打一次模型，不能被刷 ==');
{
  reset();
  ok('第一次 probe 放行', G.aiAllowed(req({ ip: '3.3.3.3' }), true) === '');
  ok('20 秒内再 probe → 挡', G.aiAllowed(req({ ip: '3.3.3.3' }), true) === 'probe_cd');
  ok('普通决策不受 probe 冷却影响', G.aiAllowed(req({ ip: '3.3.3.3' }), false) === '');
  ok('probe 冷却期间不计入限流次数（不会白占额度）', G.AI_RATE.hits.get('3.3.3.3').n === 2, G.AI_RATE.hits.get('3.3.3.3').n);

  // 冷却窗口过去后应恢复
  G.AI_RATE.hits.get('3.3.3.3').probe = Date.now() - G.AI_RATE.probeCd - 1;
  ok('冷却窗口过后恢复', G.aiAllowed(req({ ip: '3.3.3.3' }), true) === '');
}

console.log('== 5) 固定窗口会重置（不是永久封禁）==');
{
  reset();
  for (let k = 0; k < 250; k++) G.aiAllowed(req({ ip: '4.4.4.4' }), false);
  ok('本窗口内已打满', G.aiAllowed(req({ ip: '4.4.4.4' }), false) === 'rate');
  G.AI_RATE.gt0 = Date.now() - G.AI_RATE.win - 1;                 // 假装过了一个窗口
  G.AI_RATE.hits.get('4.4.4.4').t0 = Date.now() - G.AI_RATE.win - 1;
  ok('窗口滚动后恢复放行', G.aiAllowed(req({ ip: '4.4.4.4' }), false) === '');
}

console.log('== 6) clientIp：优先取 XFF 第一段（Render 等反代后的真实客户端） ==');
{
  ok('取 XFF 首段', G.clientIp(req({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })) === '1.2.3.4');
  ok('无 XFF 时回落 socket 地址', G.clientIp(req({ ip: '7.7.7.7' })) === '7.7.7.7');
  ok('都没有时不崩（返回 -）', G.clientIp({ headers: {}, socket: {} }) === '-');
}

console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
