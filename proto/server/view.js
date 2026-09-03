/**
 * 可见性裁剪：给每个座位生成「只能看这些」的投影
 *
 * 联机最关键的安全边界 —— 服务端永远不能把别人的手牌和牌墙发下去。
 * 客户端拿到投影后照常渲染，但对其他三家只能画牌背。
 *
 * 这个函数就是方案文档 §4.2 里「第 8 项改造」的落点：
 * 前端 render*() 从「读 G」改成「读 projectFor(G, MY_SEAT)」。
 */

/**
 * @param {object} S  无头环境（或任何持有 __state.G / wallLeft 的对象）
 * @param {number} seat 目标座位
 * @param {Array}  online  可选，长度 4 的在线状态（房间层注入，座位卡显示掉线/托管用）
 */
function projectFor(S, seat, online){
  const G = S.__state.G;
  const wallLeft = S.wallLeft();

  const players = G.players.map((p, i) => {
    const base = {
      seat: i,
      name: p.name,
      isBot: !!p.isBot,
      online: online ? !!online[i] : true,
      score: p.score,
      handCount: p.hand.length,          // 张数是公开的（要画几张牌背）
      flowers: p.flowers.slice(),        // 花牌公开
      melds: p.melds.map(m => ({         // 副露公开（含来源，画箭头要用）
        type: m.type, tiles: m.tiles.slice(), tile: m.tile,
        concealed: !!m.concealed, from: (m.from === undefined ? -1 : m.from)
      })),
      discards: p.discards.slice(),      // 牌河公开
      knocked: !!p.knocked,              // 是否敲牌公开
      menqing: !!p.menqing
    };
    // ★ 只有本人能看到自己的手牌，其余三家只有张数
    if (i === seat){
      base.hand = p.hand.slice();
      base.drawn = p.drawn;
      // v1.2.15：自己的敲定听牌随投影下发（顶部「已敲·听X」/底部「听牌中→X」要用）；
      // 别家不下发，听牌仍是私密信息
      base.knockWaits = (p.knocked && Array.isArray(p.knockWaits)) ? p.knockWaits.slice() : [];
      base.waits = S.getWaits ? S.getWaits(p).map(w => w.t) : [];
      base.canKnock = S.canKnock ? S.canKnock(p) : false;
      base.missHu = Array.from(p.missHu || []);   // 自己的漏胡状态（UI 提示用）
    } else {
      base.hand = null;                  // 明确置空，避免误渲染
      base.drawn = null;
      base.waits = null;
      base.canKnock = null;
    }
    // AI 的做牌目标属于内部信息，永不外发
    return base;
  });

  return {
    // 公共牌桌信息
    table: {
      phase: G.running ? 'playing' : (G.finished ? 'settled' : 'idle'),
      turn: G.turn,
      dealer: G.dealer,
      handNo: G.handNo,
      roundWind: G.roundWind,
      huangfan: G.huangfan,
      kaibao: !!G.kaibao,
      kaibaoType: G.kaibaoType || null,
      dice: G.dice || null,
      wallLeft,                          // ★ 只给剩余张数，牌墙内容永不外发
      lastDiscard: G.lastDiscard,
      lastFrom: G.lastFrom,
      finished: !!G.finished,
      totalHands: G.totalHands
    },
    mySeat: seat,
    myWind: S.windOf ? S.windOf(seat) : null,
    players,
    logs: G.logs.slice(),                // 本局完整出牌记录（「全部手牌记录」用）
    cfg: {
      base: S.__state.CFG.base,
      allowChow: S.__state.CFG.allowChow,
      sevenPairs: S.__state.CFG.sevenPairs,
      lajiHu: S.__state.CFG.lajiHu
    }
  };
}

/** 结算后亮牌：把所有人的手牌公开 */
function projectReveal(S){
  const G = S.__state.G;
  return G.players.map((p, i) => ({
    seat: i, name: p.name, score: p.score,
    hand: p.hand.slice(),
    flowers: p.flowers.slice(),
    melds: p.melds.map(m => ({ type: m.type, tiles: m.tiles.slice(), concealed: !!m.concealed, from: m.from })),
    knocked: !!p.knocked
  }));
}

module.exports = { projectFor, projectReveal };
