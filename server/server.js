#!/usr/bin/env node
/**
 * 上海敲麻 v1.1 服务端 —— 服务器权威架构
 *
 * 职责：
 *   1. 静态托管 index.html（手机浏览器直接访问 http://<ip>:<port> 即可玩）
 *   2. 房间管理：建房 / 加入 / 座位 / 准备 / 开始 / 掉线重连
 *   3. 游戏宿主 GameHost：无头跑规则引擎（与单机同一份代码），每步向各家
 *      下发「座位专属投影」，等待真人回包；空位与掉线者由 AI 托管
 *
 * 安全边界：
 *   - 永不下发牌墙内容与他人手牌（投影裁剪，见 proto/server/view.js）
 *   - 客户端动作只作参考，服务端逐条校验后才驱动引擎
 *
 * 用法：node server/server.js   （或 PORT=8080 node server/server.js）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const { boot } = require('../proto/server/headless');
const { projectFor } = require('../proto/server/view');
const { handSeed } = require('../proto/server/rng');

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.resolve(__dirname, '..');

const ASK_TIMEOUT = 15000;        // 出牌 / 吃碰杠 / 敲 的思考超时（毫秒）
const BOT_NAMES = ['阿强', '阿明', '阿芳', '阿珍'];

// 房间保留与回收
//   · 掉线 ≠ 退出：等待中掉线保留座位 OFFLINE_GRACE，期间重连自动复座
//   · 主动退出（点「离开房间 / 回到首页」）立即释放座位；房间没人了当场销毁
//   · 空闲回收：等待中无活动 / 牌局挂起 / 无人留守 三种情形统一用 ROOM_IDLE_TIMEOUT
// 各阈值可用环境变量覆盖，便于快速验证（例：SCAN_INTERVAL=2000 ROOM_IDLE_TIMEOUT=3000）
const ms = (v, d) => Number(process.env[v] || 0) || d;
const SCAN_INTERVAL      = ms('SCAN_INTERVAL',      60 * 60 * 1000);  // 扫描间隔：1 小时
const OFFLINE_GRACE      = ms('OFFLINE_GRACE',      5 * 60 * 1000);   // 等待中掉线：座位保留 5 分钟
const ROOM_IDLE_TIMEOUT  = ms('ROOM_IDLE_TIMEOUT',  2 * 60 * 60 * 1000); // 空闲超时：2 小时（三种情形统一）
const STATS_INTERVAL     = ms('STATS_INTERVAL',     30 * 60 * 1000);  // 房间数日志间隔

/* ========================================================================
   工具
   ======================================================================== */
const log = (...a) => console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }), ...a);
const token = () => crypto.randomBytes(12).toString('hex');

// 单个房间的意外错误不应带崩整个服务进程：记录后继续服务其他房间
process.on('uncaughtException', e => log('⚠ 未捕获异常（服务继续）:', e.stack || e.message));

/* ========================================================================
   房间
   ======================================================================== */
const rooms = new Map();

function newRoomNo(){
  let no;
  do { no = String(100000 + Math.floor(Math.random() * 900000)); } while (rooms.has(no));
  return no;
}

/* 可改的规则项白名单 + 取值校验（客户端传什么都先过一遍，不合法就忽略） */
const CFG_ALLOW = {
  base:       v => [1, 2, 3].includes(Number(v)) ? Number(v) : null,
  unit:       v => [1, 2, 5].includes(Number(v)) ? Number(v) : null,
  lezi:       v => [3, 5, 8, 99].includes(Number(v)) ? Number(v) : null,
  speed:      v => [0.6, 1, 1.8].includes(Number(v)) ? Number(v) : null,
  allowChow:  v => (v === true || v === false || v === 1 || v === 0) ? !!v : null,
  sevenPairs: v => (v === true || v === false || v === 1 || v === 0) ? !!v : null,
  lajiHu:     v => (v === true || v === false || v === 1 || v === 0) ? !!v : null,
  autoKnock:  v => (v === true || v === false || v === 1 || v === 0) ? !!v : null,
  autoHu:     v => (v === true || v === false || v === 1 || v === 0) ? !!v : null
};

