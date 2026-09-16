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
// v1.3.0 大模型机器人：未配置 CLOUDBASE_ENV / CLOUDBASE_API_KEY 时 isEnabled()=false，一切照旧走本地 AI
const aibrain = require('../proto/server/aibrain');

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.resolve(__dirname, '..');

const ASK_TIMEOUT = 15000;        // 出牌 / 吃碰杠 / 敲 的默认思考超时（毫秒）；v1.2.27 起可被房间规则 cfg.cd（15/30/0 秒）覆盖
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
// v1.2.49 掉线检测：手机锁屏/切网/杀后台经常不产生 close 事件（半开连接），
// 只靠 close 判掉线会让座位一直「显示在线」→ 不托管、询问发进黑洞、全桌卡死。
const PING_EVERY         = ms('PING_EVERY',         15 * 1000);       // 连接探活间隔（协议层 ping 保活）
const DEAD_AFTER         = ms('DEAD_AFTER',         60 * 1000);       // 超过该时长没有任何入站消息 → 判定掉线
const PEND_GUARD         = ms('PEND_GUARD',         90 * 1000);       // 无限时房间决策兜底：超时自动托管
const STALE_AFTER        = ms('STALE_AFTER',        60 * 1000);       // 牌局中同名重进：座位失联超时也允许复座

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
  autoHu:     v => (v === true || v === false || v === 1 || v === 0) ? !!v : null,
  cd:         v => [0, 15, 30].includes(Number(v)) ? Number(v) : null,  // v1.2.27 出牌倒计时（秒），0=无限时
  // v1.3.1 机器人按座位分别设置：数组长度必须正好 4，下标 = 真实座位号。
  // 机器人 = 空位（真人的座位这两个值没意义，但照样存着，换座 / 掉线托管时行为可预期）。
  aiSeats:    v => (Array.isArray(v) && v.length === 4) ? v.map(x => !!x) : null,
  spd:        v => {
    if (!Array.isArray(v) || v.length !== 4) return null;
    const out = v.map(x => [0.6, 1, 1.8].includes(Number(x)) ? Number(x) : null);
    return out.some(x => x === null) ? null : out;
  }
};

