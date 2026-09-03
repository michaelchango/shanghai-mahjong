# 房主管理功能 + 准备/开始规则 + 中途退出可重进
# 1) 房主不需要准备；已加入真人全准备后才能开始；空位不看准备状态
# 2) 房主「结束本局」→ 所有人回房间等待页
# 3) 房主「关闭房间」→ 所有人回首页，房间不存在
# 4) 全员中途退出 → 同一房间号还能重新进入
# 5) 牌局进行中退出 → 同昵称重新加入能顶替回去继续打
import sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
errs = []
ok = True

STATE = """() => ({
  pick:  !document.getElementById('homePick').classList.contains('hide'),
  lobby: !document.getElementById('homeLobby').classList.contains('hide'),
  room:  !document.getElementById('homeRoom').classList.contains('hide'),
  homeHidden: document.getElementById('home').classList.contains('hide'),
  roomNo: NET.roomNo, isHost: NET.isHost, tableOn: NET.tableOn, active: NET.active,
  mySeat: NET.mySeat,
  startVisible: !document.getElementById('rStart').classList.contains('hide'),
  startDisabled: document.getElementById('rStart').disabled,
  readyVisible: !document.getElementById('rReady').classList.contains('hide'),
  closeVisible: !document.getElementById('rClose').classList.contains('hide'),
  status: (document.getElementById('rStatus') || {}).textContent || '',
  seatsText: (document.getElementById('rBoard') || {}).textContent || '',
  myName: (G.players && G.players[0] && G.players[0].name) || null,
  err: (document.getElementById('lErr') || {}).textContent || ''
})"""

AUTO = """() => {
  const b = Array.from(document.querySelectorAll('#acts button'));
  const by = t => b.find(x => x.textContent === t);
  if (by('准备下一局')) { by('准备下一局').click(); return; }
  if (by('不敲')) { by('不敲').click(); return; }
  const t = document.querySelectorAll('#hand .tile');
  if (t.length && (document.getElementById('hint').textContent || '').indexOf('点击一张牌') >= 0){
    t[0].click(); t[0].click(); return;
  }
  if (by('胡')) by('胡').click();
  else if (by('杠')) by('杠').click();
  else if (by('暗杠')) by('暗杠').click();
  else if (by('加杠')) by('加杠').click();
  else if (by('碰')) by('碰').click();
  else if (by('吃')) by('吃').click();
  else if (by('过')) by('过').click();
}"""

def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("  ✅ " if cond else "  ❌ ") + name + (("  " + str(extra)) if extra and not cond else ""))

def mkjoin(p, pg, name, room_no=None):
    """建房或加入，返回房间号"""
    pg.goto(URL); pg.wait_for_timeout(300)
    pg.click("#hBtnMulti"); pg.wait_for_timeout(200)
    pg.fill("#lName", name)
    if room_no is None:
        pg.click("#lCreate")
    else:
        pg.fill("#lRoomNo", room_no); pg.click("#lJoin")
    pg.wait_for_timeout(700)
    return pg.evaluate("() => NET.roomNo")

