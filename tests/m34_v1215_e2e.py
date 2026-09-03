# m34：v1.2.15 联机端到端
#  A. 桌心新布局（单机）：骰子+剩余牌在圆上方、圆心纯数字倒计时（单机「——」）、coreTags 移除
#  B. 联机（双人房）：房主开「自动敲+自动胡」→ CFG 回写 → 玩家自动敲定后顶部/底部显示听的牌
#  C. 断线（退出）→ join 回牌局 → 能继续操作（询问恢复/出牌成功）
import sys, time
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8099/'
errs = []
ok = True

def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("  ✅ " if cond else "  ❌ ") + name + (("  " + str(extra)) if extra and not cond else ""))

# 智能出牌：能听牌优先打出那张（便于触发敲定），否则打第一张
AUTO = """() => {
  const btn = [...document.querySelectorAll('#acts button')];
  const by = t => btn.find(x => x.textContent.trim() === t);
  if (by('准备下一局')) { by('准备下一局').click(); return 'next'; }
  const kind = PEND ? PEND.kind : null;
  if (kind === 'discard'){
    // 先看有没有「敲听」打法（potentialKnocks 已含番型/门清条件）；
    // 没有就用引擎的机器人选牌 aiChooseDiscard 保持牌型——固定打第一张会把牌型打烂，永远听不了
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
    return (want !== null && want !== undefined) ? 'discard-ting' : 'discard';
  }
  if (by('胡')) { by('胡').click(); return 'hu'; }
  if (by('不敲')) { by('不敲').click(); return 'noknock'; }
  if (by('过')) { by('过').click(); return 'pass'; }
  if (by('敲')) { by('敲').click(); return 'knock'; }
  return 'idle';
}"""

def set_rule(pg, label, on=True):
    """等待页设置面板：把 label 行的开关切到 开/关 并确定"""
    pg.click('#rCfg'); pg.wait_for_timeout(300)
    rows = pg.evaluate("""(label) => {
      const rows = [...document.querySelectorAll('#sheet .setrow')];
      const row = rows.find(r => r.querySelector('.lb').textContent.startsWith(label));
      if (!row) return null;
      const btns = [...row.querySelectorAll('.seg button')];
      return btns.map(b => ({ t: b.textContent, on: b.classList.contains('on') }));
    }""", label)
    check(f'设置面板含「{label}」行', rows is not None, rows)
    if rows is None: return
    pg.evaluate("""([label, want]) => {
      const rows = [...document.querySelectorAll('#sheet .setrow')];
      const row = rows.find(r => r.querySelector('.lb').textContent.startsWith(label));
      const btns = [...row.querySelectorAll('.seg button')];
      const target = want ? btns.find(b => b.textContent === '开') : btns.find(b => b.textContent === '关');
      target.click();
    }""", [label, on])
    pg.wait_for_timeout(200)
    pg.evaluate("() => { [...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='确定').click(); }")
    pg.wait_for_timeout(400)

def mk_room(b, host_name, guest_name):
    """建房 + 玩家加入并准备，返回 (host_page, guest_page, roomNo)"""
    h = b.new_page(viewport={'width': 390, 'height': 780})
    h.on('pageerror', lambda e: errs.append('H:' + str(e)))
    h.on('dialog', lambda d: d.accept())
    h.goto(URL, wait_until='domcontentloaded'); h.wait_for_timeout(300)
    h.click('#hBtnMulti'); h.wait_for_timeout(300)
    h.fill('#lName', host_name); h.click('#lCreate'); h.wait_for_selector('#rStart', timeout=5000)
    room = h.evaluate('() => NET.roomNo')
    g = b.new_page(viewport={'width': 390, 'height': 780})
    g.on('pageerror', lambda e: errs.append('G:' + str(e)))
    g.on('dialog', lambda d: d.accept())
    g.goto(URL, wait_until='domcontentloaded'); g.wait_for_timeout(300)
    g.click('#hBtnMulti'); g.wait_for_timeout(300)
    g.fill('#lName', guest_name); g.fill('#lRoomNo', room); g.click('#lJoin'); g.wait_for_timeout(900)
    g.click('#rReady'); g.wait_for_timeout(300)
    return h, g, room