/* 房间默认规则（与 index.html 的 CFG 默认值一致）；房主可在等待页改，开局后锁定 */
function defaultCfg(){
  return {
    base: 2, unit: 1, lezi: 8,
    allowChow: true, sevenPairs: false, lajiHu: true,
    autoKnock: false, autoHu: false, speed: 1
  };
}

class Room {
  constructor(){
    this.no = newRoomNo();
    this.seats = [null, null, null, null];   // Conn | null
    this.ready = [false, false, false, false];
    this.state = 'wait';                      // wait | playing
    this.host = null;                         // GameHost
    this.hostSeatNo = -1;                     // v1.2.4：房主固定到人（换座不转移）
    this.cfg = defaultCfg();                  // 本桌规则：房主设定，开局后锁定
    this.gameSeq = 0;                         // v1.2.11：第几次开局（混入牌种，保证「结束本局」重开是新牌）
    this.lastActive = Date.now();             // 最后一次有人操作（回收判定用）
    this.emptyTimer = null;
    rooms.set(this.no, this);
    log(`房 ${this.no} 创建`);
  }
  touch(){ this.lastActive = Date.now(); }
  emptySeat(){
    for (let i = 0; i < 4; i++) if (!this.seats[i]) return i;
    return -1;
  }
  addPlayer(ws, name){
    const seat = this.emptySeat();
    if (seat < 0) return null;
    if (this.emptyTimer){ clearTimeout(this.emptyTimer); this.emptyTimer = null; }
    const conn = new Conn(ws, this, seat, name);
    this.seats[seat] = conn;
    this.ready[seat] = false;
    this.touch();
    return conn;
  }
  /* v1.2.4：房主身份跟着「人」走，不跟着座位号走
     - 建/进房时首个入座者为房主
     - 房主换座：仍是房主（不会因为座位号变大就被别人顶替）
     - 房主退出/被移出/掉线超时离开：顺延给当前首个在座者 */
  hostSeat(){
    if (this.hostSeatNo >= 0 && this.seats[this.hostSeatNo]) return this.hostSeatNo;
    for (let i = 0; i < 4; i++) if (this.seats[i]){
      this.hostSeatNo = i;                    // 首个入座者为房主
      return i;
    }
    this.hostSeatNo = -1;
    return -1;
  }
  broadcastRoom(){
    // 空座位直接发 null，客户端按「空位」渲染（不要出现 name:null / 掉线）
    const players = this.seats.map((c, i) => c ? {
      seat: i,
      name: c.name,
      ready: !!this.ready[i],
      online: !!c.online,
      host: this.hostSeat() === i
    } : null);
    for (const c of this.seats) if (c && c.online){
      c.send({ t:'room', players, cfg: this.cfg });
    }
  }
  scheduleEmptyClose(){
    if (this.emptyTimer) return;
    this.emptyTimer = setTimeout(() => {
      if (!this.seats.some(c => c) && this.state === 'wait') this.close();
    }, ROOM_IDLE_TIMEOUT);
  }
  close(){
    if (this.emptyTimer){ clearTimeout(this.emptyTimer); this.emptyTimer = null; }
    for (const c of this.seats){
      if (!c) continue;
      if (c.takeoverTimer){ clearTimeout(c.takeoverTimer); c.takeoverTimer = null; }
      if (c.graceTimer){ clearTimeout(c.graceTimer); c.graceTimer = null; }
    }
    for (const c of this.seats) if (c) c.send({ t:'bye' });
    rooms.delete(this.no);
    log(`房 ${this.no} 关闭`);
  }
}

/* ========================================================================
   连接
   ======================================================================== */
