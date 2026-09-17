/**
 * 服务端「大模型大脑」（v1.3.0）
 *
 * 职责：把机器人的一次决策（出牌 / 碰吃杠）交给 CloudBase 的托管模型，
 * 返回一个**候选答案**。注意边界：
 *   · 这里只负责「问模型 + 解析」，**不负责判断答案是否合法** ——
 *     合法性由引擎侧（decideDiscard / decideClaim）用白名单二次校验，非法即回退本地启发式；
 *   · 拿不到答案（超时 / 报错 / 额度不足 / 未配置）一律返回 { ok:false }，
 *     调用方静默用本地答案，玩家侧零感知。
 *
 * 传输为什么不用 @cloudbase/node-sdk：
 *   官方 HTTP 通道 `POST /v1/ai/{provider}/chat/completions` 与 SDK 打的是同一个网关、
 *   同一套鉴权（Bearer API Key），协议就是 OpenAI Chat Completions。
 *   走原生 fetch 的收益很直接：**零依赖**（Render / WorkBuddy 构建更快更稳）、
 *   代码可离线单测（本文件 tests/m59 用一个本地桩服务验证请求与解析）。
 *   规范来源：https://docs.cloudbase.net/openapi/ai_model.v1.openapi.yaml
 *
 * 环境变量（都不配 = 功能整体关闭，游戏行为与旧版完全一致）：
 *   CLOUDBASE_ENV           CloudBase 环境 ID（必填）
 *   CLOUDBASE_API_KEY       CloudBase API Key（必填；别名 CLOUDBASE_ACCESS_KEY / CLOUDBASE_SECRET）
 *                           ⚠️ 是控制台「环境 → 访问管理 → API Key」里那串很长的 JWT，不是几十字符的短串
 *   AI_BASE                 网关地址覆盖（默认 https://{env}.api.tcloudbasegateway.com）
 *   AI_PROVIDER             模型分组（默认 cloudbase；另有 hunyuan-v3 / 自定义分组）
 *   AI_MODEL_FAST           快档模型（默认 hy3）
 *   AI_MODEL_STRONG         强档模型（默认同 AI_MODEL_FAST）
 *                           ⚠️ 模型名必须是**该环境已在控制台启用**的（环境 → AI 模型）。
 *                           本环境实测可用：hy3 / hy3-preview；未启用的会返回
 *                           403 AI_MODEL_NOT_SUPPORTED。查看当前可用：见 status().models
 *   AI_AUTH                 Authorization 写法：auto（默认，先 Bearer 再裸 key）/ bearer / raw
 *   AI_BOT                  off = 整体停用（默认 on）
 *   AI_BOT_TIER             联机房间托管用哪档：off / fast / strong（默认 strong；
 *                           设 off 可让联机房间退回纯本地逻辑、不消耗额度）
 *   AI_TIMEOUT_MS           单次调用超时（默认 8000）
 *   AI_RPM_PAUSE_MS         撞到配额（429 / EXCEED_*）后的退避基准（默认 5000，逐次翻倍、上限 30s）
 *   AI_RPM_MAX              配额节流：每分钟最多发出多少次模型请求（默认 50）。
 *                           网关硬限 60 请求/分，这里留余量 —— 该 CloudBase 环境
 *                           还与其他应用共用同一份网关配额。设 0 = 关掉节流。
 */
'use strict';

const AI_ENV = {
  env: process.env.CLOUDBASE_ENV || process.env.TCB_ENV || '',
  key: process.env.CLOUDBASE_API_KEY || process.env.CLOUDBASE_ACCESS_KEY || process.env.CLOUDBASE_SECRET || '',
  base: process.env.AI_BASE || '',
  provider: process.env.AI_PROVIDER || process.env.AI_MODEL_GROUP || 'cloudbase',
  fast: process.env.AI_MODEL_FAST || 'hy3',
  strong: process.env.AI_MODEL_STRONG || process.env.AI_MODEL_FAST || 'hy3',
  auth: (function(){
    const a = process.env.AI_AUTH || 'auto';
    return (a === 'bearer' || a === 'raw') ? a : 'auto';
  })(),
  timeoutMs: Number(process.env.AI_TIMEOUT_MS || 8000),
  cacheMax: Number(process.env.AI_CACHE_MAX || 500),
  rpmMax: (function(){
    const n = Number(process.env.AI_RPM_MAX);
    return Number.isFinite(n) && n >= 0 ? n : 50;
  })(),
  rpmWin: 60000,
  rpmPauseMs: Number(process.env.AI_RPM_PAUSE_MS || 5000),   // 撞到配额后的退避基准
  rpmPauseMax: 30000,                                        // 退避上限
  on: (process.env.AI_BOT || 'on') !== 'off',
  serverTier: (function(){
    // 默认 strong：只要配了环境变量，联机房间的机器人也默认走大模型（与单机「默认启用」一致）；
    // 想省额度 / 想退回旧行为，设 AI_BOT_TIER=off 即可。
    const t = process.env.AI_BOT_TIER || 'strong';
    return (t === 'fast' || t === 'strong') ? t : 'off';
  })()
};

