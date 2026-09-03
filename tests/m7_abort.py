# 返回首页后开新局不应冒出上一局的「流局」结算弹窗
#   场景1 单机：开局 → 设置 → 返回首页 → 再开一把单机
#   场景2 单机：对局中途（正当选牌时）返回首页 → 再开一把
#   场景3 多人：建房开局 → 设置 → 回到首页 → 重新建房开局
import sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
errs = []
ok = True

def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("  ✅ " if cond else "  ❌ ") + name + (("  " + str(extra)) if extra and not cond else ""))

STATE = """() => ({
  homeVisible: !document.getElementById('home').classList.contains('hide'),
  sheetOpen: !document.getElementById('mask').classList.contains('hide'),
  sheetText: (document.getElementById('sheet') || {}).textContent || '',
  handCount: (G.players[0] && G.players[0].hand) ? G.players[0].hand.length : 0,
  hint: (document.getElementById('hint') || {}).textContent || '',
  roomNo: NET.roomNo, tableOn: NET.tableOn
})"""

def has_ghost(st):
    """是否冒出了结算弹窗（流局/结算）"""
    return st['sheetOpen'] and ('流局' in st['sheetText'] or '结算' in st['sheetText'])

with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-dev-shm-usage", "--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 780})
    pg = ctx.new_page()
    pg.on("dialog", lambda d: d.accept())
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE: " + m.text) if m.type == "error" else None)
    pg.goto(URL); pg.wait_for_timeout(500)

    print("== 场景1：单机开局后返回首页，再开一把 ==")
    pg.click("#hBtnSolo"); pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }"); pg.wait_for_timeout(1500)
    st = pg.evaluate(STATE)
    check("单机已开局", not st['homeVisible'] and st['handCount'] in (13, 14), st)
    # 设置 → 返回首页
    pg.click("#btnSet"); pg.wait_for_timeout(400)
    pg.evaluate("() => Array.from(document.querySelectorAll('#sheet .btns button')).find(x=>x.textContent==='返回首页').click()")
    pg.wait_for_timeout(600)
    st = pg.evaluate(STATE)
    check("已回到首页", st['homeVisible'], st)
    # 再开一把
    pg.click("#hBtnSolo"); pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }"); pg.wait_for_timeout(2500)
    st = pg.evaluate(STATE)
    check("新局没有冒出上一局的结算弹窗", not has_ghost(st), (st['sheetOpen'], st['sheetText'][:60]))
    check("新局手牌正常", st['handCount'] in (13, 14), st['handCount'])
    check("新局没有卡在结算态", '流局' not in st['hint'], st['hint'])

    print("== 场景2：正当选牌（轮到我出牌）时返回首页 ==")
    # 等到确实轮到玩家出牌
    got = False
    for _ in range(20):
        st = pg.evaluate(STATE)
        if '点击一张牌' in st['hint']: got = True; break
        pg.wait_for_timeout(300)
    check("已等到轮到玩家出牌", got, st['hint'])
    pg.click("#btnSet"); pg.wait_for_timeout(300)
    pg.evaluate("() => Array.from(document.querySelectorAll('#sheet .btns button')).find(x=>x.textContent==='返回首页').click()")
    pg.wait_for_timeout(800)
    pg.click("#hBtnSolo"); pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }"); pg.wait_for_timeout(2500)
    st = pg.evaluate(STATE)
    check("选牌中退出再开局，没有幽灵弹窗", not has_ghost(st), (st['sheetOpen'], st['sheetText'][:60]))
    check("新局手牌正常", st['handCount'] in (13, 14), st['handCount'])

    print("== 场景3：多人牌局中回到首页，再重新建房 ==")
    pg.click("#btnSet"); pg.wait_for_timeout(300)
    pg.evaluate("() => Array.from(document.querySelectorAll('#sheet .btns button')).find(x=>x.textContent==='返回首页').click()")
    pg.wait_for_timeout(500)
    pg.click("#hBtnMulti"); pg.wait_for_timeout(300)
    pg.fill("#lName", "甲")
    pg.click("#lCreate"); pg.wait_for_timeout(1200)
    r1 = pg.evaluate("() => NET.roomNo")
    pg.click("#rStart"); pg.wait_for_timeout(2500)
    st = pg.evaluate(STATE)
    check("多人已开局", st['tableOn'], st)
    pg.click("#btnSet"); pg.wait_for_timeout(400)
    pg.evaluate("() => Array.from(document.querySelectorAll('#sheet .btns button')).find(x=>x.textContent==='回到首页').click()")
    pg.wait_for_timeout(1000)
    st = pg.evaluate(STATE)
    check("已回到首页", st['homeVisible'], st)
    # 重新建房开局
    pg.click("#hBtnMulti"); pg.wait_for_timeout(300)
    pg.fill("#lName", "乙")
    pg.click("#lCreate"); pg.wait_for_timeout(1200)
    r2 = pg.evaluate("() => NET.roomNo")
    pg.click("#rStart"); pg.wait_for_timeout(2500)
    st = pg.evaluate(STATE)
    check("新房间号与旧的不同", r2 != r1, (r1, r2))
    check("新房间开局没有幽灵结算弹窗", not has_ghost(st), (st['sheetOpen'], st['sheetText'][:60]))

    b.close()

print("JS 错误:", errs[:8] if errs else "无")
print("结果:", "✅ 全部通过" if ok and not errs else "❌ 有失败项")
sys.exit(0 if ok and not errs else 1)
