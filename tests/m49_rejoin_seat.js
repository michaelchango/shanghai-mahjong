// m49：v1.2.40 重进房间复用原座位（掉线后重新进入不再出现「两个我」）
// 真起服务端 + 真 WebSocket：建房 → 掉线 → 同名重进 → 断言房间里只有 1 个人、且在线
const { spawn } = require('child_process');
const path = require('path');

const PORT = Number(process.env.M49_PORT || 8123);
const SRV = path.join(__dirname, '..', 'server', 'server.js');
// ws 可能在根 node_modules（根 package.json 有依赖），也可能只在 server/ 下
let WS;
try{ WS = require('ws'); }
catch(e){ WS = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws')); }

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };

const srv = spawn(process.execPath, [SRV], {
  env: Object.assign({}, process.env, { PORT: String(PORT) }),
  stdio: ['ignore', 'pipe', 'pipe']
});
let srvLog = '';
srv.stdout.on('data', d => { srvLog += d.toString(); });
srv.stderr.on('data', d => { srvLog += d.toString(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = 'ws://127.0.0.1:' + PORT;


function conn(name){
  return new Promise((resolve, reject) => {
    const ws = new WS(URL);
    const c = { ws, msgs: [] };
    ws.on('open', () => resolve(c));
    ws.on('message', raw => { try{ c.msgs.push(JSON.parse(raw.toString())); }catch(e){} });
    ws.on('error', e => reject(e));
  });
}
function send(c, o){ c.ws.send(JSON.stringify(o)); }
function last(c, t){ for (let i = c.msgs.length - 1; i >= 0; i--) if (c.msgs[i].t === t) return c.msgs[i]; return null; }
async function waitMsg(c, t, ms = 3000){
  const end = Date.now() + ms;
  while (Date.now() < end){
    const m = last(c, t);
    if (m) return m;
    await sleep(50);
  }
  return null;
}

(async () => {
  await sleep(1200);   // 等服务端起来

  console.log('== 1) 等待室：掉线后同名重进，应复用原座位 ==');
  const a = await conn('A');
  send(a, { t:'create', name:'小明' });
  const w1 = await waitMsg(a, 'welcome');
  ok('建房成功', !!w1, w1);
  const roomNo = (last(a, 'roomNo') || {}).roomNo;
  ok('拿到房间号', !!roomNo, roomNo);
  const seat1 = w1.seat;

  // B 进房，方便验证名单
  const b = await conn('B');
  send(b, { t:'join', roomNo, name:'小红' });
  await waitMsg(b, 'welcome');
  await sleep(200);
  let room = last(a, 'room');
  ok('房间里有 2 人', room && room.players.filter(p => p).length === 2,
     room && room.players.map(p => p && p.name));

  // 小明掉线（直接关 socket，模拟断网）
  a.ws.close();
  await sleep(600);
  room = last(b, 'room');
  const ming = room.players.find(p => p && p.name === '小明');
  ok('小明掉线：仍占位且 online=false', ming && ming.online === false, ming);

  // 同名重新进入
  const a2 = await conn('A2');
  send(a2, { t:'join', roomNo, name:'小明' });
  const w2 = await waitMsg(a2, 'welcome');
  ok('同名重进拿到 welcome', !!w2, w2);
  await sleep(400);

  room = last(b, 'room');
  const names = room.players.filter(p => p).map(p => p.name);
  ok('房间里仍是 2 人（不是 3 人）', room.players.filter(p => p).length === 2, names);
  ok('没有出现两个「小明」', names.filter(n => n === '小明').length === 1, names);
  const ming2 = room.players.find(p => p && p.name === '小明');
  ok('小明恢复为 online=true', ming2 && ming2.online === true, ming2);
  ok('小明座位号不变（复用原座位）', ming2 && ming2.seat === seat1, { old: seat1, now: ming2 && ming2.seat });
  // 旧页面应收到 kicked（本次是掉线场景，旧连接已关，故不强制断言）

  console.log('== 2) 等待室：掉线者限定时间内重进，座位不会被保留定时器释放 ==');
  // （graceTimer 会在重进时被清除；此处只验证人数与在线状态已正确）
  ok('重进后人数仍为 2', room.players.filter(p => p).length === 2, room.players.length);

  console.log('== 3) 同名「在线」重进：旧页面应被踢，仍只有一个人 ==');
  const a3 = await conn('A3');
  send(a3, { t:'join', roomNo, name:'小明' });
  const w3 = await waitMsg(a3, 'welcome');
  ok('在线同名重进也复用座位', w3 && w3.seat === seat1, { want: seat1, got: w3 && w3.seat });
  await sleep(500);
  room = last(b, 'room');
  const names3 = room.players.filter(p => p).map(p => p.name);
  ok('仍只有 2 人', names3.length === 2, names3);
  ok('仍只有一个「小明」', names3.filter(n => n === '小明').length === 1, names3);
  const kicked = await waitMsg(a2, 'kicked', 1500);
  ok('旧页面收到 kicked', !!kicked, kicked);

  console.log('== 4) 不同昵称正常加人（不被误合并） ==');
  const c = await conn('C');
  send(c, { t:'join', roomNo, name:'小刚' });
  const w4 = await waitMsg(c, 'welcome');
  await sleep(300);
  room = last(b, 'room');
  const names4 = room.players.filter(p => p).map(p => p.name);
  ok('小刚成功加入，房间 3 人', !!w4 && names4.length === 3, names4);
  ok('小刚座位与小明不同', w4 && w4.seat !== seat1, { 小刚: w4 && w4.seat, 小明: seat1 });

  for (const c2 of [a2, a3, b, c]){ try{ c2.ws.close(); }catch(e){} }
  await sleep(300);
  srv.kill();
  console.log('\n结果: ' + (fail ? '❌ ' : '✅ ') + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(async e => {
  console.log('ERROR:', e && e.message);
  console.log('--- server log ---\n' + srvLog.slice(-1500));
  try{ srv.kill(); }catch(_){}
  process.exit(1);
});
