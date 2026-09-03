# 房间规则设置：房主在等待页可改，其他人/开局后只能看
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
  room: !document.getElementById('homeRoom').classList.contains('hide'),
  roomNo: NET.roomNo, isHost: NET.isHost, tableOn: NET.tableOn,
  base: CFG.base, unit: CFG.unit, lezi: CFG.lezi,
  allowChow: CFG.allowChow, sevenPairs: CFG.sevenPairs, lajiHu: CFG.lajiHu,
  autoKnock: CFG.autoKnock, speed: CFG.speed
})"""

def read_set_sheet(pg):
    """读取设置面板里「底」这一项的按钮/文本"""
    return pg.evaluate("""() => {
      const el = document.getElementById('sgBase');
      if (!el) return null;
      const on = el.querySelector('.on');
      return { html: el.innerHTML, on: on ? on.textContent : null, hasButtons: !!el.querySelector('button') };
    }""")

def close_sheet(pg):
    """关闭设置面板（若已关闭则跳过）。用 JS 调用而非真实点击，避免面板高度变化导致点不到"""
    if pg.evaluate("() => !document.getElementById('mask').classList.contains('hide')"):
        pg.evaluate("() => { if (typeof closeSet === 'function') closeSet(); else closeSheet(); }")
    pg.wait_for_timeout(200)

def wait_room(pg):
    for _ in range(30):
        if pg.evaluate("() => document.getElementById('home').classList.contains('hide')"): return True
        pg.wait_for_timeout(200)
    return False

def mkjoin(pg, name, room_no=None):
    pg.goto(URL); pg.wait_for_timeout(300)
    pg.click("#hBtnMulti"); pg.wait_for_timeout(200)
    pg.fill("#lName", name)
    if room_no is None:
        pg.click("#lCreate")
    else:
        pg.fill("#lRoomNo", room_no); pg.click("#lJoin")
    wait_room(pg)
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

    room = mkjoin(pages[0], "房主规")
    mkjoin(pages[1], "玩家规", room)
    pages[0].wait_for_timeout(500)

    print("== 场景1：房主改规则（草稿 → 确定提交），其他人同步看到 ==")
    # 检查默认规则
    st0 = pages[0].evaluate(STATE)
    check("默认底为 2", st0['base'] == 2, st0['base'])

    # 房主点游戏设置，点「底 3」（此时是草稿，未提交）
    pages[0].click("#rCfg"); pages[0].wait_for_timeout(500)
    pages[0].evaluate("() => document.getElementById('sgBase').querySelector('button:nth-child(3)').click()")
    pages[0].wait_for_timeout(300)
    st0 = pages[0].evaluate(STATE)
    check("点底=3 后（草稿未提交）底仍为 2", st0['base'] == 2, st0['base'])

    # 清空玩家1 的 toast，方便断言「房主修改了游戏设置」
    pages[1].evaluate("() => document.querySelectorAll('#toast .tst').forEach(t => t.remove())")
    # 房主点「确定」提交
    pages[0].evaluate("() => commitCfg()")
    pages[0].wait_for_timeout(700)
    st0 = pages[0].evaluate(STATE)
    check("确定后底变为 3", st0['base'] == 3, st0['base'])
    tip = pages[1].evaluate("() => { const t = document.querySelector('#toast .tst'); return t ? t.textContent : null; }")
    check("玩家收到「房主修改了游戏设置」提示", tip == '房主修改了游戏设置', tip)

    # 玩家1 打开设置面板查看
    pages[1].click("#rCfg"); pages[1].wait_for_timeout(500)
    s1 = read_set_sheet(pages[1])
    check("非房主打开后底显示 3", s1 and s1['on'] == '3', s1)
    check("非房主只读（没有 button）", s1 and not s1['hasButtons'], s1)
    close_sheet(pages[1])

    print("== 场景2：开局后规则锁定，只能看不能改 ==")
    pages[1].click("#rReady"); pages[1].wait_for_timeout(300)
    pages[0].click("#rStart"); pages[0].wait_for_timeout(2500)
    check("已进入牌局", pages[0].evaluate("() => NET.tableOn"), pages[0].evaluate(STATE))

    # 开局后房主再打开设置
    pages[0].click("#btnSet"); pages[0].wait_for_timeout(500)
    sh0 = read_set_sheet(pages[0])
    check("开局后房主查看底仍为 3", sh0 and sh0['on'] == '3', sh0)
    check("开局后房主也不能改底（没有 button）", sh0 and not sh0['hasButtons'], sh0)
    close_sheet(pages[0])

    # 玩家1 打开查看
    pages[1].click("#btnSet"); pages[1].wait_for_timeout(500)
    sh1 = read_set_sheet(pages[1])
    check("开局后非房主查看底为 3", sh1 and sh1['on'] == '3', sh1)
    check("开局后非房主也不能改", sh1 and not sh1['hasButtons'], sh1)
    close_sheet(pages[1]); close_sheet(pages[0])

    print("== 场景3：房主移出玩家 ==")
    # 房间里再拉一个人进来（此时牌局中，移出应被拒绝）
    before = pages[0].evaluate("() => (NET.players||[]).map(p => p ? p.name : null)")
    check("移出前房间里有 2 个真人", before.count('玩家规') == 1, before)
    # 牌局中移出应被服务端拒绝（座位不该清空）
    pages[0].evaluate("() => netKick(1)")
    pages[0].wait_for_timeout(800)
    after = pages[0].evaluate("() => (NET.players||[]).map(p => p ? p.name : null)")
    check("牌局中移出不生效（玩家仍在）", after.count('玩家规') == 1, after)

    # 回到房间等待页后房主才能移出
    pages[0].evaluate("() => netEndGame()")
    pages[0].wait_for_timeout(1200)
    check("结束本局后回到房间等待页", pages[0].evaluate("() => !NET.tableOn"))
    pages[0].evaluate("() => netKick(1)")
    pages[0].wait_for_timeout(1000)
    after2 = pages[0].evaluate("() => (NET.players||[]).map(p => p ? p.name : null)")
    check("等待页房主移出生效（座位清空）", '玩家规' not in after2, after2)
    check("被移出者收到提示并被踢回首页",
          pages[1].evaluate("() => NET.roomNo === 0 || NET.roomNo === null || !NET.roomNo"),
          pages[1].evaluate("() => NET.roomNo"))

    print("== 场景4：非房主看不到移出按钮 ==")
    mkjoin(pages[1], "新玩家", pages[0].evaluate("() => NET.roomNo"))
    pages[1].wait_for_timeout(600)
    kickBtns = pages[1].evaluate("() => document.querySelectorAll('.rSeatKick').length")
    check("非房主看不到移出按钮", kickBtns == 0, kickBtns)
    kickBtnsHost = pages[0].evaluate("() => document.querySelectorAll('.rSeatKick').length")
    check("房主看得到移出按钮", kickBtnsHost >= 1, kickBtnsHost)

    b.close()

print("JS 错误:", errs[:8] if errs else "无")
print("结果:", "✅ 全部通过" if ok and not errs else "❌ 有失败项")
sys.exit(0 if ok and not errs else 1)
