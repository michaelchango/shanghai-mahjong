# 断线自动重连验证
#   场景A  连接被切断（模拟后台被系统回收 / 网络切换）→ 自动退避重连 → 回到原牌局继续打
#   场景B  浏览器离线一段时间（半开连接，回前台可能仍显示已连接）→ 回到前台探活 → 强制重连恢复
import sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
errs = []
ok = True

STATE = """() => ({
  room:  !document.getElementById('homeRoom').classList.contains('hide'),
  pick:  !document.getElementById('homePick').classList.contains('hide'),
  homeHidden: document.getElementById('home').classList.contains('hide'),
  roomNo: NET.roomNo, isHost: NET.isHost, mySeat: NET.mySeat,
  tableOn: NET.tableOn, active: NET.active,
  rs: NET.ws ? NET.ws.readyState : -1,       // 1=OPEN
  lastMsgAt: NET.lastMsgAt, tries: NET.reconnectTries, reconnecting: NET.reconnecting,
  handCount: (G.players[0] && G.players[0].hand) ? G.players[0].hand.length : 0,
  myName: (G.players && G.players[0] && G.players[0].name) || null
})"""

AUTO = """() => {
  const b = Array.from(document.querySelectorAll('#acts button'));
  const by = t => b.find(x => x.textContent === t);
  if (by('准备下一局')) { by('准备下一局').click(); return; }
  if (by('下一局')) { by('下一局').click(); return; }
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

def mkjoin(pg, name, room_no=None):
    pg.goto(URL); pg.wait_for_timeout(300)
    pg.click("#hBtnMulti"); pg.wait_for_timeout(200)
    pg.fill("#lName", name)
    if room_no is None:
        pg.click("#lCreate")
    else:
        pg.fill("#lRoomNo", room_no); pg.click("#lJoin")
    pg.wait_for_timeout(700)
    return pg.evaluate("() => NET.roomNo")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-dev-shm-usage", "--no-sandbox"])
    ctxs, pages = [], []
    for i in range(2):
        ctx = b.new_context(viewport={"width": 390, "height": 780})
        pg = ctx.new_page()
        pg.on("dialog", lambda d: d.accept())
        pg.on("pageerror", lambda e, n=i: errs.append(f"P{n} PAGEERROR: " + str(e)))
        pg.on("console", lambda m, n=i: errs.append(f"P{n} CONSOLE: " + m.text) if m.type == "error" else None)
        ctxs.append(ctx); pages.append(pg)

    room = mkjoin(pages[0], "重连房主")
    mkjoin(pages[1], "重连玩家", room)
    pages[1].click("#rReady"); pages[1].wait_for_timeout(300)
    pages[0].click("#rStart"); pages[0].wait_for_timeout(2500)
    for _ in range(3):
        for pg in pages: pg.evaluate(AUTO)
        pages[0].wait_for_timeout(600)

    base = pages[1].evaluate(STATE)
    check("两人都已开局", base['tableOn'] and base['active'], base)

    print("== 场景A：连接被切断 → 自动重连 ==")
    before_seat = base['mySeat']
    pages[1].evaluate("() => NET.ws.close()")          # 只断连接，不离开对局
    pages[1].wait_for_timeout(600)
    mid = pages[1].evaluate(STATE)
    check("断开后仍处于对局中（未被踢回首页）", mid['active'] or mid['tableOn'], mid)
    # 退避重连最长 6s/次，给 12s 观察窗口
    got = None
    for _ in range(12):
        pages[0].evaluate(AUTO); pages[1].wait_for_timeout(1000)
        got = pages[1].evaluate(STATE)
        if got['rs'] == 1 and got['tableOn'] and got['active']: break
    check("自动重连成功（连接已 OPEN）", got['rs'] == 1, got)
    check("重连后回到同一房间", got['roomNo'] == room, got)
    check("重连后座位未变", got['mySeat'] == before_seat, (before_seat, got['mySeat']))
    check("重连后能看到自己的手牌", got['handCount'] >= 7, got['handCount'])
    check("重连后名字正确", got['myName'] == "重连玩家", got['myName'])
    check("重连计数已归零", got['tries'] == 0 and not got['reconnecting'], got)

    print("== 场景B：浏览器离线（半开连接）→ 回前台探活重连 ==")
    cdp = ctxs[1].new_cdp_session(pages[1])
    cdp.send("Network.enable")
    cdp.send("Network.emulateNetworkConditions", {
        "offline": True, "latency": 0, "downloadThroughput": 0, "uploadThroughput": 0
    })
    pages[1].wait_for_timeout(6000)                     # 离线 6s：期间重连尝试都会失败
    cdp.send("Network.emulateNetworkConditions", {
        "offline": False, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1
    })
    # 回到前台：监听器先发 ping 探活，3 秒内无回应则强制断开重连
    pages[1].evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    got2 = None
    for _ in range(15):
        pages[0].evaluate(AUTO); pages[1].wait_for_timeout(1000)
        got2 = pages[1].evaluate(STATE)
        if got2['rs'] == 1 and got2['tableOn'] and got2['active']: break
    check("回前台后连接恢复", got2['rs'] == 1, got2)
    check("回前台后仍在原牌局", got2['roomNo'] == room and got2['tableOn'], got2)
    check("回前台后还能收到服务端消息", got2['lastMsgAt'] > 0, got2)

    b.close()

print("JS 错误:", errs[:8] if errs else "无")
print("结果:", "✅ 全部通过" if ok and not errs else "❌ 有失败项")
sys.exit(0 if ok and not errs else 1)
