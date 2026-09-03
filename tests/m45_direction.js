// m45：v1.2.21 副露方向约束（修「先碰九萬再吃筒顺」）——清混碰下吃/碰/杠与做牌方向必须相容
//  1) 单门刻：跨门吃顺禁、本门吃顺允、跨门碰刻允（碰碰胡路线）、字牌碰允、目标不切跨门
//  2) 两门刻：吃任何顺子禁（只能碰碰胡）、碰继续允
//  3) 吃过（chow）：锁门（v1.2.19 回归）
//  4) 只碰字刻 / 无副露：自由
//  5) 敲麻对照：不锁（平胡兜底）
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
global.__ = { CFG, mkPlayer, claimOptions, directionOf, aiTargetOf };
`);
const T = global.__;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ❌ FAIL: ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } };
const kinds = o => (o || []).map(x => x.k);
const mk = (laji, melds, hand) => { T.CFG.lajiHu = !!laji; const p = T.mkPlayer(0, 'x', false); p.melds = melds.slice(); p.hand = hand.slice(); return p; };
const PUNG = t => ({ type: 'pung', tile: t, tiles: [t, t, t], from: 2 });
const CHOW = t => ({ type: 'chow', tile: t, tiles: [t, t + 1, t + 2], from: 3 });
const W = 8, TONG9 = 17, E = 27;

console.log('== 1) 只碰一门刻（九萬）→ 方向可 pung 或本门一色 ==');
let p = mk(false, [PUNG(W)], [11, 12, 13, 14, 15, 20, 21, 22, 31, 31, 1, 2, 7]);
ok('打筒3（跨门）无吃选项', !kinds(T.claimOptions(p, 11, 1, true)).includes('chow'), kinds(T.claimOptions(p, 11, 1, true)));
p = mk(false, [PUNG(W)], [0, 1, 17, 17, 18, 19, 27, 27, 31, 31, 32, 33, 33]);
ok('打筒9（跨门刻，走碰碰胡）仍可碰', kinds(T.claimOptions(p, TONG9, 1, true)).includes('pung'), kinds(T.claimOptions(p, TONG9, 1, true)));
ok('打風（字刻）仍可碰', kinds(T.claimOptions(p, E, 1, true)).includes('pung'), kinds(T.claimOptions(p, E, 1, true)));
ok('direction = single(萬)', JSON.stringify(T.directionOf(p)) === '{"single":0}', T.directionOf(p));
// v1.2.22：碰过（哪怕一门）→ 本门吃也彻底不给（用户主张：碰过就不该有吃按钮）
const pw = mk(false, [PUNG(W)], [0, 1, 11, 12, 18, 19, 27, 27, 31, 31, 32, 33, 33]);
ok('碰过萬：打萬2（本门顺）也不给吃', !kinds(T.claimOptions(pw, 2, 1, true)).includes('chow'), kinds(T.claimOptions(pw, 2, 1, true)));
const b = mk(false, [PUNG(W)], [11, 12, 13, 14, 15, 20, 21, 22, 31, 31, 1, 2, 7]);
const tg = T.aiTargetOf(b);
ok('AI 目标不再误切跨门筒（pung / 本門 mix/pure）', tg === 'pung' || tg === 'mix0' || tg === 'pure0', tg);

console.log('== 2) 碰了两门刻（萬+筒）→ 只能碰碰胡 ==');
p = mk(false, [PUNG(W), PUNG(TONG9)], [18, 18, 5, 6, 14, 15, 23, 24, 27, 27, 31, 31, 32]);
ok('打條1（顺子）无吃选项', !kinds(T.claimOptions(p, 18, 1, true)).includes('chow'), kinds(T.claimOptions(p, 18, 1, true)));
ok('打條1（刻子，碰碰胡路线）仍可碰', kinds(T.claimOptions(p, 18, 1, true)).includes('pung'), kinds(T.claimOptions(p, 18, 1, true)));
ok('direction = pung', JSON.stringify(T.directionOf(p)) === '{"pung":true}', T.directionOf(p));

console.log('== 3) 吃过（萬顺）→ 锁本门（v1.2.19 回归） ==');
p = mk(false, [CHOW(0)], [4, 5, 11, 12, 20, 21, 27, 27, 31, 31, 32, 33, 33]);
ok('打筒4顺：无选项', !kinds(T.claimOptions(p, 13, 1, true)).includes('chow'), kinds(T.claimOptions(p, 13, 1, true)));
ok('打萬3顺（本门）：可吃', kinds(T.claimOptions(p, 3, 1, true)).includes('chow'), kinds(T.claimOptions(p, 3, 1, true)));
ok('direction = lock(萬)', JSON.stringify(T.directionOf(p)) === '{"lock":0}', T.directionOf(p));

console.log('== 4) 无副露 / 只碰字刻 → 自由 ==');
p = mk(false, [PUNG(E)], [11, 12, 13, 14, 15, 20, 21, 22, 23, 31, 31, 32, 32]);
ok('只碰東：打筒5顺可吃（方向自由）', kinds(T.claimOptions(p, 13, 1, true)).includes('chow'), kinds(T.claimOptions(p, 13, 1, true)));
ok('direction = free', JSON.stringify(T.directionOf(p)) === '{"free":true}', T.directionOf(p));

console.log('== 5) 敲麻对照：不锁 ==');
p = mk(true, [PUNG(W)], [11, 12, 13, 14, 15, 20, 21, 22, 31, 31, 1, 2, 7]);
ok('敲麻碰萬后吃筒顺仍允许（平胡兜底）', kinds(T.claimOptions(p, 11, 1, true)).includes('chow'), kinds(T.claimOptions(p, 11, 1, true)));

console.log('');
console.log(`结果: ${fail === 0 ? '✅' : '❌'} ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