class Conn {
  constructor(ws, room, seat, name){
    this.ws = ws; this.room = room; this.seat = seat;
    this.name = name || ('玩家' + (seat + 1));
    this.token = token();
    this.online = true;
    bindWs(ws, this);
  }
  send(o){ try{ if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }catch(e){} }
  rebind(ws){
    // v1.2.15：旧连接还开着 = 同一个座位在别处（另一个页面/设备）又进来了。
    // 不通知旧连接的话，它会继续停在牌桌却永远收不到询问和投影 → 「点听牌没用」的假死。
    // 这里先给旧页面发 kicked 再断开，让它体面退回首页（且不再自动重连抢座位）。
    const old = this.ws;
    if (old && old !== ws && old.readyState === 1){
      try{ old.send(JSON.stringify({ t:'kicked', msg:'这个座位已在别处进入，本页已退出' })); }catch(e){}
      try{ old.close(); }catch(e){}
    }
    this.ws = ws; this.online = true;
    if (this.takeoverTimer){ clearTimeout(this.takeoverTimer); this.takeoverTimer = null; }
    bindWs(ws, this);
  }
  /* 主动退出（点「离开房间 / 回到首页」）：立即释放座位；房间没人了就当场销毁 */
  leave(){
    const room = this.room;
    if (this.graceTimer){ clearTimeout(this.graceTimer); this.graceTimer = null; }
    if (!room) return;
    if (room.state === 'wait'){
      if (room.hostSeatNo === this.seat) room.hostSeatNo = -1;   // 房主离开 → 顺延给首个在座者
      if (room.seats[this.seat] === this) room.seats[this.seat] = null;
      room.ready[this.seat] = false;
      this.room = null;
      if (!room.seats.some(c => c)){ room.close(); return; }
      room.broadcastRoom();
    }
  }
}

function bindWs(ws, conn){
  ws.on('message', raw => {
    let m = null;
    try{ m = JSON.parse(raw); }catch(e){ return; }
    handle(conn, m);
  });
  ws.on('close', () => onDisconnect(conn));
  ws.on('error', () => {});
}

function onDisconnect(conn){
  conn.online = false;
  const room = conn.room;
  if (!room) return;
  log(`房 ${room.no} 座位 ${conn.seat}（${conn.name}）掉线`);
  if (room.state === 'wait'){
    // 等待中掉线 ≠ 退出：座位保留 OFFLINE_GRACE（5 分钟），期间重连自动复座。
    // 只有「主动退出」或宽限期到了才真正释放座位，避免切后台一下房间就没了。
    room.broadcastRoom();
    if (conn.graceTimer) clearTimeout(conn.graceTimer);
    conn.graceTimer = setTimeout(() => {
      conn.graceTimer = null;
      if (conn.online) return;                    // 期间回来了
      log(`房 ${room.no} 座位 ${conn.seat}（${conn.name}）保留超时，释放座位`);
      conn.leave();
    }, OFFLINE_GRACE);
  } else {
    room.broadcastRoom();
    // 掉线 60 秒即视为托管（AI 只在其回合自动代打；重连随时收回）
    conn.takeoverTimer = setTimeout(() => {
      if (room.host) room.host.broadcastViews();
      log(`房 ${room.no} 座位 ${conn.seat} 已托管`);
    }, 60000);
    // 若牌局中所有人都离线：
    //   · 一局已结算（betweenHands，等人准备下一局）→ 不中止牌局，保留结算数据等人重连回来；
    //     一直没人回来则由 2 小时空闲回收兜底
    //   · 局进行中 → 保持原有 1.5 秒自动中止（回等待室，房间可重进）
    const anyOther = room.seats.some(c => c && c.online);
    if (!anyOther && !(room.host && room.host.betweenHands)){
      setTimeout(() => {
        if (room.state === 'playing' && room.host && !room.host.betweenHands &&
            !room.seats.some(c => c && c.online)){
          log(`房 ${room.no} 所有人均离线，牌局中止`);
          room.host.endGame();
        }
      }, 1500);
    }
  }
}

/* ========================================================================
   游戏宿主：驱动规则引擎（与单机同一份代码）
   ======================================================================== */
