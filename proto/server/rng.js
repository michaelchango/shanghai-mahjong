/**
 * 种子随机数（mulberry32）
 *
 * 为什么联机必须用种子 RNG 而不是 Math.random()：
 *   1. 可复现 —— 同一个种子必然洗出同一副牌，服务端崩了能重建牌局
 *   2. 可复盘 —— 记下种子就能完整重放一局
 *   3. 可验证 —— 结算后公开种子，玩家能自己验算「这副牌没被做过手脚」
 */
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由房间号 + 局号派生种子，保证每局牌都不一样但可复现 */
function handSeed(roomNo, handNo, roundWind){
  let h = 2166136261 >>> 0;                 // FNV-1a 起点
  const mix = n => {
    h ^= (n >>> 0);
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(Number(roomNo) || 0);
  mix(handNo);
  mix(roundWind);
  return h >>> 0;
}

/** 生成一个替身 Math：除 random 外全部沿用原生 Math */
function seededMath(seed){
  const rnd = mulberry32(seed);
  const m = Object.create(Math);
  m.random = rnd;
  return m;
}

module.exports = { mulberry32, handSeed, seededMath };
