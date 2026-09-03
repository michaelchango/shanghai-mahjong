/**
 * 房间回收验证（脚本自起服务端，用超短超时环境变量加速，不依赖外部进程）
 *
 *   场景1  挂着不动的房间：建房后连接不断、也不操作 → 超时后应被回收
 *   场景2  全员离线后的房间：开局 → 断开 → 服务端中止牌局 → 房间号应仍可重进
 *
 * 用法：node tests/m4_recycle.js
 * 退出码 0 = 全部通过
 */
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws'));

const PORT = 8137;                       // 专用测试端口，避开日常调试的 8080
const ROOT = path.join(__dirname, '..');
let ok = true;
const check = (name, cond, extra) => {
  ok = ok && !!cond;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra && !cond ? '  ' + extra : ''));
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 建一条连接，交给 fn 驱动；返回 fn 决定的结果 */
function session(wsUrl, fn){
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const msgs = [];
    const timer = setTimeout(() => { try{ ws.close(); }catch(e){} reject(new Error('会话超时')); }, 20000);
    ws.on('message', raw => { try{ msgs.push(JSON.parse(raw)); }catch(e){} });
    ws.on('error', e => { clearTimeout(timer); reject(e); });
    ws.on('open', () => fn({ ws, msgs,
      done: v => { clearTimeout(timer); resolve(v); },
      fail: e => { clearTimeout(timer); try{ ws.close(); }catch(_){} reject(e); }
    }));
  });
}
const pick = (msgs, ...types) => msgs.find(m => types.includes(m.t));

(async () => {
  const srv = spawn('node', [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      // 空闲回收统一阈值：3 秒无活动就回收（验证方便），扫描 1 秒一次
      SCAN_INTERVAL: '1000', ROOM_IDLE_TIMEOUT: '3000'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let srvOut = '';
  srv.stdout.on('data', d => { srvOut += d.toString(); });
  srv.stderr.on('data', d => { srvOut += d.toString(); });
  await sleep(1500);

  const url = `ws://localhost:${PORT}`;
  try{
    /* ---------- 场景1：挂着不动的房间应被回收 ---------- */
    console.log('== 场景1：挂着不动的房间 ==');
    let roomNo1 = null;
    // 建一个「只挂着、不关连接」的房间：session 内部不 close，靠 finally 收尾
    const holder = new WebSocket(url);
    holder.on('open', () => holder.send(JSON.stringify({ t:'create', name:'挂机者' })));
    holder.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.t === 'roomNo') roomNo1 = m.roomNo;
    });
    await sleep(1200);
    check('建房成功', !!roomNo1, roomNo1);

    // 不操作，等 ROOM_IDLE_TIMEOUT(3s) + SCAN_INTERVAL(1s) + 余量
    await sleep(6000);

    const after = await session(url, ({ ws, msgs, done }) => {
      ws.send(JSON.stringify({ t:'join', name:'路人', roomNo: roomNo1 }));
      const t = setInterval(() => {
        const m = pick(msgs, 'roomNo', 'err');
        if (m){ clearInterval(t); ws.close(); done(m); }
      }, 100);
    });
    check('挂机房间已被回收（房间号失效）',
      after.t === 'err' && /不存在/.test(after.msg || ''), JSON.stringify(after));
    check('服务端记录了回收动作', /回收/.test(srvOut),
      srvOut.split('\n').filter(Boolean).slice(-4).join(' | '));
    try{ holder.close(); }catch(e){}

    /* ---------- 场景2：全员离线后房间号仍可重进 ---------- */
    console.log('== 场景2：全员离线后的房间 ==');
    const roomNo2 = await session(url, ({ ws, msgs, done, fail }) => {
      ws.send(JSON.stringify({ t:'create', name:'独狼' }));
      let started = false;
      const t = setInterval(() => {
        const m = pick(msgs, 'roomNo');
        if (m && !started){
          started = true;
          ws.send(JSON.stringify({ t:'ready' }));
          ws.send(JSON.stringify({ t:'start' }));     // 1 真人 + 3 机器人
          setTimeout(() => { clearInterval(t); ws.close(); done(m.roomNo); }, 1200);
        }
      }, 100);
      setTimeout(() => { clearInterval(t); fail(new Error('没拿到房间号')); }, 8000);
    });
    check('建房并开局成功', !!roomNo2, roomNo2);

    await sleep(2500);   // 等「全员离线 → 1.5s 后自动中止牌局」
    check('全员离线后牌局自动中止', /牌局已结束/.test(srvOut),
      srvOut.split('\n').filter(Boolean).slice(-4).join(' | '));

    const rejoin = await session(url, ({ ws, msgs, done }) => {
      ws.send(JSON.stringify({ t:'join', name:'回来的人', roomNo: roomNo2 }));
      const t = setInterval(() => {
        const m = pick(msgs, 'roomNo', 'err');
        if (m){ clearInterval(t); ws.close(); done(m); }
      }, 100);
    });
    check('中止后房间号仍可重进', rejoin.t === 'roomNo', JSON.stringify(rejoin));
  } catch(e){
    check('测试执行', false, e.message);
  } finally {
    srv.kill('SIGTERM');
  }

  console.log('结果:', ok ? '✅ 全部通过' : '❌ 有失败项');
  process.exit(ok ? 0 : 1);
})();
