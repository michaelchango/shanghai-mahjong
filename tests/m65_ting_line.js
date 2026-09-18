/* m65：v1.3.10 底部听牌行（renderTingLine）—— 出牌态「可听 X(n)」/ 等牌态「听牌中 → X(n)」
   需求来源：
     1) 轮到我出牌时，只要存在能听的打法，底部就显示「可听 X(n)」——不管手里几张牌；
     2) 出完牌后只要在听牌，底部就显示「听牌中 → X(n)」——n=0（听死）也要显示；
     3) 文案与语义，敲麻 / 清混碰 统一。
   做法：用真实引擎（proto/server/engine.js）+ DOM 替身，直接断言 #tingLine 的 innerHTML。
   注：leftFor 把「自己手里还留着的牌」也算作已见，所以 n 会比直觉小。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const { makeDocument } = require(path.join(ROOT, 'proto', 'server', 'headless.js'));

let src = fs.readFileSync(path.join(ROOT, 'proto', 'server', 'engine.js'), 'utf8');
const tailAt = src.indexOf('/* ---------------- 导出');
if (tailAt > 0) src = src.slice(0, tailAt);

const doc = makeDocument();
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
  Promise, JSON, Date, Object, Array, String, Number, Boolean, Error, Math,
  document: doc, navigator: { userAgent: 'node' },
  location: { href: '', search: '', hash: '' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
  requestAnimationFrame: cb => setTimeout(() => cb(0), 0),
  performance: { now: () => Date.now() }
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
sandbox.NET = { active: false, autoKnock: false };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'engine.js' });
vm.runInContext(`globalThis.__state = {
  get G(){ return G; }, get CFG(){ return CFG; },
  get PEND(){ return PEND; }, set PEND(v){ PEND = v; }
};`, sandbox);

const S = sandbox.__state;
const T = n => sandbox.tileFromName(n);
const pung = n => { const t = T(n); return { type: 'pung', tile: t, tiles: [t, t, t] }; };

let pass = 0, fail = 0;
function mkPlayer(hand, melds, o) {
  return Object.assign({ hand: hand || [], melds: melds || [], discards: [], flowers: [],
    knocked: false, knockWaits: [], isBot: false, name: 'P' }, o || {});
}
function run(label, { lajiHu, players, pend, expectInner, expectCls, expectBlank }) {
  S.CFG.lajiHu = lajiHu;
  S.G.running = true; S.G.finished = false; S.G.dealer = 0;
  S.G.players = players;
  S.PEND = pend || null;
  sandbox.renderTingLine();
  const el = doc.getElementById('tingLine');
  const html = el.innerHTML || '';
  const cls = el.className || '';
  let ok;
  if (expectBlank) ok = (html === '' && cls === 'tingline');
  else ok = (html === expectInner) && (cls === (expectCls || 'tingline show'));
  console.log((ok ? '  PASS ' : '  FAIL ') + label);
  if (!ok) console.log('       want[' + (expectBlank ? '(blank)' : expectInner) + ' | ' + (expectCls || 'tingline show') +
                        ']\n       got [' + html + ' | ' + cls + ']');
  ok ? pass++ : fail++;
}

const melds2 = [pung('發'), pung('三條')];
const melds4 = [pung('發'), pung('三條'), pung('五筒'), pung('七萬')];
const four = t => [t, t, t, t];

console.log('== 1) 清混碰（免敲） ==');
// 出牌态：打 6條 听 7條（活张 4）
run('出牌态 有听 → 可听 七條(4)', {
  lajiHu: false,
  players: [mkPlayer([T('一條'),T('一條'),T('四條'),T('五條'),T('六條'),T('六條'),T('八條'),T('九條')], melds2),
            mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: { kind: 'discard' },
  expectInner: '可听 <span class="w">七條(4)</span>'
});
// 出牌态 听死：7條 四张全在台面 → n=0 也要显示、标红
run('出牌态 听死 → 可听 七條(0·已绝) 红', {
  lajiHu: false,
  players: [mkPlayer([T('一條'),T('一條'),T('四條'),T('五條'),T('六條'),T('六條'),T('八條'),T('九條')], melds2),
            mkPlayer([], [], { discards: four(T('七條')) }), mkPlayer([]), mkPlayer([])],
  pend: { kind: 'discard' },
  expectInner: '可听 <span class="w dead">七條(0·已绝)</span>'
});
// 出牌态 大吊车（4 副露 + 对子）：打一张单钓
run('出牌态 大吊车单钓 → 可听 九條(2)', {
  lajiHu: false,
  players: [mkPlayer([T('九條'), T('九條')], melds4), mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: { kind: 'discard' },
  expectInner: '可听 <span class="w">九條(2)</span>'
});
// 出牌态 多听口
run('出牌态 多听口 → 可听 三筒(3) 六筒(3)', {
  lajiHu: false,
  players: [mkPlayer([T('三筒'), T('六筒')], melds4), mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: { kind: 'discard' },
  expectInner: '可听 <span class="w">三筒(3)</span> <span class="w">六筒(3)</span>'
});
// 出牌态 无论如何都成不了听 → 空白
run('出牌态 无听 → 空白', {
  lajiHu: false,
  players: [mkPlayer([T('一萬'),T('四萬'),T('七萬'),T('二筒'),T('五筒'),T('八筒'),T('三條'),T('六條')], melds2),
            mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: { kind: 'discard' },
  expectBlank: true
});
// 等牌态（出完牌）：形状已听 → 听牌中
run('等牌态 在听 → 听牌中 → 七條(4)', {
  lajiHu: false,
  players: [mkPlayer([T('一條'),T('一條'),T('四條'),T('五條'),T('六條'),T('八條'),T('九條')], melds2),
            mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: null,
  expectInner: '听牌中 → <span class="w">七條(4)</span>'
});
// 等牌态 听死（n=0）→ 也要显示「听牌中 →」
run('等牌态 听死 → 听牌中 → 七條(0·已绝) 红', {
  lajiHu: false,
  players: [mkPlayer([T('一條'),T('一條'),T('四條'),T('五條'),T('六條'),T('八條'),T('九條')], melds2),
            mkPlayer([], [], { discards: four(T('七條')) }), mkPlayer([]), mkPlayer([])],
  pend: null,
  expectInner: '听牌中 → <span class="w dead">七條(0·已绝)</span>'
});
// 等牌态 大吊车（4 副露 + 单张）
run('等牌态 大吊车单钓 → 听牌中 → 九條(3)', {
  lajiHu: false,
  players: [mkPlayer([T('九條')], melds4), mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: null,
  expectInner: '听牌中 → <span class="w">九條(3)</span>'
});
// 等牌态 未听 → 空白
run('等牌态 未听 → 空白', {
  lajiHu: false,
  players: [mkPlayer([T('一萬'),T('四萬'),T('七萬'),T('二筒'),T('五筒'),T('八筒'),T('三條')], melds2),
            mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: null,
  expectBlank: true
});
// 托管（autoKnock）时不打扰：出牌态不显示「可听」
sandbox.NET.autoKnock = true;
run('托管 出牌态 → 空白', {
  lajiHu: false,
  players: [mkPlayer([T('一條'),T('一條'),T('四條'),T('五條'),T('六條'),T('六條'),T('八條'),T('九條')], melds2),
            mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: { kind: 'discard' },
  expectBlank: true
});
sandbox.NET.autoKnock = false;

console.log('== 2) 敲麻（同文案同口径） ==');
run('出牌态 未敲 可敲听 → 可听 七條(4)', {
  lajiHu: true,
  players: [mkPlayer([T('一條'),T('一條'),T('四條'),T('五條'),T('六條'),T('六條'),T('八條'),T('九條')], melds2),
            mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: { kind: 'discard' },
  expectInner: '可听 <span class="w">七條(4)</span>'
});
run('出牌态 已敲 → 听牌中 → 七條(4)', {
  lajiHu: true,
  players: [mkPlayer([T('一條'),T('一條'),T('四條'),T('五條'),T('六條'),T('八條'),T('九條')], melds2,
                     { knocked: true, knockWaits: [T('七條')] }),
            mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: { kind: 'discard' },
  expectInner: '听牌中 → <span class="w">七條(4)</span>'
});
run('等牌态 已敲 → 听牌中 → 七條(4)', {
  lajiHu: true,
  players: [mkPlayer([T('一條'),T('一條'),T('四條'),T('五條'),T('六條'),T('八條'),T('九條')], melds2,
                     { knocked: true, knockWaits: [T('七條')] }),
            mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: null,
  expectInner: '听牌中 → <span class="w">七條(4)</span>'
});
run('等牌态 未敲 → 空白（未敲不算听）', {
  lajiHu: true,
  players: [mkPlayer([T('一條'),T('一條'),T('四條'),T('五條'),T('六條'),T('八條'),T('九條')], melds2),
            mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: null,
  expectBlank: true
});

console.log('== 3) 顶部标签 knockTag（与底部同判据 tingState） ==');
function runTop(label, { lajiHu, players, pend, expectTag, expectTagCls }) {
  S.CFG.lajiHu = lajiHu;
  S.G.running = true; S.G.finished = false; S.G.dealer = 0;
  S.G.players = players;
  S.PEND = pend || null;
  sandbox.renderHUD();
  const el = doc.getElementById('knockTag');
  const txt = el.textContent || '';
  const cls = el.className || '';
  const hit = (expectTag instanceof RegExp) ? expectTag.test(txt) : (txt === expectTag);
  const ok = hit && (cls === (expectTagCls || 'knockTag'));
  console.log((ok ? '  PASS ' : '  FAIL ') + label);
  if (!ok) console.log('       want[' + expectTag + ' | ' + (expectTagCls || 'knockTag') + ']\n       got [' + txt + ' | ' + cls + ']');
  ok ? pass++ : fail++;
}

const H14 = [T('一條'),T('一條'),T('四條'),T('五條'),T('六條'),T('六條'),T('八條'),T('九條')];
const H7  = [T('一條'),T('一條'),T('四條'),T('五條'),T('六條'),T('八條'),T('九條')];

runTop('清混碰 出牌态 → 「可听 · 七條(4)」', {
  lajiHu: false, players: [mkPlayer(H14, melds2), mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: { kind: 'discard' }, expectTag: '可听 · 七條(4)'
});
runTop('清混碰 出牌态 听死 → 「可听 · 七條(0)」灰', {
  lajiHu: false, players: [mkPlayer(H14, melds2), mkPlayer([], [], { discards: four(T('七條')) }), mkPlayer([]), mkPlayer([])],
  pend: { kind: 'discard' }, expectTag: '可听 · 七條(0)', expectTagCls: 'knockTag off'
});
runTop('清混碰 等牌态 → 「听牌中 · 七條(4)」（不再「听」/「听死」）', {
  lajiHu: false, players: [mkPlayer(H7, melds2), mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: null, expectTag: '听牌中 · 七條(4)'
});
runTop('清混碰 等牌态 听死 → 「听牌中 · 七條(0)」灰', {
  lajiHu: false, players: [mkPlayer(H7, melds2), mkPlayer([], [], { discards: four(T('七條')) }), mkPlayer([]), mkPlayer([])],
  pend: null, expectTag: '听牌中 · 七條(0)', expectTagCls: 'knockTag off'
});
runTop('清混碰 等牌态 未听 → 「未听牌」灰', {
  lajiHu: false,
  players: [mkPlayer([T('一萬'),T('四萬'),T('七萬'),T('二筒'),T('五筒'),T('八筒'),T('三條')], melds2),
            mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: null, expectTag: '未听牌', expectTagCls: 'knockTag off'
});
runTop('敲麻 已敲 → 「已敲 · 听 七條」（玩法状态保留）', {
  lajiHu: true,
  players: [mkPlayer(H7, melds2, { knocked: true, knockWaits: [T('七條')] }),
            mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: { kind: 'discard' }, expectTag: '已敲 · 听 七條'
});
runTop('敲麻 出牌态 未敲 可敲听 → 「可敲听 · 打… 听 七條」', {
  lajiHu: true, players: [mkPlayer(H14, melds2), mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: { kind: 'discard' }, expectTag: /^可敲听 · 打.+ 听 七條$/
});
runTop('敲麻 等牌态 未敲 → 「未敲 · 不能胡」灰（未敲不算听）', {
  lajiHu: true, players: [mkPlayer(H7, melds2), mkPlayer([]), mkPlayer([]), mkPlayer([])],
  pend: null, expectTag: '未敲 · 不能胡', expectTagCls: 'knockTag off'
});

console.log('== 4) 已结算隐藏 ==');
S.CFG.lajiHu = false;
S.G.running = true; S.G.finished = true;
S.G.players = [mkPlayer([T('一條'),T('一條'),T('四條'),T('五條'),T('六條'),T('八條'),T('九條')], melds2),
               mkPlayer([]), mkPlayer([]), mkPlayer([])];
S.PEND = null;
sandbox.renderTingLine();
{
  const el = doc.getElementById('tingLine');
  const ok = (el.innerHTML === '' && el.className === 'tingline');
  console.log((ok ? '  PASS ' : '  FAIL ') + '已结算时底部行隐藏');
  ok ? pass++ : fail++;
}

console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ FAILED') + '  ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