class GameHost {
  constructor(room){
    this.room = room;
    this.state = 'playing';
    this.pending = null;      // { seat, kind, timer }
    this.sched = false;
    this.askDeadline = 0;     // 当前决策的截止时刻（服务端时钟）；0 = 此刻无人需要决策
    this.ready = new Set();   // 局间「准备下一局」：已准备的真实座位集合
    this.betweenHands = false; // 一局已结算、尚未开下一局的空档

    // 种子由房间号 + 开局序号派生：同房间同一次开局必然同牌序（可复盘可验证）；
    // v1.2.11：混入 gameSeq —— 「结束本局」后重开发新牌，不再复现上一局的牌
    this.seed = handSeed(Number(room.no), room.gameSeq, 0);

    this.S = boot({
      seed: this.seed,
      onRender: () => this.scheduleView(),
      onToast: (text, cls, seat) => this.broadcast({ t:'toast', text, cls, seat }),
      onSheet: () => {},
      onSettle: (html, dealer, rec) => this.onSettle(html, dealer, rec)
    });
    const S = this.S;
    // 引擎 ask() 的服务端路由（patch 钩子）：谁要做决定 → GameHost.onAsk
    S.onAsk = pend => this.onAsk(pend);
    // CFG/G 是 const 声明，须经 __state 桥访问（见 headless.js）
    // 按房主设定的本桌规则初始化（开局后锁定，中途不能改）
    const cfg = Object.assign(defaultCfg(), room.cfg || {});
    for (const k of ['base', 'unit', 'lezi', 'allowChow', 'sevenPairs', 'lajiHu', 'autoKnock', 'autoHu', 'speed']){
      S.__state.CFG[k] = cfg[k];
    }
    S.initGame();                      // 生成四家玩家对象（G.players）

    // 座位填充：真人用昵称；空位补机器人
    const G = S.__state.G;
    for (let i = 0; i < 4; i++){
      const conn = room.seats[i];
      if (conn){ G.players[i].isBot = false; G.players[i].name = conn.name; }
      else { G.players[i].isBot = true; G.players[i].name = BOT_NAMES[i % BOT_NAMES.length]; }
    }

    log(`房 ${room.no} 开局 seed=${this.seed} 真人=${room.seats.filter(Boolean).length}`);
    S.runHand();
  }

  broadcast(o){ for (const c of this.room.seats) if (c && c.online) c.send(o); }

  /* 每次引擎 render() = 局面更新 → 微任务合并后向各家推专属投影 */
  scheduleView(){
    if (this.sched || this.dead) return;
    this.sched = true;
    setImmediate(() => { this.sched = false; if (!this.dead) this.broadcastViews(); });
  }
  /* 座位专属投影 + 全局倒计时。
     倒计时下发「相对剩余毫秒」而不是绝对时刻：各家按自己收到消息的时刻起算，
     不受客户端与服务端时钟偏差影响，四家看到的数字始终一致。 */
  viewFor(seat, online){
    const v = projectFor(this.S, seat, online);
    v.askLeft = this.askDeadline ? Math.max(0, this.askDeadline - Date.now()) : 0;
    v.cfg = this.room.cfg;            // 开局后规则锁定，客户端只用来「查看」
    v.ready = [...this.ready];        // 局间「准备下一局」：已准备的真实座位列表
    return v;
  }
  broadcastViews(){
    if (this.dead) return;
    this.room.touch();                      // 牌局仍在推进 → 不算挂起
    const online = this.room.seats.map(c => !!(c && c.online));
    for (let i = 0; i < 4; i++){
      const c = this.room.seats[i];
      if (c && c.online) c.send({ t:'view', view: this.viewFor(i, online) });
    }
  }

  /* 引擎 ask()：等待真人回包；掉线/空位 → AI 托管 */
  onAsk(pend){
    const seat = pend.seat;
    if (this.dead) return;
    const conn = this.room.seats[seat];
    if (this.pending){ clearTimeout(this.pending.timer); this.pending = null; }
    if (conn && conn.online){
      const deadline = Date.now() + ASK_TIMEOUT;
      this.askDeadline = deadline;          // 有人在决策 → 全员桌心显示同一个倒计时
      this.broadcastViews();
      conn.send({ t:'ask', kind: pend.kind, payload: pend.payload, deadline, askLeft: ASK_TIMEOUT });
      this.pending = {
        seat, kind: pend.kind,
        timer: setTimeout(() => { this.pending = null; this.autoAct(seat, pend.kind); }, ASK_TIMEOUT + 800)
      };
    } else {
      // 掉线托管：不显示倒计时（AI 500ms 内即决策），稍作停顿保持牌局节奏
      this.askDeadline = 0;
      this.broadcastViews();
      setTimeout(() => this.autoAct(seat, pend.kind), 500);
    }
  }