function apiBase(){
  if (AI_ENV.base) return AI_ENV.base.replace(/\/+$/, '');
  const suffix = (process.env.AI_BASE_REGION === 'intl') ? '.api.intl.tcloudbasegateway.com' : '.api.tcloudbasegateway.com';
  return 'https://' + AI_ENV.env + suffix;
}

/* ========================================================================
   提示词：系统段逐字不变（命中模型侧上下文缓存，价格便宜 50 倍且更快）
   ======================================================================== */
const RULES_BASE = [
  '你是「上海敲麻」的麻将牌手。目标：尽快胡牌，同时尽量少放炮。',
  '牌名写法：万＝一萬~九萬，筒＝一筒~九筒，条＝一條~九條，字牌＝東 南 西 北 中 發 白。',
  '花牌（春 夏 秋 冬 梅 蘭 竹 菊）不上手：摸到会自动补花，你的手牌里不会出现花牌。',
  '玩法二选一，view.mode 会告诉你：',
  '  · 敲麻：4 组顺子/刻子 + 1 对将即可胡（普通牌型也行）；中發白算花、不能当牌用；听牌要「敲定」后才算胡。',
  '  · 清混碰：免敲，但只能做碰碰胡（4 刻子 + 1 对将）、混一色（一门数牌 + 字牌）、清一色、风一色（全字牌）；中發白算牌不算花，可碰可杠可成将。',
  '七小对：只有 view.sevenPairs 为 true 时 7 个对子才算胡；为 false 时，只有全字牌的七对形态（属风一色）算胡。',
  '清混碰锁门（view.lock）：吃过某一门数牌后，本局只能再收「该门 + 字牌」；碰 / 杠过数牌后彻底不能再吃。锁门后不要再留其他花色。',
  '无花果：0 花（无花牌、无字牌明碰/暗刻、无杠）的牌型不能靠点炮胡，只能自摸。view.wuGuoHua 为 true 表示你现在是 0 花牌型，走这条路就别指望别人点炮。',
  '番值（越大越该搏，view.cur 是你当前的底 / 番）：',
  '  · 敲麻：普通胡 0 番；碰碰胡 / 混一色 / 混碰 1 番；清一色 2 勒子；风一色 4 勒子；风碰 8 勒子。',
  '  · 清混碰：碰碰胡 / 混一色 / 混碰 1 番；清一色 1 勒子；风一色 2 勒子；风碰 4 勒子。',
  '  · 勒子档的底固定 10 花、远大于普通番；无花果 / 大吊车 也按勒子算，门清 / 杠上开花 / 海底捞月 各 +1 番。',
  '硬约束：只能从题目给出的合法选项里选，不要发明题目里没有的牌。',
  '输出必须是单个 JSON 对象，不要 markdown 代码块，不要多余文字。'
].join('\n');

const SYS_DISCARD = RULES_BASE + '\n\n' +
  '【本回合任务】打出一张牌。\n' +
  'view.hand 是你的手牌，view.legal 是本次允许打出的牌（已经排除刚吃/碰进来、规则禁止立刻打出的牌），' +
  'view.table 是四家的牌河与公开副露（索引 0~3 对应座位，view.seat 是你自己）。\n' +
  '参考要点：优先打孤张、留搭子；向听数越接近胡牌越好；牌河里已现多张的牌相对安全；' +
  '别人副露多或已听牌时少打生张。\n' +
  '严格输出：{"discard":"<牌名>","reason":"<不超过 20 字的理由>"}';

