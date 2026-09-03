/**
 * 联机协议探针：不用浏览器，直接用 ws 驱动一局，验证端到端
 *   建房 →（1 真人 + 3 机器人）开局 → 自动响应 ask → 结算 → 发「下一局」→ 验证第二局
 *
 * 用法：node proto/tools/netprobe.js [ws地址]  默认 ws://localhost:8080
 * 退出码 0 = 全部通过
 */
const WebSocket = require('/workspace/shanghai-knock-mahjong/server/node_modules/ws');

const URL = process.argv[2] || 'ws://localhost:8080';
const NAME = '探针' + (100 + Math.floor(Math.random() * 900));

let ws = null;
let mySeat = -1, handNo = 0, viewCount = 0, askCount = 0, settleCount = 0;
let logs = [];
const done = new Set();
let result = true;

function send(o){ if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
function log(...a){ const s = a.join(' '); logs.push(s); console.log(s); }
function check(name, cond, extra){
  log((cond ? '  ✅ ' : '  ❌ ') + name + (!cond && extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
  if (!cond) result = false;
}

function onMessage(m){
  if (m.t === 'welcome'){ mySeat = m.seat; log(`入座 seat=${m.seat} host=${m.isHost}`); }
  else if (m.t === 'roomNo'){ log('房间号 ' + m.roomNo); }
  else if (m.t === 'view'){
    viewCount++;
    handNo = m.view.table.handNo;
    if (viewCount === 1) log(`首帧：局=${handNo} 庄=${m.view.table.dealer} 剩余=${m.view.table.wallLeft} 手牌=${m.view.players[mySeat].hand.length}`);
  }
  else if (m.t === 'ask'){
    askCount++;
    const me = null;
    if (m.kind === 'discard'){
      // 从最近一帧投影里取自己的手牌，打第一张
      send({ t:'act', kind:'discard', value: lastHand0 });
    } else if (m.kind === 'knock'){
      send({ t:'act', kind:'knock', value:'pass' });
    } else if (m.kind === 'claim'){
      send({ t:'act', kind:'claim', value:null });
    }
  }
  else if (m.t === 'settle'){
    settleCount++;
    log(`第 ${settleCount} 局结算：${m.rec && m.rec.kind} 分数 ${JSON.stringify(m.rec && m.rec.scores)}`);
    if (settleCount === 1){
      // 关掉弹窗、请求下一局
      setTimeout(() => { log('→ 发送 act next'); send({ t:'act', kind:'next', value:0 }); }, 400);
    }
  }
}
let lastHand0 = null;

const origOnMessage = onMessage;
function handle(raw){
  const m = JSON.parse(raw);
  if (m.t === 'view' && m.view && m.view.players && m.view.players[mySeat]){
    const h = m.view.players[mySeat].hand;
    if (Array.isArray(h) && h.length) lastHand0 = h[h.length - 1];
  }
  origOnMessage(m);
}

ws = new WebSocket(URL);
ws.on('open', () => {
  log('已连接 ' + URL);
  send({ t:'create', name: NAME });
  setTimeout(() => { send({ t:'ready' }); }, 300);
  setTimeout(() => { log('→ 房主开局'); send({ t:'start' }); }, 700);
});
ws.on('message', raw => { try{ handle(raw); }catch(e){ log('消息处理异常', e.message); } });
ws.on('error', e => { log('连接错误', e.message); process.exit(1); });
ws.on('close', () => log('连接关闭'));

const DEADLINE = Date.now() + 150000;
const timer = setInterval(() => {
  if (settleCount >= 2 || Date.now() > DEADLINE){
    clearInterval(timer);
    log('== 断言 ==');
    check('收到首帧投影', viewCount > 0, viewCount);
    check('参与了决策', askCount > 0, askCount);
    check('第一局完成结算', settleCount >= 1, settleCount);
    check('「下一局」开出第二局', handNo === 2, { handNo, settleCount });
    check('第二局完成结算', settleCount >= 2, settleCount);
    try{ ws.close(); }catch(e){}
    log(result ? '\n结果：✅ 通过' : '\n结果：❌ 失败');
    process.exit(result ? 0 : 1);
  }
}, 500);