  /* AI 托管决策（引擎自带的机器人逻辑） */
  autoAct(seat, kind){
    if (this.dead) return;
    this.askDeadline = 0;                     // 决策已落地，倒计时收起
    const S = this.S, P = S.__state.PEND, G = S.__state.G;
    if (!P || P.seat !== seat || P.kind !== kind) return;
    const p = G.players[seat];
    let v = null;
    if (kind === 'discard') v = S.aiChooseDiscard(p);
    else if (kind === 'knock') v = 'pass';                       // 托管保守：不敲
    else if (kind === 'zimo') v = 'hu';                          // 托管：有胡必胡
    else if (kind === 'selfkong') v = (P.payload.options && P.payload.options[0]) || null;  // 托管自动杠
    else if (kind === 'claim'){
      const isNext = ((P.payload.from + 1) % 4) === seat;
      v = S.aiClaim(p, P.payload.tile, P.payload.from, P.payload.opts, isNext) || null;
    }
    S.resolvePend(v);
  }

  /* 客户端动作上报（服务端权威校验） */
  onAct(conn, kind, value){
    if (this.dead) return;
    const S = this.S, G = S.__state.G;

    // 局间「准备下一局」：四家真人（bot/掉线自动算已准备）都 ready 后自动开局
    if (kind === 'ready'){
      if (!this.betweenHands || !G.finished || !G.result) return;
      const seat = conn.seat;
      if (value === false) this.ready.delete(seat);
      else this.ready.add(seat);
      this.broadcastViews();                          // 下发最新 ready 状态（牌河「准备」字样）
      const allReady = this.room.seats.every((c, i) => !c || !c.online || this.ready.has(i));
      if (allReady){
        this.betweenHands = false;
        this.ready.clear();
        S.nextHand(G.result.dealer);
      }
      return;
    }

    // 「下一局」：兼容旧客户端（单人/旧流程），服务端只认第一份
    if (kind === 'next'){
      if (G.finished && G.result){
        this.betweenHands = false;
        this.ready.clear();
        S.nextHand(G.result.dealer);
      }
      return;
    }

    if (!this.pending || this.pending.seat !== conn.seat) return;
    const P = S.__state.PEND;
    if (!P || P.kind !== kind || P.seat !== conn.seat) return;
    const p = G.players[conn.seat];

    let v = value;
    if (kind === 'discard'){
      if (typeof v !== 'number' || p.hand.indexOf(v) < 0) v = S.aiChooseDiscard(p);
    } else if (kind === 'claim'){
      if (v && typeof v === 'object'){
        const ok = P.payload.opts.some(o =>
          o.k === v.k && o.tile === v.tile &&
          (!o.combo || String(o.combo) === String(v.combo)));
        if (!ok) v = null;
      } else v = null;
    } else if (kind === 'knock'){
      v = (v === 'knock') ? 'knock' : 'pass';
    } else if (kind === 'zimo'){
      v = (v === 'hu') ? 'hu' : 'pass';
    } else if (kind === 'selfkong'){
      if (v && typeof v === 'object' && (v.k === 'ankan' || v.k === 'chakan')){
        const ok = (P.payload.options || []).some(o => o.k === v.k && o.tile === v.tile);
        if (!ok) v = null;
      } else v = null;
    }

    clearTimeout(this.pending.timer); this.pending = null;
    this.askDeadline = 0;                     // 决策已落地，倒计时收起
    S.resolvePend(v);
  }

  /* 一局结束：广播结算面板 + 最终投影（进入局间「准备下一局」状态） */
  onSettle(html, dealer, rec){
    if (this.dead) return;
    this.askDeadline = 0;
    this.betweenHands = true;          // 进入局间，等待四家「准备下一局」
    this.lastSettle = { html, dealer, rec };
    this.ready.clear();
    const online = this.room.seats.map(c => !!(c && c.online));
    for (let i = 0; i < 4; i++){
      const c = this.room.seats[i];
      if (c && c.online){
        c.send({ t:'settle', html, dealer, rec, view: this.viewFor(i, online) });
      }
    }
    log(`房 ${this.room.no} 第 ${rec.no} 局结束：${rec.kind} 分数 ${JSON.stringify(rec.scores)}`);
  }

