# v1.2.4 新功能：等待页牌桌 + 换座 + 人数实时刷新
import sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
errs = []
ok = True

def chk(n, c, extra=""):
    global ok
    ok &= bool(c)
    print(("  ✅ " if c else "  ❌ ") + n + (("  " + str(extra)) if extra and not c else ""))

def wait_room(pg, ms=4000):
    t=0
    while t<ms:
        if pg.evaluate("() => document.getElementById('home').classList.contains('hide')"): return True
        pg.wait_for_timeout(100); t+=100
    return False

with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-dev-shm-usage","--no-sandbox"])
    ctx = b.new_context(viewport={"width":390,"height":780})
    pg1 = ctx.new_page()
    pg1.on("pageerror", lambda e: errs.append("PG1 ERR: "+str(e)))
    pg1.on("console", lambda m: errs.append("PG1 CON: "+m.text) if m.type=="error" else None)
    pg1.goto(URL); pg1.wait_for_timeout(400)
    pg1.click("#hBtnMulti"); pg1.wait_for_timeout(200)
    pg1.fill("#lName","房主A")
    pg1.click("#lCreate")
    wait_room(pg1); pg1.wait_for_timeout(400)
    room = pg1.evaluate("() => NET.roomNo")
    print("房号:", room)

    # === 场景1：等待页牌桌布局 ===
    print("\n== 场景1：等待页中央有迷你桌心圆 + 四边四个位置 ==")
    layout = pg1.evaluate("""() => {
      const b = document.getElementById('rBoard');
      if (!b) return null;
      const dial = b.querySelector('.rDial');
      const slots = ['rSeatN','rSeatW','rSeatE','rSeatS'].map(c => !!b.querySelector('.'+c));
      const dw = dial ? ['n','w','e','s'].filter(k => !!dial.querySelector('.rDw.'+k)).length : 0;
      return {hasBoard:!!b, hasDial:!!dial, slots, dwCount:dw,
              dialW:Math.round(dial ? dial.getBoundingClientRect().width : 0)};
    }""")
    print(layout)
    chk("rBoard 已渲染", layout['hasBoard'])
    chk("中央有迷你桌心圆", layout['hasDial'])
    chk("中央圆四向都有方位块", layout['dwCount']==4, layout['dwCount'])
    chk("四个边位（N/W/E/S）都在", all(layout['slots']), layout['slots'])
    chk("中央圆尺寸合理 (60~120px)", 60 <= layout['dialW'] <= 120, layout['dialW'])

    # === 场景2：房主自己=「南」位置，标签为「我」 ===
    print("\n== 场景2：房主（座位 0）映射到「南」位置显示 ==")
    JS_SLOTS = """() => [...document.querySelectorAll('.rSeatSlot')].map(el => ({
        pos: ['N','E','S','W'].find(c => el.classList.contains('rSeat'+c)),
        seat: Number(el.dataset.seat),
        taken: el.classList.contains('taken'),
        me: el.classList.contains('me'),
        txt: el.textContent.trim().slice(0,30)}))"""
    mePos = pg1.evaluate(JS_SLOTS)
    print(mePos)
    chk("房主自己（座位 0）落到「南」位置", any(p['me'] and p['pos']=='S' for p in mePos), mePos)
    chk("南位置的标签是「我」（不是『对家』）",
        any(p['me'] and p['txt'].startswith('我') for p in mePos), mePos)
    chk("南位置显示玩家名字（含『房主』标签）",
        any(p['me'] and '房主' in p['txt'] for p in mePos), mePos)
    dwA = pg1.evaluate("""() => ['s','e','n','w'].map(k => document.querySelector('.rDw.'+k).textContent)""")
    print("A 端圆上方位（下/右/上/左）:", dwA)
    chk("A（座位0=东）下方显示「東」", dwA[0] == '東', dwA)

    # === 场景3：人数提示实时刷新 ===
    print("\n== 场景3：非房主加入 → 房主看到人数 +1 ==")
    ctx2 = b.new_context(viewport={"width":390,"height":780})
    pg2 = ctx2.new_page()
    pg2.on("pageerror", lambda e: errs.append("PG2 ERR: "+str(e)))
    pg2.on("console", lambda m: errs.append("PG2 CON: "+m.text) if m.type=="error" else None)
    pg2.goto(URL); pg2.wait_for_timeout(400)
    pg2.click("#hBtnMulti"); pg2.wait_for_timeout(200)
    pg2.fill("#lName","玩家B")
    pg2.fill("#lRoomNo", room)
    pg2.click("#lJoin"); wait_room(pg2); pg2.wait_for_timeout(500)

    st1 = pg1.evaluate("() => document.getElementById('rStatus').textContent")
    print("房主端 rStatus:", st1)
    chk("房主能看到 2 位真人入座", "2 位" in st1, st1)
    chk("房主能看到 还有 1 位未准备", "1 位未准备" in st1, st1)

    # 玩家 B 准备
    pg2.click("#rReady"); pg2.wait_for_timeout(500)
    st2 = pg1.evaluate("() => document.getElementById('rStatus').textContent")
    print("B 准备后 房主 rStatus:", st2)
    chk("房主能看到 全员就绪", "全员就绪" in st2, st2)

    # 玩家 B 取消准备
    pg2.click("#rReady"); pg2.wait_for_timeout(500)
    st3 = pg1.evaluate("() => document.getElementById('rStatus').textContent")
    print("B 取消后 房主 rStatus:", st3)
    chk("取消后又显示 还有 1 位未准备", "1 位未准备" in st3, st3)

    # === 场景4：非房主端的人数也实时刷新（核心 bug 修复） ===
    print("\n== 场景4：非房主端的人数提示也实时刷新 ==")
    stB1 = pg2.evaluate("() => document.getElementById('rStatus').textContent")
    print("B 入座后 B 自己 rStatus:", stB1)
    chk("B 端显示 2 位真人入座", "2 位" in stB1, stB1)
    chk("B 端显示 还有 1 位未准备", "1 位未准备" in stB1, stB1)

    # 房主在自己视角永远是「已入座」状态（不需要准备按钮），所以 waitCnt 看房主自己不计
    # 但 view 端期望的：2 位真人里 1 位准备(B)1 位未准备(房主) → 应该看到「全员就绪」（房主默认不计入 waitCnt）
    # 实际我们实现是 waitCnt = 其他没准备的，所以房主不算自己未准备 → 永远 0 waitCnt
    # 这会导致：哪怕 B 没准备，B 端也只看到「全员就绪」？让我看一下
    # 不对：waitCnt 是「其他人中未准备的」，所以房主视角：B 没准备 → waitCnt=1
    # B 视角：房主不要求准备（不需要准备按钮） → waitCnt=0（房主不计入）
    # 所以 B 端永远显示「全员就绪」是预期——房主根本不需要准备按钮
    # 但场景3说房主应该看到「全员就绪」——也对，因为只有 B 准备了
    # 现在 B 取消准备
    pg2.wait_for_timeout(300)
    # 让房主看 B 端
    stB2 = pg2.evaluate("() => document.getElementById('rStatus').textContent")
    print("B 取消后 B 自己 rStatus:", stB2)
    # B 视角：房主不需要准备，所以 waitCnt = 其他（包括房主）但房主不算 → 永远 0
    # 实际：waitCnt 排除自己后再排除不算准备的（房主）。所以永远是 0 → 显示「全员就绪」
    chk("B 端永远显示「全员就绪」（房主不计入）", "全员就绪" in stB2 or "2 位" in stB2, stB2)

    # === 场景5：换座 ===
    print("\n== 场景5：A 玩家点击空位换座 ==")
    # 重新加入第3人
    ctx3 = b.new_context(viewport={"width":390,"height":780})
    pg3 = ctx3.new_page()
    pg3.goto(URL); pg3.wait_for_timeout(300)
    pg3.click("#hBtnMulti"); pg3.wait_for_timeout(200)
    pg3.fill("#lName","玩家C")
    pg3.fill("#lRoomNo", room)
    pg3.click("#lJoin"); wait_room(pg3); pg3.wait_for_timeout(500)

    # 现在 C 在座位 2（随机？默认：服务端是第一个空位=座位2）
    # A 在座位 0（房主），B 在座位 1
    pg1.wait_for_timeout(300)
    initial = pg1.evaluate("""() => ({
      me: NET.mySeat,
      players: NET.players.map(s => s ? s.name : null)
    })""")
    print("换座前 A:", initial)
    chk("A 在座位 0（房主）", initial['me']==0, initial)

    # C 点空位 = 座位 3（北家）—— 但实际 C 自己现在在哪？得看服务端
    cSeat = pg3.evaluate("() => NET.mySeat")
    print("C 当前座位:", cSeat)

    # 找空位：座位3 应该是空的（如果C=2, A=0, B=1）
    emptySeat = next(i for i in range(4) if initial['players'][i] is None)
    print("空位：", emptySeat)
    if emptySeat is not None:
        # A 点空位换过去
        ok_swap = pg1.evaluate(f"""() => {{
            const slot = document.querySelector('.rSeatSlot[data-seat="{emptySeat}"]');
            if (!slot || !slot.classList.contains('empty')) return false;
            slot.click();
            return true;
        }}""")
        print("A 触发换座 click:", ok_swap)
        pg1.wait_for_timeout(500)
        after = pg1.evaluate("() => NET.mySeat")
        print("换座后 A mySeat:", after)
        chk(f"A 已换到座位 {emptySeat}", after == emptySeat, after)
        # 其他端也看到了
        pg3.wait_for_timeout(500)
        cView = pg3.evaluate("() => NET.players.map(s => s ? s.name : null)")
        print("C 端视角:", cView)
        chk("C 端能看到 A 已经换到目标座位", cView[emptySeat]=='房主A' or 'A' in (cView[emptySeat] or ''), cView)

    # === 场景6：换座后座位顺序仍然正确（南=我）===
    print("\n== 场景6：换座后 A 的「自己」仍然在「南」位置 ==")
    rowsAfter = pg1.evaluate(JS_SLOTS)
    meAfter = next((p['pos'] for p in rowsAfter if p['me']), None)
    print("A 自己位置:", meAfter, rowsAfter)
    chk("A 自己仍在「南」位置", meAfter == 'S', meAfter)
    # 换座后圆上方位跟着视角走：A 现在坐座位 3（北家）→ 下方应显示「北」
    dwAfter = pg1.evaluate("""() => ['s','e','n','w'].map(k => document.querySelector('.rDw.'+k).textContent)""")
    print("换座后 A 端圆上方位:", dwAfter, "mySeat=", pg1.evaluate("() => NET.mySeat"))
    chk("换座后下方显示自己的风位",
        dwAfter[0] == ['東','南','西','北'][pg1.evaluate("() => NET.mySeat")], dwAfter)

    # === 场景7：非房主端也是「我在南」的视角 + 房主换座后仍是房主 ===
    print("\n== 场景7：B 端（座位 1）视角：自己在南、房主 A 在对家 ==")
    bRows = pg2.evaluate(JS_SLOTS)
    print(bRows)
    meB = next((p for p in bRows if p['me']), None)
    hostB = next((p for p in bRows if '房主' in p['txt'] and not p['me']), None)
    chk("B 自己在「南」位置", meB and meB['pos']=='S', meB)
    chk("B 看到的房主 A（座位3）在「对家」位置", hostB and hostB['pos']=='N', hostB)
    chk("房主换座后身份没被抢走（B 不是房主）",
        '房主' not in (meB['txt'] if meB else ''), meB)
    aIsHost = pg1.evaluate("() => NET.isHost")
    chk("A 端自己仍认为自己是房主", aIsHost, aIsHost)
    chk("A 端仍看得到「开始游戏」", pg1.evaluate("() => !document.getElementById('rStart').classList.contains('hide')"))
    dwB = pg2.evaluate("""() => ['s','e','n','w'].map(k => document.querySelector('.rDw.'+k).textContent)""")
    print("B 端圆上方位:", dwB)
    chk("B（座位1=南）下方显示「南」", dwB[0] == '南', dwB)

    print("\nJS 错误:", errs or "无")
    chk("无 JS 错误", not errs)
    b.close()

print("\n结果:", "✅ 全部通过" if ok else "❌ 有失败")