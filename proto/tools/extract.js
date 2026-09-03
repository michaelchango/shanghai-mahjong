#!/usr/bin/env node
/**
 * 从 index.html 抽取规则引擎 → server/engine.js
 *
 * 设计原则：**规则只有一份**。
 * 服务端永远从 index.html 生成 engine.js，禁止手改 engine.js，
 * 避免「单机一套规则、联机一套规则」这类最致命的漂移。
 *
 * 用法：node proto/tools/extract.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'proto/server/engine.js');

// 切分点：这一段之后是「事件绑定 + NET 联机模块 + 启动代码」，属于浏览器专属，服务端不要
const CUT = "/* ========================================================================\n   多人联机（NET）";

// 服务端适配补丁：机械、可审查、每次抽取自动应用。
// 每条 patch 的 old 必须在引擎里恰好出现一次（否则报错拒绝生成），
// 全部向后兼容——不设置服务端钩子时，单机行为与 1.0 完全一致。
const PATCHES = [
  {
    why: 'ask() 增加可选 seat 参数 + onAsk 钩子：服务端据此知道「该等哪个座位的真人回包」；单机不定义 onAsk、seat 缺省 0，行为不变',
    old: `function ask(kind, payload){
  return new Promise(res => { PEND = { kind, payload, res }; render(); });
}`,
    neo: `function ask(kind, payload, seat){
  return new Promise(res => { PEND = { kind, payload, res, seat: seat == null ? 0 : seat }; if (typeof onAsk === 'function') onAsk(PEND); render(); });
}`
  },
  {
    why: 'knockCheck：敲牌询问带上座位',
    old: `  const r = await ask('knock', { waits });`,
    neo: `  const r = await ask('knock', { waits }, p.idx);`
  },
  {
    why: 'doKnock 支持任意座位（1.0 写死 seat0「你」）；座位为空时保持单机行为',
    old: `function doKnock(waits){
  const p = G.players[0];
  p.knocked = true;
  p.knockWaits = waits.map(w => w.t);
  p.noPromptSig = '';
  toast('敲！已锁定听牌', 'gold', 0);
  logMsg('你敲了');
  render();
}`,
    neo: `function doKnock(waits, seat){
  const p = G.players[seat == null ? 0 : seat];
  p.knocked = true;
  p.knockWaits = waits.map(w => w.t);
  p.noPromptSig = '';
  toast('敲！已锁定听牌', 'gold', seat == null ? 0 : seat);
  logMsg((seat == null ? '你' : p.name) + ' 敲了');
  render();
}`
  },
  {
    why: 'knockCheck：敲定调用带上座位',
    old: `  if (r === 'knock') doKnock(waits);`,
    neo: `  if (r === 'knock') doKnock(waits, p.idx);`
  },
  {
    why: 'discardTurn：出牌询问带上座位',
    old: `    d = await ask('discard');`,
    neo: `    d = await ask('discard', null, p.idx);`
  },
  {
    why: 'runHand 支持 G.abort 中途作废（玩家在局中点「返回首页」时，旧循环安静退出、不打流局结算；单机正常对局 G.abort 恒为假，行为不变）',
    old: `async function runHand(){
  G.running = true;`,
    neo: `async function runHand(){
  G.running = true; G.abort = false;`
  },
  {
    why: '主循环响应 G.abort',
    old: `  while (!result && G.running){`,
    neo: `  while (!result && G.running && !G.abort){`
  },
  {
    why: '被中止的局不进入结算',
    old: `  await finish(result || { type: 'liuju' });
}`,
    neo: `  if (G.abort) return;   // 中途返回首页：本局作废，不结算
  await finish(result || { type: 'liuju' });
}`
  }
];

// 服务端需要用到的符号（缺失的会被自动跳过，不会因为改名就崩）
const EXPORTS = [
  // 配置与状态
  'CFG', 'G', 'PEND', 'SEL', 'SELIDX', 'HUANG_FAN_MAX',
  'WIND_NAME', 'SEAT_WIND', 'BOT_NAMES',
  // 牌与工具
  'isFlower', 'isSeason', 'sortTiles', 'tileName', 'flowerChar',
  'toCounts', 'countsToTiles', 'shuffle', 'removeTiles',
  // 规则判定（核心）
  'evalAll', 'shantenStd', 'shantenPung', 'shantenColor', 'shantenWindOnly',
  'isWinShape', 'isPungShape', 'isSevenPairs', 'formSets', 'formPungs',
  'evaluateShape', 'typeLabel', 'typeBaseFan',
  'calcFlowers', 'extraFan', 'tryWin', 'canKnock', 'getWaits', 'getWaitsHand',
  'claimOptions', 'selfKongOptions', 'potentialKnocks', 'capValue',
  'playerDiFan', 'scoreOf',
  // 牌局流程
  'mkPlayer', 'initGame', 'buildWall', 'drawFront', 'drawTail', 'wallLeft',
  'seenCount', 'deal', 'runHand', 'knockCheck', 'doKnock', 'discardTurn',
  'collectClaims', 'applySelfKong', 'finish', 'finishHand', 'nextHand',
  'newRound', 'render',
  // 玩家输入/AI
  'ask', 'resolvePend',
  'aiTargetOf', 'aiChooseDiscard', 'aiClaim', 'dangerScore',
  // 杂项
  'sleep', 'waitBot', 'logMsg', 'windOf'
];

function main(){
  const html = fs.readFileSync(SRC, 'utf8');
  const a = html.indexOf('<script>');
  const b = html.lastIndexOf('</script>');
  if (a < 0 || b < 0) throw new Error('index.html 里找不到 <script> 块');

  const js = html.slice(a + '<script>'.length, b);
  const cut = js.indexOf(CUT);
  if (cut < 0) throw new Error('切分点失效：找不到 ' + JSON.stringify(CUT));

  let engine = js.slice(0, cut);

  // 自检：关键函数必须在切出来的部分里
  for (const must of ['function runHand', 'function evalAll', 'function ask', 'function claimOptions']){
    if (!engine.includes(must)) throw new Error('切出的引擎缺少 ' + must);
  }

  // 应用服务端适配补丁（old 必须恰好出现一次，否则拒绝生成）
  for (const p of PATCHES){
    const n = engine.split(p.old).length - 1;
    if (n !== 1){
      throw new Error('patch 「' + p.why.slice(0, 30) + '…」的 old 片段出现 ' + n + ' 次（应为 1），引擎源码可能已变化，请人工核对');
    }
    engine = engine.replace(p.old, p.neo);
    console.log('   patch ✔ ' + p.why.slice(0, 40) + '…');
  }

  const banner = [
    '/* =====================================================================',
    ' * engine.js —— 自动生成，请勿手改',
    ' *',
    ' * 来源：index.html 的规则引擎部分（<script> 块中事件绑定之前的内容）',
    ' * 生成：node proto/tools/extract.js',
    ' * 生成时间：' + new Date().toISOString(),
    ' *',
    ' * 这是服务端权威架构的地基：规则逻辑与前端共用同一份源码，',
    ' * 由脚本从 index.html 抽出，保证「单机/联机规则永远不会不一致」。',
    ' * ===================================================================== */',
    ''
  ].join('\n');

  const tail = [
    '',
    '/* ---------------- 导出（缺失符号自动跳过） ---------------- */',
    'module.exports = (function(){',
    '  const out = {};',
    '  const names = ' + JSON.stringify(EXPORTS) + ';',
    '  for (const n of names){ try { out[n] = eval(n); } catch(e){} }',
    '  return out;',
    '})();',
    ''
  ].join('\n');

  fs.writeFileSync(OUT, banner + engine + tail, 'utf8');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  const lines = engine.split('\n').length;
  let missing = 0;
  for (const n of EXPORTS) if (!new RegExp('(function|const|let|var)\\s+' + n + '\\b').test(engine)) missing++;
  console.log('✅ 已生成 ' + path.relative(ROOT, OUT) + '  (' + kb + ' KB / ' + lines + ' 行)');
  console.log('   导出符号 ' + (EXPORTS.length - missing) + '/' + EXPORTS.length + ' 个' + (missing ? '（' + missing + ' 个未找到，已自动跳过）' : ''));
}

main();