def me_state(pg):
    return pg.evaluate("""() => {
      const s = 0;   // applyView 会 remap：本地 0 永远是「我」
      const p = G.players[0] || {};
      return {
        seat: s,
        knocked: !!p.knocked,
        waits: p.knockWaits || [],
        handN: p.hand ? p.hand.length : -1,
        tag: (document.getElementById('knockTag') || {}).textContent || '',
        ting: (document.getElementById('tingLine') || {}).textContent || '',
        tingShow: (document.getElementById('tingLine') || {classList:{contains:()=>false}}).classList.contains('show'),
        finished: !!G.finished,
        tableOn: NET.tableOn
      };
    }""")

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-dev-shm-usage', '--no-sandbox'])

    # ===== Part A：单机布局 =====
    print('== Part A：桌心新布局（单机） ==')
    pg = b.new_page(viewport={'width': 390, 'height': 780})
    pg.on('pageerror', lambda e: errs.append('A:' + str(e)))
    pg.goto(URL, wait_until='domcontentloaded'); pg.wait_for_timeout(400)
    pg.click('#hBtnSolo'); pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }"); pg.wait_for_timeout(1200)
    lay = pg.evaluate("""() => {
      const dl = document.getElementById('diceLine');
      const cd = document.getElementById('cdTxt');
      const dial = document.querySelector('.dial');
      const core = document.querySelector('.core');
      return {
        diceLineExists: !!dl,
        hasDice: !!dl.querySelector('.diceC'),
        hasWall: !!dl.querySelector('#wallTxt'),
        wallTxt: (dl.querySelector('#wallTxt') || {}).textContent,
        diceText: dl.textContent,
        cdText: cd ? cd.textContent : null,
        cdColor: cd ? getComputedStyle(cd).color : null,
        coreTagsGone: !document.getElementById('coreTags'),
        noTurnWord: dl.textContent.indexOf('轮到') < 0 && dl.textContent.indexOf('剩余时间') < 0,
        dialTop: Math.round(dial.getBoundingClientRect().top),
        diceBottom: Math.round(dl.getBoundingClientRect().bottom),
        coreTop: Math.round(core.getBoundingClientRect().top)
      };
    }""")
    check('桌心上方为骰子+剩余牌行', lay['diceLineExists'] and lay['hasDice'] and lay['hasWall'], lay)
    check('剩余牌是数字', (lay['wallTxt'] or '').isdigit(), lay['wallTxt'])
    check('骰子行不含「轮到/剩余时间」', lay['noTurnWord'], lay['diceText'])
    # v1.2.16：无人决策时圆心直接留空（旧版显示「——」占位）
    check('圆心无人决策时留空（无「——」）', lay['cdText'] == '', repr(lay['cdText']))
    check('旧 coreTags 已移除', lay['coreTagsGone'], None)
    check('骰子行在圆上方不重叠', lay['diceBottom'] <= lay['dialTop'] + 1, (lay['diceBottom'], lay['dialTop']))
    pg.close()

    # ===== Part A2：敲定后「已敲·听 / 听牌中→」UI（单机注入听牌手牌，确定性） =====
    print('== Part A2：敲定听牌显示（单机，注入听牌手牌） ==')
    pg = b.new_page(viewport={'width': 390, 'height': 780})
    pg.on('pageerror', lambda e: errs.append('A2:' + str(e)))
    pg.goto(URL, wait_until='domcontentloaded'); pg.wait_for_timeout(400)
    pg.click('#hBtnSolo'); pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }"); pg.wait_for_timeout(1500)
    ting_ui = None
    t0 = time.time()
    while time.time() - t0 < 90:
        k = pg.evaluate("() => PEND ? PEND.kind : null")
        if k == 'discard':
            # 注入一副必然可敲听的 14 张（123万 456万 789万 24筒刻 24筒对 + 冗余），打 25 即听
            pg.evaluate("""() => {
              G.players[0].hand = [1,2,3, 11,12,13, 21,22,23, 24,25, 24,25, 24];
              G.players[0].drawn = null; G.players[0].melds = [];
              render();
            }""")
            pg.wait_for_timeout(150)
            r = pg.evaluate("""() => {
              const ks = potentialKnocks(G.players[0]);
              if (!ks.length) return 'no-knock';
              const arr = G.players[0].hand.slice(); arr.sort((a,b)=>a-b);
              const k = arr.indexOf(ks[0].discard);
              const tiles = document.querySelectorAll('#hand .tile');
              if (!tiles[k]) return 'no-tile';
              tiles[k].click(); tiles[k].click();
              return 'played';
            }""")
            if r == 'played':
                # 单机 autoKnock 默认关 → 出「敲定/不敲」，点「敲定」
                t1 = time.time()
                while time.time() - t1 < 10:
                    btn = pg.evaluate("""() => {
                      const b = [...document.querySelectorAll('#acts button')];
                      const kd = b.find(x => x.textContent.trim() === '敲定');
                      if (kd){ kd.click(); return 'k'; }
                      return null;
                    }""")
                    if btn == 'k': break
                    pg.wait_for_timeout(150)
                pg.wait_for_timeout(400)
                ting_ui = pg.evaluate("""() => ({
                  knocked: !!G.players[0].knocked,
                  waits: (G.players[0].knockWaits || []).join(','),
                  tag: (document.getElementById('knockTag') || {}).textContent || '',
                  ting: (document.getElementById('tingLine') || {}).textContent || '',
                  tingShow: (document.getElementById('tingLine') || {classList:{contains:()=>false}}).classList.contains('show')
                })""")
            break
        # 简单推进：胡/不敲/过/出牌（注入前随便打，凑到自己的 discard 轮次即可）
        pg.evaluate("""() => {
          const btn = [...document.querySelectorAll('#acts button')];
          const by = t => btn.find(x => x.textContent.trim() === t);
          if (by('准备下一局')) { by('准备下一局').click(); return; }
          if (by('胡')) { by('胡').click(); return; }
          if (by('不敲')) { by('不敲').click(); return; }
          if (by('过')) { by('过').click(); return; }
          if (PEND && PEND.kind === 'discard'){
            const tiles = document.querySelectorAll('#hand .tile');
            if (tiles.length){ tiles[0].click(); tiles[0].click(); }
          }
        }""")
        pg.wait_for_timeout(250)
    check('注入手牌后成功敲定', bool(ting_ui) and ting_ui['knocked'], ting_ui)
    if ting_ui and ting_ui['knocked']:
        check('单机顶部 knockTag「已敲 · 听 X」', '已敲 · 听 ' in ting_ui['tag'] and len(ting_ui['waits']) > 0, ting_ui['tag'])
        check('单机底部 tingLine「听牌中 →」', ting_ui['tingShow'] and '听牌中 →' in ting_ui['ting'], ting_ui['ting'])
        print('    knockTag:', ting_ui['tag'], '| tingLine:', ting_ui['ting'])
    pg.close()

    # ===== Part B：联机 自动敲/自动胡 + 听牌显示 =====
    print('== Part B：联机 autoKnock/autoHu + 听牌显示 ==')
    h, pl, room = mk_room(b, '房主乙', '玩家丙')
    set_rule(h, '自动敲', True)
    set_rule(h, '自动胡牌', True)
    cfgv = h.evaluate('() => ({ autoKnock: CFG.autoKnock, autoHu: CFG.autoHu })')
    check('房主端 CFG 回写 autoKnock/autoHu', cfgv['autoKnock'] is True and cfgv['autoHu'] is True, cfgv)
    cfgp = pl.evaluate('() => ({ autoKnock: CFG.autoKnock, autoHu: CFG.autoHu })')
    check('玩家端同步规则', cfgp['autoKnock'] is True and cfgp['autoHu'] is True, cfgp)

    h.click('#rStart'); h.wait_for_timeout(2500)
    knocked = None
    t0 = time.time()
    while time.time() - t0 < 300:
        st = me_state(pl)
        if st['knocked']:
            knocked = st; break
        # 牌局结束不强退：点「准备下一局」接着打，直到出现敲定
        h.evaluate(AUTO); pl.evaluate(AUTO)
        pl.wait_for_timeout(250)
    # 联机自然凑听是概率事件：敲定则端到端验证 UI；没敲定不算失败
    # （数据链路由 m33 确定性覆盖：projectFor 只给本人下发 knockWaits；UI 由 Part A2 单机确定性覆盖）
    if knocked:
        check('联机玩家被自动敲定', True, None)
        check('敲定后本人拿到 knockWaits', len(knocked['waits']) > 0, knocked['waits'])
        check('顶部 knockTag 带听牌名', '听 ' in knocked['tag'], knocked['tag'])
        check('底部 tingLine 带听牌名', knocked['tingShow'] and '听牌中 →' in knocked['ting']
              and len(knocked['ting']) > len('听牌中 → '), knocked['ting'])
        print('    seat=%s knockTag: %s | tingLine: %s' % (knocked['seat'], knocked['tag'], knocked['ting']))

    cd_num = None
    t0 = time.time()
    while time.time() - t0 < 30:
        cd = h.evaluate("() => (document.getElementById('cdTxt') || {}).textContent || ''")
        if cd.strip().isdigit():
            cd_num = cd; break
        h.evaluate(AUTO); pl.evaluate(AUTO)
        pl.wait_for_timeout(200)
    check('联机圆心出现纯数字倒计时', cd_num is not None, cd_num)

    h.close(); pl.close()

    # ===== Part C：独立房间 —— 退出再回，可继续打牌/敲听 =====
    print('== Part C：退出再回，可继续打牌 ==')
    h2, g2, room2 = mk_room(b, '房主丁', '玩家戊')
    h2.click('#rStart'); h2.wait_for_timeout(2500)
    # 先正常打几巡，确认回到牌桌且能出牌
    acted = False
    t0 = time.time()
    while time.time() - t0 < 60:
        r = g2.evaluate(AUTO)
        if isinstance(r, str) and r.startswith('discard'): acted = True
        h2.evaluate(AUTO)
        if me_state(g2)['finished']: break
        g2.wait_for_timeout(250)
    check('开局后玩家能出牌', acted, None)

    seat_before = g2.evaluate('() => NET.mySeat')
    # 真实路径：牌局中点「设置 → 回到首页」退出（发 leave、关 ws，座位保留给托管）
    g2.evaluate("() => backHome()")
    g2.wait_for_timeout(600)
    check('退出后回到首页（座位释放给托管）',
          g2.evaluate("() => !NET.tableOn && !NET.active && NET.mySeat === -1"), None)
    g2.close()

    g3 = b.new_page(viewport={'width': 390, 'height': 780})
    g3.on('pageerror', lambda e: errs.append('P2:' + str(e)))
    g3.on('dialog', lambda d: d.accept())
    g3.goto(URL, wait_until='domcontentloaded'); g3.wait_for_timeout(300)
    g3.click('#hBtnMulti'); g3.wait_for_timeout(300)
    g3.fill('#lName', '玩家戊'); g3.fill('#lRoomNo', room2); g3.click('#lJoin'); g3.wait_for_timeout(1500)
    st2 = g3.evaluate("""() => ({ tableOn: NET.tableOn, active: NET.active, seat: NET.mySeat,
      hand: (G.players[0] && G.players[0].hand) ? G.players[0].hand.length : -1 })""")
    check('重连回到牌桌（同一座位）', st2['tableOn'] and st2['active'] and st2['seat'] == seat_before, st2)
    check('重连后能看到手牌', st2['hand'] >= 10, st2['hand'])

    # 重连后继续操作：120 秒内应再次收到询问（discard/knock/claim 任意）并应答成功
    resumed = None
    t0 = time.time()
    last = 0
    while time.time() - t0 < 120:
        st3 = g3.evaluate("""() => ({ pend: PEND ? PEND.kind : null, finished: !!G.finished,
          hand: (G.players[0] && G.players[0].hand) ? G.players[0].hand.length : -1,
          turn: G.turn, active: NET.active, tableOn: NET.tableOn })""")
        if time.time() - last > 8:
            last = time.time()
            print('    [诊断]', st3)
        if st3['pend']:
            r = g3.evaluate(AUTO)
            if r in ('discard', 'hu', 'noknock', 'pass', 'knock', 'next'):
                resumed = st3['pend'] + '/' + r
                break
        else:
            g3.evaluate(AUTO)     # 结算后点「准备下一局」
        h2.evaluate(AUTO)
        g3.wait_for_timeout(250)
    check('重连后能继续应答服务端询问', resumed is not None, resumed)

    b.close()

print('JS 错误:', errs[:8] if errs else '无')
print('结果:', '✅ 全部通过' if ok and not errs else '❌ 有失败项')
sys.exit(0 if ok and not errs else 1)
