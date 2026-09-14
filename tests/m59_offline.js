/* m59：掉线检测与托管集成测试（v1.2.49）
   用 TCP 代理制造「半开连接」（服务端收不到 close），验证：
   1) 心跳探活：DEAD_AFTER 内无任何入站消息 → 服务端判定掉线并断开（走正常 onDisconnect）
   2) 掉线座位被托管：牌局不再卡死，其余三家持续收到询问
   3) 牌局中同名 join：座位失联也允许复座（不再报「牌局进行中」）
   4) 服务端回复 {t:'ping'} → {t:'pong'}
   阈值用环境变量调快：PING_EVERY=300 DEAD_AFTER=1500 STALE_AFTER=1200 PEND_GUARD=2500 */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const PORT = 19066, PROXY = 19067;
const T0 = Date.now();
let pass = 0, fail = 0;
function eq(name, cond){ if (cond){ pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ ' + name); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pair = null;
const proxy = net.createServer(c => {
  const s = net.connect(PORT, '127.0.0.1');
  c.pipe(s); s.pipe(c);
  pair = { c, s };
});

function mk(url, name, pingMs){
  const ws = new WebSocket(url);
  const C = { ws, name, token: null, seat: -1, asks: 0, roomNo: null, pongs: 0, lastErr: null };
  if (pingMs) setInterval(() => { try{ ws.send(JSON.stringify({ t:'ping' })); }catch(e){} }, pingMs);
  ws.on('message', d => {
    let m; try { m = JSON.parse(d); } catch(e){ return; }
    if (m.t === 'welcome'){ C.token = m.token; C.seat = m.seat; }
    if (m.t === 'roomNo') C.roomNo = m.roomNo;
    if (m.t === 'pong') C.pongs++;
    if (m.t === 'ask'){
      C.asks++;
      console.log('    [' + ((Date.now()-T0)/1000).toFixed(1) + 's] ' + name + ' ← ask ' + m.kind);
      let r = null;
      if (m.kind === 'discard') r = { t:'act', kind:'discard', value: 0 };
      else if (m.kind === 'claim') r = { t:'act', kind:'claim', value: null };
      else if (m.kind === 'knock') r = { t:'act', kind:'knock', value: 'pass' };
      else if (m.kind === 'zimo') r = { t:'act', kind:'zimo', value: 'pass' };
      else if (m.kind === 'selfkong') r = { t:'act', kind:'selfkong', value: null };
      if (r){ try{ ws.send(JSON.stringify(r)); }catch(e){} }
    }
    if (m.t === 'err') C.lastErr = m.msg;
  });
  ws.on('error', () => {});
  return C;
}

(async () => {
  const srvLog = [];
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), PING_EVERY: '300', DEAD_AFTER: '1500',
      STALE_AFTER: '1200', PEND_GUARD: '2500'
    })
  });
  srv.stdout.on('data', d => { srvLog.push(d.toString()); process.stdout.write('[srv] ' + d); });
  await sleep(1200);

  await new Promise(r => proxy.listen(PROXY, r));

  const A = mk('ws://127.0.0.1:' + PROXY + '/', '甲', 300);           // 走代理（之后冻结）
  const B = mk('ws://127.0.0.1:' + PORT + '/', '乙', 300);
  const C = mk('ws://127.0.0.1:' + PORT + '/', '丙', 300);
  const D = mk('ws://127.0.0.1:' + PORT + '/', '丁', 300);
  await sleep(500);

  /* 1) 服务端回复探活 */
  A.ws.send(JSON.stringify({ t:'create', name:'甲' }));
  await sleep(1500);
  eq('服务端回复 {t:"ping"} → {t:"pong"}', A.pongs >= 1);
  const roomNo = A.roomNo;
  eq('拿到房间号', !!roomNo);

  for (const [i, P] of [[0, B], [1, C], [2, D]]){
    P.ws.send(JSON.stringify({ t:'join', roomNo, name: ['乙','丙','丁'][i] }));
    await sleep(250);
  }
  await sleep(300);
  for (const P of [B, C, D]) P.ws.send(JSON.stringify({ t:'ready' }));
  await sleep(300);
  A.ws.send(JSON.stringify({ t:'start' }));
  await sleep(6000);
  eq('开局后 A 正常收到询问（≥2 次）', A.asks >= 2);

  /* 2) 冻结 A（半开连接）→ 心跳探活应判定掉线并托管，牌局继续 */
  if (pair){ try{ pair.c.pause(); pair.s.pause(); }catch(e){} }
  const before = B.asks + C.asks + D.asks;
  await sleep(9000);                                             // DEAD_AFTER=1.5s + 托管接管
  const after = B.asks + C.asks + D.asks;
  eq('半开连接被服务端判定掉线（日志含「判定掉线」）', srvLog.join('').includes('判定掉线'));
  eq('掉线座位被托管：9 秒内其余三家持续收到询问（新增 ≥3 次）', after - before >= 3);
  const gapOK = !srvLog.join('').includes('牌局挂起');
  eq('牌局未被回收/中止', gapOK);

  /* 3) 牌局中同名 join：失联座位允许复座 */
  const E = mk('ws://127.0.0.1:' + PORT + '/', 'E(同名甲)');
  await new Promise(r => { E.ws.on('open', r); setTimeout(r, 4000); });
  E.ws.send(JSON.stringify({ t:'join', roomNo, name:'甲' }));
  await sleep(1500);
  console.log('    E open=' + (E.ws.readyState === 1) + ' lastErr=' + E.lastErr);
  eq('同名 join 拿回座位（收到 welcome + seat）', E.token !== null && E.seat === 0);
  eq('同名 join 不再被拒（无「牌局进行中」错误）', E.lastErr === null);

  if (fail) console.log('\n--- 服务端日志 ---\n' + srvLog.join(''));
  console.log('\n结果: %d 通过 / %d 失败', pass, fail);
  srv.kill();
  proxy.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