const SYS_CLAIM = RULES_BASE + '\n\n' +
  '【本回合任务】别人打出 view.claimTile 后，你要决定碰 / 吃 / 杠 / 过。\n' +
  'view.options 是本次真正可选的选项（可能是 pung=碰、kong=杠、chow=吃；没有 hu 时不必考虑胡）。\n' +
  '参考要点：能明显降低向听数、或朝你的做牌方向（一色/碰碰胡）前进就动牌；' +
  '副露会亮牌、变牌路，收益不明显时宁可「过」；吃牌只有下家能选。\n' +
  '严格输出：{"action":"碰|吃|杠|过","reason":"<不超过 20 字的理由>"}';

/* 强档专用：把「算牌」留给确定性引擎（它不会算错牌理），模型只做「定夺」——
   引擎先按向听/危险度排出 top-K 候选，模型在候选里挑一张。
   好处有三：① 大模型不会因为算错向听而乱打；② prompt 更短、token 更省；
   ③ 模型的强项（读牌河、判断谁在做牌、谁可能听牌）正好用在取舍上。 */
const SYS_DISCARD_STRONG = RULES_BASE + '\n\n' +
  '【本回合任务】打出一张牌。程序已经按牌理算好 view.candidates —— 本次值得考虑的几张候选。\n' +
  '你的任务是在这些候选里**定夺一张**，不要自己另找牌：\n' +
  '  · 每项含 tile（牌名）、shanten（打掉它之后你的向听数，越小越接近胡）、danger（危险度，越大越可能放炮）、' +
  'left（打掉它之后你若听牌，听口在台面上还看得见的张数；null 表示打掉还没听）。\n' +
  '  · 取舍原则：先看 shanten——更小者优；同为听牌（shanten 为 0）时 left 越大越容易胡，' +
  'left 为 0 是听死牌（程序已按没听处理，别选它）；再看 danger 更低者。\n' +
  '  · 结合 view.table（四家牌河与公开副露）判断谁在做牌、哪些牌已经打出过多张（现物更安全）。\n' +
  '只能从 view.candidates 里选，选候选以外的牌一律无效。\n' +
  '严格输出：{"discard":"<候选里的牌名>","reason":"<不超过 20 字的理由>"}';

/* ========================================================================
   HTTP 传输（原生 fetch，零依赖）
   ======================================================================== */
