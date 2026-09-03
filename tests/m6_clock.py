# 全局倒计时验证（桌心统一时钟，v1.2.15 布局：倒计时在桌心圆内，纯数字）
#   1) 桌心圆内显示纯数字倒计时（无「剩余时间/轮到谁」等文字）
#   2) 四家看到的秒数一致（服务端权威，只差网络延迟）
#   3) 玩家中途退出再回来后，看到的倒计时仍与其他人一致（不再各记各的）
import sys, time, re
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
errs = []
ok = True

def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("  ✅ " if cond else "  ❌ ") + name + (("  " + str(extra)) if extra and not cond else ""))

CLOCK = """() => (document.getElementById('cdTxt') || {}).textContent || ''"""
STATE = """() => ({
  tableOn: NET.tableOn, active: NET.active, roomNo: NET.roomNo,
  pick: !document.getElementById('homePick').classList.contains('hide')
})"""

def clocks(pages):
    return [pg.evaluate(CLOCK) for pg in pages]

def secs(pages):
    """四家桌心秒数（None = 该时刻无人决策）"""
    out = []
    for pg in pages:
        m = re.search(r'(\d+)', pg.evaluate(CLOCK) or '')
        out.append(int(m.group(1)) if m else None)
    return out

def wait_all_clocks(pages, timeout=25):
    """等到四家桌心同时有倒计时，返回那一组秒数"""
    end = time.time() + timeout
    best = None
    while time.time() < end:
        vals = secs(pages)
        if all(v is not None for v in vals):
            return vals
        if any(v is not None for v in vals):
            best = vals
        time.sleep(0.2)
    return best

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
    pages = []
    for i in range(4):
        ctx = b.new_context(viewport={"width": 390, "height": 780})
        pg = ctx.new_page()
        pg.on("dialog", lambda d: d.accept())
        pg.on("pageerror", lambda e, n=i: errs.append(f"P{n} PAGEERROR: " + str(e)))
        pg.on("console", lambda m, n=i: errs.append(f"P{n} CONSOLE: " + m.text) if m.type == "error" else None)
        pages.append(pg)

    room = mkjoin(pages[0], "时钟房主")
    for i, nm in [(1, "时钟乙"), (2, "时钟丙"), (3, "时钟丁")]:
        mkjoin(pages[i], nm, room)
    for pg in pages[1:]:
        pg.click("#rReady"); pg.wait_for_timeout(150)
    pages[0].wait_for_timeout(300)
    pages[0].click("#rStart"); pages[0].wait_for_timeout(3000)

    print("== 场景1：桌心显示全局倒计时 ==")
    vals = wait_all_clocks(pages)
    print("    四家桌心:", clocks(pages), "→", vals)
    check("四家桌心都在显示倒计时", vals is not None and all(v is not None for v in vals), vals)
    if vals and all(v is not None for v in vals):
        check("四家秒数一致（误差 ≤1 秒）", max(vals) - min(vals) <= 1, vals)
        check("圆心是纯数字倒计时", all(c.strip().isdigit() for c in clocks(pages)), clocks(pages))
        check("无「剩余时间/轮到」文字", all(("剩余时间" not in c and "轮到" not in c) for c in clocks(pages)), clocks(pages))
        check("「轮到谁」未出现在桌心", all("轮到" not in (pg.evaluate("() => document.getElementById('diceLine').textContent")) for pg in pages), None)
        check("秒数在合理区间（1~15）", all(1 <= v <= 15 for v in vals), vals)

    # 倒计时应在递减
    first = secs(pages)
    pages[0].wait_for_timeout(2000)
    later = secs(pages)
    dec = [a - b for a, b in zip(first, later) if a is not None and b is not None]
    check("倒计时在走（2 秒后变小）", bool(dec) and all(d >= 1 for d in dec), (first, later))

    print("== 场景2：中途退出再回来，倒计时仍与大家一致 ==")
    # 丙（P2）牌局中退出 → 同昵称重新加入 → 顶替回原座位
    pages[2].click("#btnSet"); pages[2].wait_for_timeout(250)
    pages[2].evaluate("() => Array.from(document.querySelectorAll('#sheet .btns button')).find(x=>x.textContent==='回到首页').click()")
    pages[2].wait_for_timeout(800)
    st = pages[2].evaluate(STATE)
    check("丙退出后回到首页", st['pick'], st)
    mkjoin(pages[2], "时钟丙", room)
    pages[2].wait_for_timeout(1200)
    st = pages[2].evaluate(STATE)
    check("丙重进回到牌局", st['tableOn'] and st['active'], st)

    vals2 = wait_all_clocks(pages)
    print("    四家桌心:", clocks(pages), "→", vals2)
    check("重进后四家仍同时显示倒计时", vals2 is not None and all(v is not None for v in vals2), vals2)
    if vals2 and all(v is not None for v in vals2):
        check("重进后秒数与大家一致（误差 ≤1 秒）", max(vals2) - min(vals2) <= 1, vals2)

    b.close()

print("JS 错误:", errs[:8] if errs else "无")
print("结果:", "✅ 全部通过" if ok and not errs else "❌ 有失败项")
sys.exit(0 if ok and not errs else 1)