  /* 房主主动结束游戏 / 所有人掉线导致牌局中止 */
  endGame(opts = {}){
    const S = this.S, room = this.room;
    this.dead = true;                       // 丢弃引擎后续回调，避免向已结束的牌局推投影
    if (this.pending){ clearTimeout(this.pending.timer); this.pending = null; }
    this.askDeadline = 0;
    // 注意：不要去 resolve 引擎的 PEND —— 强行 resolve(null) 会让 discard 拿到非法牌而抛错。
    // 引擎的 async 循环就此挂起，随 room.host = null 一起被 GC 回收。
    S.__state.PEND = null;
    S.__state.G.abort = true;
    S.__state.G.running = false;
    room.host = null;
    room.state = 'wait';
    room.ready.fill(false);
    for (let i = 0; i < 4; i++){
      const c = room.seats[i];
      if (c && !c.online){ room.seats[i] = null; room.ready[i] = false; }
    }
    for (const c of room.seats){ if (c && c.online) c.send({ t:'ended' }); }
    room.broadcastRoom();
    if (opts.close){ room.close(); return; }
    // 回到等待室是一个新起点：重新计时，否则上一局的时长会被算成「无活动」而立刻回收
    room.touch();
    log(`房 ${room.no} 牌局已结束，回到等待室`);
    // 无人留守：房号保留 10 分钟方便原班人马回来，超时释放
    if (!room.seats.some(c => c)) room.scheduleEmptyClose();
  }
}

/* ========================================================================
   消息路由
   ======================================================================== */
function handle(conn, m){
  if (conn.room) conn.room.touch();
  switch (m.t){
    case 'ping': break;
    case 'ready': {
      const room = conn.room;
      if (!room || room.state !== 'wait') return;
      if (conn.seat === room.hostSeat()) return;   // 房主不需要准备
      room.ready[conn.seat] = !room.ready[conn.seat];
      room.broadcastRoom();
      break;
    }
    case 'start': {
      const room = conn.room;
      if (!room || room.state !== 'wait') return;
      if (room.hostSeat() !== conn.seat){ conn.send({ t:'err', msg:'只有房主能开始游戏' }); return; }
      // 已加入的真人（除房主外）必须全部准备；空位不算，开局时补机器人
      const notReady = room.seats.some((c, i) => c && i !== conn.seat && !room.ready[i]);
      if (notReady){ conn.send({ t:'err', msg:'还有玩家未准备' }); return; }
      room.state = 'playing';
      room.gameSeq++;                        // v1.2.11：每次开局种子递进，「结束本局」重开不再发同一副牌
      for (const c of room.seats) if (c) c.send({ t:'start' });
      room.host = new GameHost(room);
      break;
    }
    case 'act': {
      const room = conn.room;
      if (room && room.host && room.state === 'playing') room.host.onAct(conn, m.kind, m.value);
      break;
    }
    case 'cfg': {
      const room = conn.room;
      if (!room) return;
      if (room.hostSeat() !== conn.seat){ conn.send({ t:'err', msg:'只有房主能修改规则' }); return; }
      if (room.state !== 'wait'){ conn.send({ t:'err', msg:'牌局进行中不能改规则' }); return; }
      const src = m.cfg || {};
      let n = 0;
      for (const k of Object.keys(CFG_ALLOW)){
        if (typeof src[k] === 'undefined') continue;
        const v = CFG_ALLOW[k](src[k]);
        if (v === null) continue;
        room.cfg[k] = v; n++;
      }
      if (!n) return;
      room.touch();
      log(`房 ${room.no} 规则更新：${JSON.stringify(room.cfg)}`);
      // 房主改了规则：除了房主自己，其他人都弹一条顶部小提示
      for (const c of room.seats){
        if (c && c !== conn && c.online) c.send({ t:'toast', text:'房主修改了游戏设置' });
      }
      room.broadcastRoom();           // 带着 cfg 下发，房间里其他人立刻看到
      break;
    }
    case 'kick': {
      const room = conn.room;
      if (!room) return;
      if (room.hostSeat() !== conn.seat){ conn.send({ t:'err', msg:'只有房主能移出玩家' }); return; }
      if (room.state !== 'wait'){ conn.send({ t:'err', msg:'牌局进行中不能移出玩家' }); return; }
      const seat = Number(m.seat);
      const target = room.seats[seat];
      if (seat === conn.seat){ conn.send({ t:'err', msg:'不能移出自己' }); return; }
      if (!target) return;
      log(`房 ${room.no} 座位 ${seat}（${target.name}）被房主移出`);
      target.send({ t:'bye', msg:'房主把你移出了房间' });
      if (target.graceTimer){ clearTimeout(target.graceTimer); target.graceTimer = null; }
      room.seats[seat] = null; room.ready[seat] = false;
      target.room = null;
      try{ target.ws.onclose = null; target.ws.onerror = null; target.ws.close(); }catch(e){}
      room.broadcastRoom();
      room.touch();
      break;
    }
    case 'end': {
      const room = conn.room;
      if (!room || room.state !== 'playing' || room.hostSeat() !== conn.seat) break;
      room.host.endGame();
      break;
    }
    case 'close': {
      const room = conn.room;
      if (!room || room.hostSeat() !== conn.seat) break;
      if (room.host && room.state === 'playing') room.host.endGame({ close: true });
      else room.close();
      break;
    }
    case 'leave': {
      conn.send({ t:'bye' });
      const room = conn.room;
      if (room && room.state === 'playing'){
        // 牌局中主动退出：座位保留给机器人托管到底，房间不销毁；
        // 若所有人都已离线，onDisconnect 会在 ws close 后自动中止牌局
        conn.online = false;
      } else if (room){
        conn.leave();
      }
      try{ conn.ws.close(); }catch(e){}
      break;
    }
    case 'moveSeat': {
      const room = conn.room;
      if (!room || room.state !== 'wait'){ conn.send({ t:'err', msg:'只能在等待中换座' }); return; }
      const target = Number(m.seat);
      if (target < 0 || target > 3 || !Number.isInteger(target)) return;
      if (target === conn.seat) return;
      if (room.seats[target]){ conn.send({ t:'err', msg:'座位已被占' }); return; }
      // 房主换座：房主身份跟着人走，不会被座位号更小的人顶替
      const wasHost = (room.hostSeat() === conn.seat);
      room.seats[conn.seat] = null;
      room.ready[conn.seat] = false;
      conn.seat = target;
      room.seats[target] = conn;
      if (wasHost) room.hostSeatNo = target;
      room.ready[target] = false;
      room.touch();
      log(`房 ${room.no} 玩家 ${conn.name} 换到座位 ${target}${wasHost ? '（房主）' : ''}`);
      // 重发 welcome 让客户端刷新 mySeat + token 仍可用（座位换了视角）
      conn.send({ t:'welcome', seat: conn.seat, token: conn.token, roomNo: room.no, isHost: room.hostSeat() === conn.seat });
      room.broadcastRoom();
      break;
    }
  }
}