function buildMessages(kind, view){
  /* 出牌有两套 system：模型自由选（快档）／在引擎给好的候选里定夺（强档）。
     两套都是**逐字固定**的常量，各自命中自己的上下文缓存。 */
  const hasCand = !!(view && Array.isArray(view.candidates) && view.candidates.length);
  const sys = kind === 'claim' ? SYS_CLAIM : (hasCand ? SYS_DISCARD_STRONG : SYS_DISCARD);
  return [
    { role: 'system', content: sys },
    { role: 'user', content: JSON.stringify(view) }
  ];
}
/* 从模型输出里抠出决策：容忍 ```json 围栏、前后废话、多余空白 */
function parseDecision(text){
  if (text == null) return null;
  let s = String(text).replace(/```[a-zA-Z]*/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o;
  try { o = JSON.parse(s.slice(a, b + 1)); } catch (e){ return null; }
  if (!o || typeof o !== 'object') return null;
  const reason = (o.reason == null ? '' : String(o.reason).replace(/\s+/g, ' ')).slice(0, 40);
  if (o.discard != null && String(o.discard).trim()) return { discard: String(o.discard).trim(), reason };
  if (o.action != null && String(o.action).trim()) return { action: String(o.action).trim(), reason };
  return null;
}

/* 网关错误码 → 给人看的解释（用于 /api/ai/status 与日志） */
const ERR_CN = {
  INVALID_CREDENTIALS: 'API Key 无效（检查是不是控制台里那串完整的长 JWT）',
  MISSING_CREDENTIALS: '请求未带鉴权信息',
  PERMISSION_DENIED: 'API Key 没有调用权限',
  AI_MODEL_NOT_FOUND: '模型分组不存在（AI_PROVIDER 写错？）',
  AI_MODEL_NOT_SUPPORTED: '该模型未在此环境启用（控制台 → AI 模型 里勾选）',
  AI_MODEL_DISABLED: '模型已被禁用',
  AI_MODEL_CONFIG_MISSING: '环境缺少模型 API Key 或配置',
  AI_MODEL_PARAM_INVALID: '请求参数无效',
  AI_MODEL_PARAM_REQUIRED: '缺少 model 参数',
  EXCEED_TOKEN_QUOTA_LIMIT: '模型额度已用尽（需购买资源包）',
  EXCEED_CONCURRENT_REQUEST_LIMIT: '并发超限，稍后重试',
  EXCEED_REQUEST_LIMIT: '请求次数超限'
};
function explainCode(code, message){
  return ERR_CN[code] || (code ? (code + (message ? '：' + message : '')) : '');
}
/* 鉴权类错误码：这些才值得「换一种 Authorization 写法再试一次」 */
const AUTH_CODES = new Set([
  'INVALID_CREDENTIALS', 'MISSING_CREDENTIALS', 'INVALID_ACCESS_TOKEN',
  'ACCESS_TOKEN_INVALID', 'ACCESS_TOKEN_KID_INVALID', 'ACCESS_TOKEN_EXPIRED',
  'TOKEN_EXPIRED', 'UNAUTHORIZED', 'PERMISSION_DENIED'
]);

class AiErr extends Error {
  constructor(kind, code, message){ super(message || code || kind); this.kind = kind; this.code = code || ''; }
}

async function postJson(url, body, authValue, timeoutMs){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': authValue
      },
      body,
      signal: ctl.signal
    });
    const text = await res.text();
    return { status: res.status, text: text || '' };
  } finally {
    clearTimeout(timer);
  }
}

function authValueFor(style){
  return style === 'raw' ? AI_ENV.key : ('Bearer ' + AI_ENV.key);
}

/* 一次真实调用：返回 { text, usage }；失败抛 AiErr（kind 供上层分类） */
async function callModel(kind, model, view){
  if (!AI_ENV.key) throw new AiErr('config', '', '缺少 API Key');
  const url = apiBase() + '/v1/ai/' + encodeURIComponent(AI_ENV.provider) + '/chat/completions';
  const body = JSON.stringify({
    model,
    messages: buildMessages(kind, view),
    temperature: 0.5,
    max_tokens: 80
  });

  const styles = AI_ENV.auth === 'auto' ? ['bearer', 'raw'] : [AI_ENV.auth];
  let last = null;
  for (let i = 0; i < styles.length; i++){
    let r;
    try {
      r = await postJson(url, body, authValueFor(styles[i]), AI_ENV.timeoutMs);
    } catch (e){
      const aborted = (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR'));
      throw new AiErr(aborted ? 'timeout' : 'network', '', aborted ? ('超时 ' + AI_ENV.timeoutMs + 'ms') : String((e && e.message) || e));
    }
    let j = null;
    try { j = JSON.parse(r.text); } catch (e){ j = null; }

    /* 错误分诊（顺序很重要，两个方向都踩过坑）：
       · 网关的 401 响应体里**也带 code** —— 若先判 code，鉴权失败会被当成业务错误，
         「换一种 Authorization 写法重试」的分支永远走不到（旧 bug）。
       · 但 403 也可能带**非鉴权**的业务码（如 AI_MODEL_NOT_SUPPORTED）—— 若把 403 一律当鉴权失败，
         就会把「模型没启用」误报成「API Key 无效」，还会白白触发熔断（新 bug）。
       所以：先看 code 是不是鉴权类，是鉴权类 / 无 code 的 401/403 才走重试，其余按业务错误抛。 */
    const code = (j && j.code) || '';
    const authish = !!code && AUTH_CODES.has(code);
    if (code && !authish) throw new AiErr('api', code, explainCode(code, j.message));
    if (r.status === 401 || r.status === 403 || authish){
      const why = explainCode(code, (j && j.message) || '');
      last = new AiErr('auth', code || ('HTTP_' + r.status), why || r.text.slice(0, 160));
      if (i + 1 < styles.length) continue;           // 换另一种 Authorization 写法再试一次
      throw last;
    }
    if (r.status < 200 || r.status >= 300) throw new AiErr('http', 'HTTP_' + r.status, r.text.slice(0, 160));
    if (!j) throw new AiErr('parse', '', '网关返回的不是 JSON：' + r.text.slice(0, 120));

    const ch = j.choices && j.choices[0];
    const text = ch && ch.message && (ch.message.content == null ? '' : ch.message.content);
    if (text == null) throw new AiErr('parse', '', '响应里没有 choices[0].message.content');
    return { text: String(text), usage: j.usage || null };
  }
  throw last || new AiErr('auth', '', '鉴权失败');
}

/* ========================================================================
   队列 / 缓存 / 熔断
   ======================================================================== */
const _cache = new Map();
let _chain = Promise.resolve();
let _failStreak = 0, _openUntil = 0;
let _lastErr = null;                 // 最近一次失败（status 里展示，便于线上排查）

/* 串行队列：云开发并发额度与套餐档位相关，串行能显著降低 429 概率 */
function enqueue(fn){
  const p = _chain.then(fn, fn);
  _chain = p.then(() => {}, () => {});
  return p;
}
function hash(s){
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(36);
}
function breakerOpen(){
  if (!_openUntil) return false;
  if (Date.now() >= _openUntil){ _openUntil = 0; _failStreak = 0; return false; }
  return true;
}

/* 配额守卫（v1.3.5）：网关对模型限 60 请求/分钟，撞上会返 429；
   而 429 与网络故障一样被算作「失败」，连败 3 次就开 30 秒熔断 ——
   玩家看到的现象就是「打着打着 AI 掉了、变回快速出牌的机器人」。
   与其撞上去再回退，不如自己先按配额排队：窗口内超过额度就**直接本地回退**
   （不发请求、不计失败、不动熔断），配额一松就自动用回来。
   用滑动窗口而非固定窗口：额度按时间均匀释放，饱和后会变成稳定的匀速放行，
   而不是「每分钟开头一波、之后全哑」那种忽有忽无的手感。 */
const _rpm = { at: [], skipped: 0, strikes: 0, pauseUntil: 0 };
function rpmUsed(now){
  const t0 = now - AI_ENV.rpmWin;
  while (_rpm.at.length && _rpm.at[0] <= t0) _rpm.at.shift();
  return _rpm.at.length;
}
/* 配额类失败：网关 429 / EXCEED_*。它说明「额度被占满了」，不是「模型坏了」——
   这个环境的 60 次/分是与其他应用共享的，我们自己排队也拦不住别人占满，
   所以必须把「撞上配额」和「真故障」区别对待（见 decide() 的 catch）。*/
const QUOTA_CODES = new Set(['EXCEED_TOKEN_QUOTA_LIMIT', 'EXCEED_CONCURRENT_REQUEST_LIMIT',
  'EXCEED_REQUEST_LIMIT', 'HTTP_429']);
function quotaErr(kind, code){
  return QUOTA_CODES.has(code) || (kind === 'http' && code === 'HTTP_429');
}
function rpmBlocked(now){
  if (_rpm.pauseUntil && now < _rpm.pauseUntil) return true;   // 退避中（与是否限速无关）
  if (!AI_ENV.rpmMax) return false;                            // 0 = 不限速
  return rpmUsed(now) >= AI_ENV.rpmMax;
}

/* ========================================================================
   可用性 / 状态
   ======================================================================== */
function isEnabled(){
  if (!AI_ENV.on) return false;
  if (!AI_ENV.env) return false;
  return !!AI_ENV.key;
}
function disabledReason(){
  if (!AI_ENV.on) return '已用 AI_BOT=off 停用';
  if (!AI_ENV.env) return '缺少 CLOUDBASE_ENV（CloudBase 环境 ID）';
  if (!AI_ENV.key) return '缺少 CLOUDBASE_API_KEY（CloudBase API Key）';
  return '';
}
function modelFor(tier){ return tier === 'strong' ? AI_ENV.strong : AI_ENV.fast; }
function status(){
  return {
    enabled: isEnabled(),
    reason: isEnabled() ? '' : disabledReason(),
    serverTier: AI_ENV.serverTier,
    provider: AI_ENV.provider,
    group: AI_ENV.provider,
    models: { fast: AI_ENV.fast, strong: AI_ENV.strong },
    timeoutMs: AI_ENV.timeoutMs,
    cache: _cache.size,
    failStreak: _failStreak,
    // 配额水位：used = 当前窗口内已发出的请求数，skipped = 累计因节流回退本地的次数
    rpm: { max: AI_ENV.rpmMax, winMs: AI_ENV.rpmWin, used: rpmUsed(Date.now()), skipped: _rpm.skipped,
           strikes: _rpm.strikes, pauseLeftMs: Math.max(0, _rpm.pauseUntil - Date.now()) },
    lastError: _lastErr,
    envHint: AI_ENV.env ? AI_ENV.env.slice(0, 8) + '…' : '',
    keyLen: AI_ENV.key ? AI_ENV.key.length : 0          // 只报长度，绝不回显密钥
  };
}

/* 真连通性探针：给 /api/ai/status 用（用户点开设置就能看到到底通没通） */
let _probe = { at: 0, ok: false, ms: 0, detail: '' };
async function probe(force){
  const now = Date.now();
  if (!force && _probe.at && now - _probe.at < 60000) return Object.assign({ cached: true }, _probe);
  const t0 = Date.now();
  try {
    await callModel('discard', AI_ENV.fast, {
      mode: '敲麻', seat: 0, hand: ['一萬'], legal: ['一萬'], banned: [], table: [], wallLeft: 1
    });
    _probe = { at: now, ok: true, ms: Date.now() - t0, detail: '' };
  } catch (e){
    _probe = { at: now, ok: false, ms: Date.now() - t0, detail: String((e && e.message) || e).slice(0, 200), kind: (e && e.kind) || 'error' };
  }
  return _probe;
}

/* ========================================================================
   主入口
   ======================================================================== */
async function decide(req){
  const t0 = Date.now();
  if (!isEnabled()) return { ok: false, error: 'disabled', detail: disabledReason() };
  const kind = req && req.kind;
  const view = req && req.view;
  if ((kind !== 'discard' && kind !== 'claim') || !view || typeof view !== 'object')
    return { ok: false, error: 'bad_request' };

  const tier = req.tier === 'strong' ? 'strong' : 'fast';
  const model = modelFor(tier);
  const key = hash(kind + '|' + tier + '|' + JSON.stringify(view));
  const hit = _cache.get(key);
  if (hit) return Object.assign({ ok: true, cached: true, ms: 0 }, hit);
  if (breakerOpen()) return { ok: false, error: 'breaker' };
  /* v1.3.5：配额内节流。先扣名额再发请求，并发决策也不会超卖；
     被节流时立即回退（调用方用本地答案），不计失败、不动熔断，配额恢复即自动用回来。 */
  const nowMs = Date.now();
  if (rpmBlocked(nowMs)){ _rpm.skipped++; return { ok: false, error: 'throttled' }; }
  _rpm.at.push(nowMs);

  let out;
  try {
    out = await enqueue(() => callModel(kind, model, view));
  } catch (e){
    const ek = (e && e.kind) || 'error', ec = (e && e.code) || '';
    _lastErr = { at: Date.now(), kind: ek, code: ec, detail: String((e && e.message) || e).slice(0, 160) };
    /* v1.3.5：配额类失败**不算故障**。若照旧计入 3 连败熔断，
       「网关偶尔被占满」就会被放大成「AI 整个掉线 30 秒」，正是玩家报的那个现象。
       改成短退避：暂停一会儿自动重试，退避逐次翻倍、上限 30 秒，一旦成功立即清零。
       真正的故障（网络 / 鉴权 / 解析）仍走原来的 3 连败熔断。 */
    if (quotaErr(ek, ec)){
      _rpm.strikes++;
      const wait = Math.min(AI_ENV.rpmPauseMax, AI_ENV.rpmPauseMs * Math.pow(2, _rpm.strikes - 1));
      _rpm.pauseUntil = Date.now() + wait;
      return { ok: false, error: 'quota', detail: _lastErr.detail, retryInMs: wait };
    }
    _failStreak++;
    if (_failStreak >= 3){ _openUntil = Date.now() + 30000; }
    return { ok: false, error: ek, detail: _lastErr.detail };
  }

  const parsed = parseDecision(out && out.text);
  if (!parsed){
    _failStreak++;
    _lastErr = { at: Date.now(), kind: 'parse', code: '', detail: String((out && out.text) || '').slice(0, 120) };
    return { ok: false, error: 'parse', detail: _lastErr.detail };
  }

  _failStreak = 0;
  _lastErr = null;
  _rpm.strikes = 0; _rpm.pauseUntil = 0;             // 配额恢复了，清掉退避
  const res = Object.assign({ tier, model, ms: Date.now() - t0, usage: (out && out.usage) || null }, parsed);
  if (_cache.size >= AI_ENV.cacheMax) _cache.clear();
  _cache.set(key, res);
  return Object.assign({ ok: true }, res);
}

module.exports = {
  decide,
  status,
  probe,
  isEnabled,
  disabledReason,
  modelFor,
  buildMessages,
  parseDecision,
  explainCode,
  apiBase,
  _env: AI_ENV,
  _reset(){
    _cache.clear(); _failStreak = 0; _openUntil = 0; _chain = Promise.resolve();
    _rpm.at.length = 0; _rpm.skipped = 0; _rpm.strikes = 0; _rpm.pauseUntil = 0;
    _lastErr = null; _probe = { at: 0, ok: false, ms: 0, detail: '' };
  }
};
