# m38：v1.2.16「玩法：敲麻 / 清混碰」端到端
#  A. 单机：设置面板「玩法」行切换 → CFG.lajiHu 与高亮跟着变（敲麻=开 / 清混碰=关）
#  B. 联机：房主设「清混碰」→ 服务端白名单放行并广播 → 玩家端 CFG.lajiHu 同步为 false
#  C. 联机真打一局（两家机器人）：有吃牌(chow)的家，其吃牌副露必须同门——
#     清混碰下花色锁生效，机器人不会吃出多门顺子
import sys, time
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8099/'
errs = []
ok = True

def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("  ✅ " if cond else "  ❌ ") + name + (("  " + str(extra)) if extra and not cond else ""))

AUTO = """() => {
  const btn = [...document.querySelectorAll('#acts button')];
  const by = t => btn.find(x => x.textContent.trim() === t);
  if (by('准备下一局')) { by('准备下一局').click(); return 'next'; }
  const kind = PEND ? PEND.kind : null;
  if (kind === 'discard'){
    const me = G.players[0];
    let want = null;
    try { const ks = potentialKnocks(me); if (ks && ks.length) want = ks[0].discard; } catch (e) { want = null; }
    if (want === null || want === undefined){
      try { want = aiChooseDiscard(me); } catch (e) { want = null; }
    }
    const arr = me.hand.slice();
    let drawn = me.drawn;
    if (drawn !== null && drawn !== undefined){
      const i = arr.indexOf(drawn);
      if (i >= 0) arr.splice(i, 1);
    }
    arr.sort((a, b) => a - b);
    const k = (want === null || want === undefined) ? 0 : arr.indexOf(want);
    const tiles = document.querySelectorAll('#hand .tile');
    if (!tiles.length) return 'notile';
    const j = (k >= 0 && k < tiles.length) ? k : 0;
    tiles[j].click(); tiles[j].click();
    return 'discard';
  }
  if (by('胡')) { by('胡').click(); return 'hu'; }
  if (by('不敲')) { by('不敲').click(); return 'noknock'; }
  if (by('过')) { by('过').click(); return 'pass'; }
  if (by('敲')) { by('敲').click(); return 'knock'; }
  return 'idle';
}"""

# 设置面板里点「玩法」行的某个选项，然后确认（row_label 匹配行、opt_label 匹配选项）
def pick_play(pg, row_label, opt_label):
    hit = pg.evaluate("""([rowLabel, optLabel]) => {
      const rows = [...document.querySelectorAll('#sheet .setrow')];
      const row = rows.find(r => r.querySelector('.lb').textContent.startsWith(rowLabel));
      if (!row) return 'norow';
      const target = [...row.querySelectorAll('.seg button')].find(b => b.textContent.trim() === optLabel);
      if (!target) return 'noopt';
      target.click();
      return 'ok';
    }""", [row_label, opt_label])
    check(f'点到「{row_label} → {opt_label}」', hit == 'ok', hit)
    pg.wait_for_timeout(200)
    pg.evaluate("""() => {
      const bs = [...document.querySelectorAll('#sheet .btns button')];
      const b = bs.find(x => x.textContent === '确定') || bs.find(x => x.textContent === '完成');
      if (b) b.click();
    }""")
    pg.wait_for_timeout(200)
    # v1.2.18：局内改设置点「完成」会弹「重新开局？」确认——接受它（应用改动并重开）
    pg.evaluate("""() => {
      const b = [...document.querySelectorAll('#sheet .btns button')]
        .find(x => x.textContent === '确定，重新开局');
      if (b) b.click();
    }""")
    pg.wait_for_timeout(400)

def play_row(pg):
    return pg.evaluate("""() => {
      const rows = [...document.querySelectorAll('#sheet .setrow')];
      const row = rows.find(r => r.querySelector('.lb').textContent.startsWith('玩法'));
      if (!row) return null;
      return [...row.querySelectorAll('.seg button')].map(b => ({ t: b.textContent, on: b.classList.contains('on') }));
    }""")

def mk_room(b, hname, gname):
    h = b.new_page(viewport={'width': 390, 'height': 780})
    h.on('pageerror', lambda e: errs.append('H:' + str(e)))
    h.on('dialog', lambda d: d.accept())
    h.goto(URL, wait_until='domcontentloaded'); h.wait_for_timeout(300)
    h.click('#hBtnMulti'); h.wait_for_timeout(300)
    h.fill('#lName', hname); h.click('#lCreate'); h.wait_for_selector('#rStart', timeout=5000)
    room = h.evaluate('() => NET.roomNo')
    g = b.new_page(viewport={'width': 390, 'height': 780})
    g.on('pageerror', lambda e: errs.append('G:' + str(e)))
    g.on('dialog', lambda d: d.accept())
    g.goto(URL, wait_until='domcontentloaded'); g.wait_for_timeout(300)
    g.click('#hBtnMulti'); g.wait_for_timeout(300)
    g.fill('#lName', gname); g.fill('#lRoomNo', room); g.click('#lJoin'); g.wait_for_timeout(900)
    g.click('#rReady'); g.wait_for_timeout(300)
    return h, g, room