/* 房间默认规则（与 index.html 的 CFG 默认值一致）；房主可在等待页改，开局后锁定 */
function defaultCfg(){
  return {
    base: 2, unit: 1, lezi: 8,
    allowChow: true, sevenPairs: false, lajiHu: true,
    autoKnock: false, autoHu: false, speed: 1, cd: 0,
    aiSeats: [true, true, true, true],   // 默认每台机器人都用大模型（与单机默认一致）
    spd: [1, 1, 1, 1]                    // 各自 0.6 慢 / 1 中 / 1.8 快，只有不用大模型时才用得上
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
      host: this.hostSeat() === i,
      gender: c.gender
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
    this.lastSeen = Date.now();   // v1.2.49 最近一次入站消息时刻（探活用）
    // v1.2.47 语音音色（'m' 男 / 'f' 女 / 'none' 不要语音）：个人设置，广播给全房间
    this.gender = 'f';
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
    // v1.2.40：等待室掉线会给座位挂 5 分钟保留定时器；人回来了就撤掉，
    // 免得计时到点把刚复座的玩家再次踢出房间
    if (this.graceTimer){ clearTimeout(this.graceTimer); this.graceTimer = null; }
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
    // v1.2.49：掉线时正好轮到这家决策 → 8 秒后交给托管 AI（期间回来则作废，继续等本人）
    if (room.host && room.host.pending && room.host.pending.seat === conn.seat){
      const seat = conn.seat, kind = room.host.pending.kind;
      setTimeout(() => {
        if (conn.online) return;                      // 已重连回来，询问已在等本人
        if (room.host && !room.host.dead) room.host.autoAct(seat, kind);
      }, 8000);
    }
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
    // v1.2.27 出牌倒计时：读房间规则 cfg.cd（15/30 秒，0=无限时），且仅当开局时真人 ≥2 才启用——
    // 1 真人（单机练习 / 房主带机器人）不限时，视为「无」
    this.askMs = (room.seats.filter(c => c).length >= 2 && room.cfg.cd > 0) ? room.cfg.cd * 1000 : 0;
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
      onSettle: (html, dealer, rec) => this.onSettle(html, dealer, rec),
      // v1.2.47 语音/音效：引擎 emitSfx → 广播全房间（各客户端按该座位音色播放）
      onSfx: (kind, seat, tile) => this.broadcast({ t: 'sfx', kind, seat, tile })
    });
    const S = this.S;
    // 引擎 ask() 的服务端路由（patch 钩子）：谁要做决定 → GameHost.onAsk
    S.onAsk = pend => this.onAsk(pend);
    // v1.3.0：联机房间的机器人默认也走大模型（与单机默认一致）；
    // v1.3.1：具体哪几个座位用大模型由房间规则 cfg.aiSeats 决定（房主在等待页设定）；
    // 未配环境变量 / AI_BOT_TIER=off → 房间机器人退回本地逻辑。
    if (aibrain.isEnabled() && aibrain._env.serverTier !== 'off' && typeof S.setAiBrain === 'function'){
      S.setAiBrain({ ask: p => aibrain.decide(p) }, aibrain._env.serverTier);
    }
    // CFG/G 是 const 声明，须经 __state 桥访问（见 headless.js）
    // 按房主设定的本桌规则初始化（开局后锁定，中途不能改）
    const cfg = Object.assign(defaultCfg(), room.cfg || {});
    for (const k of ['base', 'unit', 'lezi', 'allowChow', 'sevenPairs', 'lajiHu', 'autoKnock', 'autoHu', 'speed', 'aiSeats', 'spd']){
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

    log(`房 ${room.no} 开局 seed=${this.seed} 真人=${room.seats.filter(Boolean).length}` +
        ` 机器人AI=${(cfg.aiSeats || []).map(v => (v ? 'AI' : '本')).join('/')}`);
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
      // v1.2.27：时限取开局时算好的 askMs（房间规则 cfg.cd 且真人 ≥2 才有时限；0 = 无限时）
      // v1.2.49：无限时也有 PEND_GUARD 兜底 —— 之前 cd=0 时该定时器为 null，掉线座位的询问会永久挂起，全桌卡死
      const tmo = this.askMs;
      const deadline = tmo ? Date.now() + tmo : 0;
      this.askDeadline = deadline;          // 有人在决策 → 全员桌心显示同一个倒计时
      this.broadcastViews();
      conn.send({ t:'ask', kind: pend.kind, payload: pend.payload, deadline, askLeft: tmo });
      this.pending = {
        seat, kind: pend.kind,
        timer: setTimeout(() => { this.pending = null; this.autoAct(seat, pend.kind); },
          tmo ? tmo + 800 : PEND_GUARD)
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
  conn.lastSeen = Date.now();          // v1.2.49 任何入站消息都算活跃
  if (conn.room) conn.room.touch();
  switch (m.t){
    case 'ping': conn.send({ t:'pong' }); break;   // v1.2.49：回复客户端探活（之前不回，客户端回前台探活只能靠运气）
    /* v1.2.47 语音音色（纯个人设置，不属房间规则）：'m' 男 / 'f' 女 / 'none' 不要语音 */
    case 'voice': {
      const room = conn.room;
      const g = m.gender;
      if (g === 'm' || g === 'f' || g === 'none') conn.gender = g;
      if (room) room.broadcastRoom();
      break;
    }
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
/* v1.2.53 AI 大脑的 HTTP 出口：单机模式下浏览器引擎经这里问大模型。
   同源调用（index.html 由本服务托管）→ 不需要 CORS；也不对外开放跨域，避免被外部页面白嫖额度。 */
function sendJson(res, code, obj){
  let s = '{"ok":false}';
  try { s = JSON.stringify(obj); } catch (e){}
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}
function readJson(req, cb){
  let buf = '', done = false;
  const fin = (e, v) => { if (done) return; done = true; cb(e, v); };
  req.on('data', c => {
    if (done) return;
    buf += c;
    if (buf.length > 32 * 1024) fin(new Error('too_large'));
  });
  req.on('end', () => {
    if (done) return;
    try { fin(null, JSON.parse(buf || '{}')); } catch (e){ fin(e); }
  });
  req.on('error', e => fin(e));
}

/* ---------- /api/ai/* 的防滥用闸门 ----------
   这两个接口是公开的（单机模式在浏览器里同源调用），而每次调用都会花掉真实的模型额度，
   所以必须挡住「随便谁都能刷」的情况。三道闸，都不影响正常玩法：
     1) 同源校验：浏览器同源 fetch 一定会带 Origin，允许 Origin 为空（老客户端/同源 GET），
        但带了 Origin 就必须与本站一致 —— 挡掉跨站脚本拿玩家浏览器当代理刷额度。
     2) 单 IP 限流：固定窗口计数，正常牌局每分钟最多几十次决策，给到 240 次/分仍很宽裕。
     3) 全局限流：单 IP 那道闸依赖 X-Forwarded-For，而它是客户端可伪造的；再加一道
        **进程级总闸**（300 次/分）兜底 —— 就算有人不断换 IP，也刷不爆额度。
        （其实网关自己对模型有 60 次/分限制，这里是双保险，顺带挡住请求洪水。）
     4) probe 冷却：?probe=1 会真打一次模型，同一 IP 每 20 秒只放行一次。 */
const AI_RATE = { win: 60000, max: 240, globalMax: 300, probeCd: 20000, hits: new Map(), gt0: 0, gn: 0 };
function clientIp(req){
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '-';
}
function sameOrigin(req){
  const org = req.headers.origin;
  if (!org || org === 'null') return true;          // 同源 GET / 非浏览器客户端：不靠这道闸，靠限流
  const host = req.headers.host;
  if (!host) return false;
  try { return new URL(org).host === host; } catch (e){ return false; }
}
function aiAllowed(req, isProbe){
  if (!sameOrigin(req)) return 'origin';
  const ip = clientIp(req);
  const now = Date.now();
  if (!AI_RATE.gt0 || now - AI_RATE.gt0 >= AI_RATE.win){ AI_RATE.gt0 = now; AI_RATE.gn = 0; }
  let b = AI_RATE.hits.get(ip);
  if (!b || now - b.t0 >= AI_RATE.win) { b = { t0: now, n: 0, probe: 0 }; AI_RATE.hits.set(ip, b); }
  if (isProbe){
    if (now - b.probe < AI_RATE.probeCd) return 'probe_cd';
    b.probe = now;
  }
  AI_RATE.gn++;
  if (AI_RATE.gn > AI_RATE.globalMax) return 'global';
  b.n++;
  if (b.n > AI_RATE.max) return 'rate';
  if (AI_RATE.hits.size > 2000){                     // 简单的表清理，防内存无界增长
    for (const [k, v] of AI_RATE.hits) if (now - v.t0 >= AI_RATE.win) AI_RATE.hits.delete(k);
  }
  return '';
}

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
  // 大模型能力探测：客户端启动时问一次，未配置就静默保持本地逻辑
  if (url === '/api/ai/status'){
    // ?probe=1 会真的打一次模型，用来回答「接口到底通没通」（默认走缓存，不额外花钱）
    const wantProbe = /[?&]probe=1/.test(req.url || '');
    const base = aibrain.status();
    if (!wantProbe || !base.enabled){ sendJson(res, 200, base); return; }
    const deny = aiAllowed(req, true);
    if (deny){ sendJson(res, 200, Object.assign({}, base, { probe: { ok: false, detail: 'probe 被限流（' + deny + '）' } })); return; }
    Promise.resolve()
      .then(() => aibrain.probe(true))
      .then(pr => sendJson(res, 200, Object.assign({}, aibrain.status(), { probe: pr })))
      .catch(e => sendJson(res, 200, Object.assign({}, base, { probe: { ok: false, detail: String((e && e.message) || e).slice(0, 200) } })));
    return;
  }
  // 单机机器人决策：{ kind, tier, view } → { ok, discard|action, reason }
  if (url === '/api/ai/decide'){
    if (req.method !== 'POST'){ sendJson(res, 405, { ok: false, error: 'method' }); return; }
    const deny = aiAllowed(req, false);
    if (deny){ sendJson(res, 429, { ok: false, error: deny }); return; }
    readJson(req, (err, body) => {
      if (err){ sendJson(res, 400, { ok: false, error: 'bad_body' }); return; }
      Promise.resolve()
        .then(() => aibrain.decide(body))
        .then(r => sendJson(res, r && r.ok ? 200 : 503, r || { ok: false }))
        .catch(e => sendJson(res, 500, { ok: false, error: 'internal', detail: String((e && e.message) || e).slice(0, 120) }));
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
      // v1.2.40：重进房间时若已有同名座位，一律复用，避免「掉线后重新进入 → 房间里有两个我」。
      //   · 等待室：不管原座位是在线还是掉线，都复用（rebind 会给旧页面发 kicked 让它退回首��）
      //   · 牌局进行中：只允许接管「掉线」座位（防止用同名把在线玩家挤下去）
      const same = room.seats.find(c => c && c.name === name);
      // v1.2.49：牌局中同名重进放宽 —— 座位「掉线」或「失联超 STALE_AFTER」（半开连接，服务端尚未判死）都允许复座，
      // 否则掉线玩家拿不回座位，牌局又卡在他的回合上
      const stale = same && (Date.now() - (same.lastSeen || 0) > STALE_AFTER);
      if (same && (room.state !== 'playing' || !same.online || stale)){
        log(`房 ${room.no} 座位 ${same.seat}（${name}）重新进入，复用原座位（原状态 ${same.online ? (stale ? '在线但失联' : '在线') : '掉线'}）`);
        resumeSeat(room, same, ws);
        return;
      }
      if (room.state === 'playing'){
        ws.send(JSON.stringify({ t:'err', msg:'牌局进行中，等这一局结束后再进' }));
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

/* ========================================================================
   连接探活（v1.2.49）：定时发协议层 ping 保活；「超过 DEAD_AFTER 没有任何入站消息」
   的连接直接断开 → 走正常 onDisconnect（托管 / 释放座位）。解决半开连接永不离线的问题。
   ======================================================================== */
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()){
    for (const c of room.seats){
      if (!c || !c.online) continue;
      if (now - c.lastSeen > DEAD_AFTER){
        log(`房 ${room.no} 座位 ${c.seat}（${c.name}）${Math.round((now - c.lastSeen) / 1000)}s 无任何响应，判定掉线`);
        try{ c.ws.terminate(); }catch(e){}          // 触发 close → onDisconnect（托管 / 释放）
      } else if (c.ws.readyState === 1){
        try{ c.ws.ping(); }catch(e){}
      }
    }
  }
}, PING_EVERY).unref();

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
    // 若正等着这家决策，按「真实剩余时间」重发询问（不是重新给满时限；无限时房间 askLeft=0）
    if (host.pending && host.pending.seat === conn.seat && S_PEND_matches(host, conn.seat)){
      const P = host.S.__state.PEND;
      conn.send({
        t:'ask', kind: P.kind, payload: P.payload,
        deadline: host.askDeadline || 0,
        askLeft: host.askDeadline ? Math.max(0, host.askDeadline - Date.now()) : (host.askMs || 0)
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
  log(`一道来敲麻 v${require('../package.json').version} 服务端已启动: http://0.0.0.0:${PORT}`);
  log('手机浏览器访问上面的地址 → 多人对战 → 创建房间');
  const ai = aibrain.status();
  log(ai.enabled
    ? `AI 机器人：大模型已就绪（快档 ${ai.models.fast}／强档 ${ai.models.strong}；联机托管档位 ${ai.serverTier}）`
    : `AI 机器人：未启用大模型（${ai.reason}）→ 机器人走本地逻辑`);
  // 配了凭据就真打一次，把「通没通」写进启动日志（失败不影响启动，机器人照走本地逻辑）
  if (ai.enabled){
    aibrain.probe(true).then(pr => {
      log(pr.ok
        ? `AI 连通性：✅ 实测调用成功（${pr.ms}ms）`
        : `AI 连通性：❌ ${pr.detail || '未知原因'} → 机器人仍会走本地逻辑，请检查环境变量`);
    }).catch(() => {});
  }
  setInterval(scanRooms, SCAN_INTERVAL).unref();
  setInterval(() => {
    if (rooms.size) log(`房间数：${rooms.size}`);
  }, STATS_INTERVAL).unref();
});