def ready_and_start(pages):
    """非房主全部准备，房主点开始"""
    for pg in pages[1:]:
        if pg.evaluate("() => !document.getElementById('rReady').classList.contains('hide')"):
            pg.click("#rReady"); pg.wait_for_timeout(150)
    pages[0].wait_for_timeout(300)
    pages[0].click("#rStart"); pages[0].wait_for_timeout(2500)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-dev-shm-usage", "--no-sandbox"])
    ctxs, pages = [], []
    for i in range(4):
        ctx = b.new_context(viewport={"width": 390, "height": 780})
        pg = ctx.new_page()
        pg.on("dialog", lambda d: d.accept())
        pg.on("pageerror", lambda e, n=i: errs.append(f"P{n} PAGEERROR: " + str(e)))
        pg.on("console", lambda m, n=i: errs.append(f"P{n} CONSOLE: " + m.text) if m.type == "error" else None)
        ctxs.append(ctx); pages.append(pg)

    print("== 场景1：准备/开始规则 + 房主结束本局 ==")
    room = mkjoin(p, pages[0], "房主甲")
    st0 = pages[0].evaluate(STATE)
    check("房主进房不显示准备按钮", not st0['readyVisible'], st0)
    check("单人时房主可直接开始（空位不看准备状态）", st0['startVisible'] and not st0['startDisabled'], st0)
    check("空座位显示「空」不显示 null", "空" in st0['seatsText'] and "null" not in st0['seatsText'], st0['seatsText'])

    for i in range(1, 4):
        mkjoin(p, pages[i], f"玩家{i}", room)
    pages[0].wait_for_timeout(500)
    st = pages[0].evaluate(STATE)
    check("加入者未准备时开始按钮置灰", st['startVisible'] and st['startDisabled'], st)
    check("状态行提示还有玩家未准备", "未准备" in st['status'], st['status'])
    st1 = pages[1].evaluate(STATE)
    check("非房主显示准备按钮", st1['readyVisible'], st1)

    for pg in pages[1:]:
        pg.click("#rReady"); pg.wait_for_timeout(150)
    pages[0].wait_for_timeout(400)
    st = pages[0].evaluate(STATE)
    check("全员准备后房主可以开始", st['startVisible'], st)

    pages[0].click("#rStart"); pages[0].wait_for_timeout(2500)
    for _ in range(6):
        for pg in pages: pg.evaluate(AUTO)
        pages[0].wait_for_timeout(600)
    st = pages[0].evaluate(STATE)
    check("开局后进入牌桌", st['homeHidden'] and st['tableOn'], st)

    # 房主：设置 → 结束本局
    pages[0].click("#btnSet"); pages[0].wait_for_timeout(400)
    btns = pages[0].evaluate("() => Array.from(document.querySelectorAll('#sheet .btns button')).map(x=>x.textContent)")
    print("    房主设置面板按钮:", btns)
    check("房主设置面板有「结束本局」", "结束本局" in btns, btns)
    check("房主设置面板有「关闭房间」", "关闭房间" in btns, btns)
    check("退出按钮文案为「回到首页」", "回到首页" in btns and "退出对局" not in ''.join(btns), btns)
    pages[0].click("#sheet .btns button.danger"); pages[0].wait_for_timeout(1200)

    after = [pg.evaluate(STATE) for pg in pages]
    check("所有人回到房间等待页", all(s['room'] for s in after), [s['room'] for s in after])
    check("房间号未变", all(s['roomNo'] == room for s in after), [s['roomNo'] for s in after])
    check("结束本局后准备状态已重置", after[0]['startDisabled'] and "未准备" in after[0]['status'], after[0])
    check("房主看到「关闭房间」", after[0]['closeVisible'], after[0])
    check("非房主看不到「关闭房间」", not after[1]['closeVisible'], after[1])

    print("== 场景2：房主关闭房间 ==")
    # 重新开局再关闭
    ready_and_start(pages)
    for _ in range(4):
        for pg in pages: pg.evaluate(AUTO)
        pages[0].wait_for_timeout(600)
    pages[0].click("#btnSet"); pages[0].wait_for_timeout(400)
    btns = pages[0].evaluate("() => Array.from(document.querySelectorAll('#sheet .btns button')).map(x=>x.textContent)")
    idx = btns.index("关闭房间")
    pages[0].evaluate(f"() => document.querySelectorAll('#sheet .btns button')[{idx}].click()")
    pages[0].wait_for_timeout(1200)
    after = [pg.evaluate(STATE) for pg in pages]
    check("关闭后所有人回到首页", all(s['pick'] for s in after), [s['pick'] for s in after])

    # 房间应不存在：新页面用旧房间号加入应失败
    probe = ctxs[0].new_page()
    probe.goto(URL); probe.wait_for_timeout(300)
    probe.click("#hBtnMulti"); probe.wait_for_timeout(200)
    probe.fill("#lName", "探路者"); probe.fill("#lRoomNo", room); probe.click("#lJoin")
    probe.wait_for_timeout(800)
    ps = probe.evaluate(STATE)
    check("旧房间号已失效", "不存在" in ps['err'], ps['err'])
    probe.close()

    print("== 场景3：全员中途退出后可重进 ==")
    room2 = mkjoin(p, pages[0], "甲2")
    for i in range(1, 4):
        mkjoin(p, pages[i], f"乙{i}", room2)
    ready_and_start(pages)
    for _ in range(4):
        for pg in pages: pg.evaluate(AUTO)
        pages[0].wait_for_timeout(600)

    # 全员中途退出（设置 → 回到首页）
    for pg in pages:
        pg.click("#btnSet"); pg.wait_for_timeout(250)
        pg.evaluate("() => Array.from(document.querySelectorAll('#sheet .btns button')).find(x=>x.textContent==='回到首页').click()")
        pg.wait_for_timeout(200)
    pages[0].wait_for_timeout(2500)   # 等服务端 1.5s 的自动中止

    # 用同一房间号重新进入
    back = mkjoin(p, pages[0], "甲2回来", room2)
    pages[0].wait_for_timeout(500)
    s0 = pages[0].evaluate(STATE)
    check("同一房间号能重新进入", s0['room'] and s0['roomNo'] == room2, s0)
    check("重进后是房主", s0['isHost'], s0)
    check("重进后看到「开始游戏」", s0['startVisible'], s0)
    check("重进后空座位显示「空」", "空" in s0['seatsText'] and "null" not in s0['seatsText'], s0['seatsText'])
    # 其他人也能加入
    s1 = mkjoin(p, pages[1], "乙1回来", room2)
    pages[1].wait_for_timeout(500)
    st1 = pages[1].evaluate(STATE)
    check("其他人也能重新加入", st1['room'] and st1['roomNo'] == room2, st1)

    print("== 场景4：牌局进行中退出 → 同昵称重进顶替 ==")
    room3 = mkjoin(p, pages[0], "甲3")
    for i in range(1, 4):
        mkjoin(p, pages[i], f"丙{i}", room3)
    ready_and_start(pages)
    for _ in range(3):
        for pg in pages: pg.evaluate(AUTO)
        pages[0].wait_for_timeout(600)
    st = pages[1].evaluate(STATE)
    check("玩家1 在牌局中", st['tableOn'] and st['active'], st)

    # 玩家1 退出（设置 → 回到首页）
    pages[1].click("#btnSet"); pages[1].wait_for_timeout(250)
    pages[1].evaluate("() => Array.from(document.querySelectorAll('#sheet .btns button')).find(x=>x.textContent==='回到首页').click()")
    pages[1].wait_for_timeout(500)
    st = pages[1].evaluate(STATE)
    check("退出后回到首页", st['pick'] or st['lobby'], st)

    # 同昵称重新加入同一房间 → 座位顶替回牌桌
    mkjoin(p, pages[1], "丙1", room3)
    pages[1].wait_for_timeout(1000)
    st = pages[1].evaluate(STATE)
    check("同昵称重进能回到牌局", st['tableOn'] and st['active'], st)
    check("重进后我的名字正确", st['myName'] == "丙1", st['myName'])
    check("重进后能看到自己的手牌", pages[1].evaluate("() => (G.players[0] && G.players[0].hand || []).length >= 7"),
          pages[1].evaluate("() => (G.players[0] && G.players[0].hand || []).length"))

    b.close()

print("JS 错误:", errs[:8] if errs else "无")
print("结果:", "✅ 全部通过" if ok and not errs else "❌ 有失败项")
sys.exit(0 if ok and not errs else 1)