with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ===== Part A：单机切换玩法 =====
    print('== Part A：单机设置「玩法」行 ==')
    pg = b.new_page(viewport={'width': 390, 'height': 780})
    pg.on('pageerror', lambda e: errs.append('A:' + str(e)))
    pg.goto(URL, wait_until='domcontentloaded'); pg.wait_for_timeout(300)
    pg.click('#hBtnSolo'); pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }"); pg.wait_for_timeout(1200)

    pg.click("#btnSet"); pg.wait_for_timeout(300)
    row = play_row(pg)
    check('设置面板含「玩法」行', row is not None, row)
    if row:
        labels = [x['t'] for x in row]
        check('选项只有「敲麻 / 清混碰」两项', labels == ['敲麻', '清混碰'], labels)
        check('默认高亮「敲麻」', any(x['t'] == '敲麻' and x['on'] for x in row), row)
    laji0 = pg.evaluate('() => !!CFG.lajiHu')
    check('默认 CFG.lajiHu = true（敲麻）', laji0, laji0)

    pick_play(pg, '玩法', '清混碰')
    laji1 = pg.evaluate('() => !!CFG.lajiHu')
    check('选「清混碰」后 CFG.lajiHu = false', laji1 is False, laji1)
    pg.click("#btnSet"); pg.wait_for_timeout(300)
    row = play_row(pg)
    check('重开面板高亮落在「清混碰」', row and any(x['t'] == '清混碰' and x['on'] for x in row), row)

    pick_play(pg, '玩法', '敲麻')
    laji2 = pg.evaluate('() => !!CFG.lajiHu')
    check('切回「敲麻」后 CFG.lajiHu = true', laji2 is True, laji2)
    pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='完成'); if(b) b.click(); }")
    pg.wait_for_timeout(300)
    pg.close()

    # ===== Part B：联机同步到服务端 =====
    print('== Part B：联机房主设「清混碰」→ 玩家端同步 ==')
    h, g, room = mk_room(b, '房主', '玩家乙')
    h.click('#rCfg'); h.wait_for_timeout(300)
    pick_play(h, '玩法', '清混碰')
    h_laji = h.evaluate('() => !!CFG.lajiHu')
    g_laji = g.evaluate('() => !!CFG.lajiHu')
    check('房主端 CFG.lajiHu = false', h_laji is False, h_laji)
    check('玩家端同步 lajiHu = false（服务端白名单放行）', g_laji is False, g_laji)

    # ===== Part C：真打一局，检查吃牌副露同门 =====
    print('== Part C：清混碰实战，检查机器人副露 ==')
    h.click('#rStart'); h.wait_for_timeout(1500)
    hand = h.evaluate('() => (G.players[0] && G.players[0].hand ? G.players[0].hand.length : -1)')
    check('开局发到手牌', hand >= 9, hand)

    # 每轮给每家留「副露最多时」的快照（局末 melds 会被下一局清掉），两端都驱动
    SNAP = """() => {
      window.__MELDS = window.__MELDS || {};
      for (const p of G.players){
        const rec = window.__MELDS[p.name] || { n: -1, kinds: [], suits: [] };
        if (p.melds.length > rec.n){
          const suits = new Set();
          for (const m of p.melds) if (m.type === 'chow')
            for (const t of m.tiles) if (t < 27) suits.add(Math.floor(t / 9));
          window.__MELDS[p.name] = {
            n: p.melds.length,
            kinds: p.melds.map(m => m.type),
            suits: [...suits]
          };
        }
      }
      return Object.keys(window.__MELDS).length;
    }"""
    seen = {'discard': 0, 'hu': 0, 'next': 0}
    for i in range(420):
        try:
            r = h.evaluate(AUTO)
            if r in seen: seen[r] += 1
            g.evaluate(AUTO)
            h.evaluate(SNAP)
        except Exception:
            break
        if h.evaluate('() => !!G.finished'):
            # 结算后准备下一局，攒够副露样本（目标：跑满 2 局）
            h.evaluate(AUTO); g.evaluate(AUTO)
            h.wait_for_timeout(700)
            h.evaluate(AUTO); g.evaluate(AUTO)   # 两个真人端都要点「准备下一局」
            if seen['next'] >= 1 and h.evaluate('() => !!G.finished') is False:
                pass
        if seen['next'] >= 2:
            break
        h.wait_for_timeout(400)
    diag = h.evaluate('() => ({ handNo: G.handNo, finished: !!G.finished, wall: wallLeft() })')

    melds = h.evaluate("""() => Object.keys(window.__MELDS || {}).map(k => Object.assign({ name: k }, window.__MELDS[k]))""")
    melds = [{'name': x['name'], 'meldN': x['n'], 'chowN': x['kinds'].count('chow'),
              'kinds': x['kinds'], 'suits': x['suits']} for x in melds]
    total_melds = sum(x['meldN'] for x in melds)
    chow_homes = [x for x in melds if x['chowN'] > 0]
    print(f'   出牌 {seen["discard"]} 次 / 胡 {seen["hu"]} 次 / 副露合计 {total_melds} 副  [{diag}]')
    print('   各家副露：', melds)
    check('这局确实产生了副露（样本不为零）', total_melds > 0, melds)
    for x in chow_homes:
        check(f'吃牌的家「{x["name"]}」吃牌副露同门（不跨门）', len(x['suits']) <= 1, x)
    if not chow_homes:
        print('   （本局无人吃牌，副露全为碰/杠——清混碰下属正常）')

    h.close(); g.close()
    b.close()

print('JS 错误:', '、'.join(errs) if errs else '无')
print('结果:', '✅ 全部通过' if (ok and not errs) else '❌ 有失败项')
sys.exit(0 if (ok and not errs) else 1)
