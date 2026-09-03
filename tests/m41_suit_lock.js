// m41：v1.2.19 清混碰「吃过即锁门」——吃(chow)后本局方向锁死该花色
//  1) 已有吃牌副露后：其他花色的吃/碰/杠选项全部消失（按钮不会再提示）
//  2) 本门 + 字牌（风/中发白）的吃碰杠仍保留
//  3) 摸牌后的暗杠/加杠同规则过滤（其他花色暗杠不再提示）
//  4) 敲麻玩法（lajiHu 开，平胡兜底）不锁门，行为不变
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = js.indexOf("$('btnHist').onclick");
if (cut < 0) { console.log('CUT FAIL'); process.exit(1); }
js = js.slice(0, cut);

eval(js + `
;NET.active = false;
render = function(){}; renderActs = function(){}; renderHand = function(){}; renderSeats = function(){};
renderRiver = function(){}; renderFx = function(){}; renderTop = function(){}; renderTurnClock = function(){};
renderRoom = function(){}; renderHUD = function(){}; logMsg = function(){}; toast = function(){};
seatToast = function(){}; openSheet = function(){}; closeSheet = function(){};
global.__ = { CFG, mkPlayer, claimOptions, selfKongOptions, lockedSuitOf, toCounts, tileName };
`);
const T = global.__;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ❌ FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };
const m = n => n - 1, p = n => 9 + n - 1, s = n => 18 + n - 1;
// 造一个「已吃过萬 123」的玩家（清混碰局）
function botLocked(handExtra, laji){
  T.CFG.lajiHu = !!laji;
  const pl = T.mkPlayer(0, '甲', false);
  pl.hand = [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(1), p(1)].concat(handExtra || []);
  pl.melds = [{ type: 'chow', tile: m(1), tiles: [m(1), m(2), m(3)], from: 3 }];
  return pl;
}
const kinds = o => (o || []).map(x => x.k);

console.log('== 1) 清混碰：吃过萬后锁门 ==');
// 手里有 筒 3 张（可杠/碰）、風 2 张（可碰）
let pL = botLocked([p(1), p(1), 27, 27, m(1)], false);   // 筒x3 + 東x2 + 萬x1，共 13 张
let o = T.claimOptions(pL, p(1), 1, true);               // 上家打 筒1
ok('打筒：吃/碰/杠全不给（其他花色已锁死）', kinds(o).filter(k => k !== 'hu').length === 0, kinds(o));
pL = botLocked([p(1), p(1), p(1), 27, 27, m(1)], false); // 筒x3+東x2+萬x1? 需数
// 手里必须有本门對/刻才谈得上选项：把筒换成萬
pL = botLocked([m(1), m(1), 27, 27, 28, 28, 31, 31], false);
o = T.claimOptions(pL, m(1), 1, true);                   // 上家打 萬1
ok('打萬（本门）：可碰', kinds(o).includes('pung'), kinds(o));
o = T.claimOptions(pL, 27, 1, true);                     // 打東
ok('打東（字牌）：可碰', kinds(o).includes('pung'), kinds(o));
o = T.claimOptions(pL, 31, 1, true);                     // 打中（清混碰算字）
ok('打中发白（字牌）：可碰', kinds(o).includes('pung'), kinds(o));
o = T.claimOptions(pL, p(1), 1, true);                   // 打筒
ok('打筒（其他花色）：即使手里三张也不给碰', !kinds(o).includes('pung') && !kinds(o).includes('kong'), kinds(o));