/* ========================================================================
   HTTP + WebSocket
   ======================================================================== */
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html'){
    fs.readFile(path.join(ROOT, 'index.html'), (err, buf) => {
      if (err){ res.writeHead(500); res.end('read index.html failed'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.on('message', raw => {
    let m = null;
    try{ m = JSON.parse(raw); }catch(e){ return; }

    if (m.t === 'create'){
      const room = new Room();
      const conn = room.addPlayer(ws, cleanName(m.name));
      if (!conn){ room.close(); return; }
      sendWelcome(conn, true);
      room.broadcastRoom();
    } else if (m.t === 'join'){
      const room = rooms.get(String(m.roomNo || ''));
      if (!room){ ws.send(JSON.stringify({ t:'err', msg:'房间不存在，检查房间号' })); return; }
      const name = cleanName(m.name);
      // 牌局进行中：允许用同一昵称顶替掉线（托管中）的座位回去继续打
      if (room.state === 'playing'){
        const seat = room.seats.find(c => c && !c.online && c.name === name);
        if (!seat){
          ws.send(JSON.stringify({ t:'err', msg:'牌局进行中，等这一局结束后再进' }));
          return;
        }
        resumeSeat(room, seat, ws);
        return;
      }
      const conn = room.addPlayer(ws, name);
      if (!conn){ ws.send(JSON.stringify({ t:'err', msg:'房间已满（4 人）' })); return; }
      // 房主可能已经换人（原房主退出/重进后座位变动），按当前实际房主下发
      sendWelcome(conn, room.hostSeat() === conn.seat);
      room.broadcastRoom();
    } else if (m.t === 'reconnect'){
      const room = rooms.get(String(m.roomNo || ''));
      if (!room){ ws.send(JSON.stringify({ t:'err', msg:'房间已解散' })); ws.close(); return; }
      const old = room.seats.find(c => c && c.token === m.token);
      if (!old){ ws.send(JSON.stringify({ t:'err', msg:'重连凭证无效' })); ws.close(); return; }
      resumeSeat(room, old, ws);
      log(`房 ${room.no} 座位 ${old.seat}（${old.name}）重连`);
    }
  });
});

/* 断线后回到牌局：发齐 welcome/名单/牌面/当前询问 */
function resumeSeat(room, conn, ws){
  conn.rebind(ws);
  conn.send({ t:'welcome', seat: conn.seat, token: conn.token, roomNo: room.no, isHost: room.hostSeat() === conn.seat });
  conn.send({ t:'roomNo', roomNo: room.no });
  room.broadcastRoom();
  if (room.host){
    const host = room.host;
    // v1.2.15：重连回牌局清掉「本轮已问过不敲」的记忆——
    // 掉线期间被托管对敲听询问答了「不敲」（或超时），会把当时的听口记进 noPromptSig，
    // 之后同一个听口引擎不再问 → 玩家回来后「点听牌没用」、一直敲不了。
    // 清掉后下一次凑到听口会重新询问一次。
    const Gp = host.S.__state.G;
    if (Gp && Gp.players[conn.seat]) Gp.players[conn.seat].noPromptSig = '';
    // 注意：这里不能发 t:'start'——客户端 case 'start' 会清 NET.lastSettle，
    // 若在「结算后等准备」阶段重连，会丢掉结算数据导致底部按钮消失。view 已足够恢复牌桌。
    conn.send({ t:'view', view: host.viewFor(conn.seat, room.seats.map(c => !!(c && c.online))) });
    // v1.2.5：本局已结算时补发 settle，让客户端恢复 NET.lastSettle；否则重连后点「查看结算」不弹窗
    if (host.betweenHands && host.lastSettle){
      const G = host.S.__state.G;
      if (G && G.finished && G.result){
        conn.send({ t:'settle', html: host.lastSettle.html, dealer: host.lastSettle.dealer, rec: host.lastSettle.rec });
      }
    }
    // 若正等着这家决策，按「真实剩余时间」重发询问（不是重新给满 15 秒）
    if (host.pending && host.pending.seat === conn.seat && S_PEND_matches(host, conn.seat)){
      const P = host.S.__state.PEND;
      conn.send({
        t:'ask', kind: P.kind, payload: P.payload,
        deadline: host.askDeadline || (Date.now() + ASK_TIMEOUT),
        askLeft: host.askDeadline ? Math.max(0, host.askDeadline - Date.now()) : ASK_TIMEOUT
      });
    }
  }
}

function S_PEND_matches(host, seat){
  const P = host.S.__state.PEND;
  return !!(P && P.seat === seat);
}

function cleanName(n){
  n = String(n || '').replace(/[<>&"']/g, '').trim().slice(0, 8);
  return n || '';
}
function sendWelcome(conn, isHost){
  conn.send({ t:'welcome', seat: conn.seat, token: conn.token, roomNo: conn.room.no, isHost });
  conn.send({ t:'roomNo', roomNo: conn.room.no });
}

/* ========================================================================
   房间回收：清理长期无人操作 / 无人留守的房间
   ======================================================================== */
/* 空闲回收：一个阈值管三种情形（无人留守 / 等待中无活动 / 牌局挂起），扫一次一起清 */
function scanRooms(){
  const now = Date.now();
  for (const room of Array.from(rooms.values())){
    if (!rooms.has(room.no)) continue;
    if (now - room.lastActive <= ROOM_IDLE_TIMEOUT) continue;
    if (room.state === 'playing'){
      log(`房 ${room.no} 空闲超时（牌局挂起 ${Math.round((now - room.lastActive) / 60000)} 分），回收`);
      if (room.host) room.host.endGame({ close: true }); else room.close();
    } else {
      log(`房 ${room.no} 空闲超时（${Math.round((now - room.lastActive) / 60000)} 分无活动），回收`);
      room.close();
    }
  }
}

server.listen(PORT, () => {
  log(`一道来敲麻 v1.2.22 服务端已启动: http://0.0.0.0:${PORT}`);
  log('手机浏览器访问上面的地址 → 多人对战 → 创建房间');
  setInterval(scanRooms, SCAN_INTERVAL).unref();
  setInterval(() => {
    if (rooms.size) log(`房间数：${rooms.size}`);
  }, STATS_INTERVAL).unref();
});