console.log('== 2) 吃/顺子选项也锁门 ==');
// 手里有 筒 4 5（想吃 6 成筒顺）——但锁的是萬门，不应给吃筒
pL = botLocked([m(1), m(1), p(4), p(5)], false);          // 手里 筒45 等 6
o = T.claimOptions(pL, p(6), 1, true);
ok('打 筒6：不给吃（跨门顺子）', !kinds(o).includes('chow'), kinds(o));
o = T.claimOptions(pL, m(5), 1, true);                    // 打萬5，手里有萬? m(1)x3 無5 → 無 chow
// 手里补萬 6 7 才能吃 5？锁萬：手里 m(1)m(1)m(5)? 用專用构造
pL = botLocked([m(1), m(1), m(6), m(7)], false);          // 手 萬67
o = T.claimOptions(pL, m(5), 1, true);                    // 上家打萬5 → 吃 567
ok('打萬（本门）可吃顺子', kinds(o).includes('chow'), kinds(o));

console.log('== 3) 暗杠/加杠同规则 ==');
// 直接构造合法 13 张：已吃萬顺（副露1组），手牌 筒x4 + 萬x2 + 風x2 + 散（筒4张摸齐待暗杠）
T.CFG.lajiHu = false;
pL = T.mkPlayer(0, '甲', false);
pL.melds = [{ type: 'chow', tile: m(1), tiles: [m(1), m(2), m(3)], from: 3 }];
pL.hand = [p(1), p(1), p(1), p(1), m(6), m(7), m(8), m(9), 27, 27, 28, 28, 29];
let ko = T.selfKongOptions(pL);
ok('摸齐筒4张：不给暗杠（其他花色）', !ko.some(x => x.k === 'ankan' && x.tile === p(1)), ko.map(x => x.k + ':' + x.tile));
// 本门 萬9 摸齐 4 张 → 可暗杠（換散牌成 萬9x4）
pL.hand = [m(9), m(9), m(9), m(9), m(6), m(7), p(1), p(1), 27, 27, 28, 28, 29];
ko = T.selfKongOptions(pL);
ok('本门萬4张：可暗杠', ko.some(x => x.k === 'ankan' && x.tile === m(9)), ko.map(x => x.k + ':' + x.tile));
// 加杠：已碰的風刻第4张（字牌混一色允许）
pL.hand = [27, 27, 27, m(6), m(7), m(8), m(9), 28, 28, 29, 29, p(1), p(1)];
pL.melds.push({ type: 'pung', tile: 27, tiles: [27, 27, 27], from: 2 });
ko = T.selfKongOptions(pL);
ok('字牌（風）已碰刻第4张：可加杠', ko.some(x => x.k === 'chakan' && x.tile === 27), ko.map(x => x.k + ':' + x.tile));

console.log('== 4) 敲麻（lajiHu 开）不锁门 ==');
T.CFG.lajiHu = true;
pL = T.mkPlayer(0, '甲', false);
pL.melds = [{ type: 'chow', tile: m(1), tiles: [m(1), m(2), m(3)], from: 3 }];
pL.hand = [p(1), p(1), p(1), p(1), m(6), m(7), m(8), m(9), 27, 27, 28, 28, 29];
o = T.claimOptions(pL, p(1), 1, true);
ok('敲麻：吃过萬后打筒仍可碰（平胡兜底不锁）', kinds(o).includes('pung'), kinds(o));
ko = T.selfKongOptions(pL);
ok('敲麻：筒4张暗杠仍提示', ko.some(x => x.k === 'ankan' && x.tile === p(1)), ko.map(x => x.k + ':' + x.tile));

console.log('== 5) 未吃牌（只有碰）不锁门 ==');
T.CFG.lajiHu = false;
pL = botLocked([p(1), p(1), p(1), m(1), m(1), m(1), m(1)], false);
pL.melds = [{ type: 'pung', tile: 0, tiles: [0, 0, 0], from: 2 }];   // 只有碰，没吃
ok('lockedSuitOf = null（未吃不锁）', T.lockedSuitOf(pL) === null, T.lockedSuitOf(pL));
o = T.claimOptions(pL, p(1), 1, true);
ok('只碰没吃：打筒可碰（碰碰胡路线仍开放）', kinds(o).includes('pung'), kinds(o));

console.log('');
console.log(`结果: ${fail === 0 ? '✅' : '❌'} ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
