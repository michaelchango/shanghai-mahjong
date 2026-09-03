# 烟测：首页渲染 → 单机入口回归（发牌/出牌按钮正常）
import sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
errs = []

with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-dev-shm-usage", "--no-sandbox"])
    pg = b.new_page(viewport={"width": 390, "height": 780})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(600)

    # 1. 首页可见？三个面板应只显示「模式选择」
    home_visible = pg.evaluate("() => !document.getElementById('home').classList.contains('hide')")
    title = pg.evaluate("() => document.querySelector('.hTitle').textContent")
    panels = pg.evaluate("""() => ({
        pick: !document.getElementById('homePick').classList.contains('hide'),
        lobby: !document.getElementById('homeLobby').classList.contains('hide'),
        room:  !document.getElementById('homeRoom').classList.contains('hide')
    })""")
    btns = pg.evaluate("() => ['hBtnSolo','hBtnMulti'].map(i => !!document.getElementById(i).offsetParent)")
    print("首页可见:", home_visible, "| 面板状态:", panels, "| 标题:", title, "| 两个入口按钮:", btns)
    assert panels == {'pick': True, 'lobby': False, 'room': False}, "首页应只显示模式选择面板"
    pg.screenshot(path="/tmp/mjtest/home.png")

    # 2. 点「多人对战」应看到大厅（昵称/服务器/房间号）
    pg.click("#hBtnMulti")
    pg.wait_for_timeout(300)
    lobby = pg.evaluate("""() => ({
        lobbyVisible: !document.getElementById('homeLobby').classList.contains('hide'),
        pickVisible: !document.getElementById('homePick').classList.contains('hide'),
        roomVisible: !document.getElementById('homeRoom').classList.contains('hide'),
        hasName: !!document.getElementById('lName'),
        hasServer: !!document.getElementById('lServer'),
        serverPh: document.getElementById('lServer').placeholder
    })""")
    print("大厅:", lobby)
    assert lobby['lobbyVisible'] and not lobby['pickVisible'] and not lobby['roomVisible'], "大厅应只显示多人大厅面板"
    pg.screenshot(path="/tmp/mjtest/lobby.png")

    # 3. 返回首页 → 点单机 → 牌桌正常（发 13+1 张、操作按钮/提示出现）
    pg.click("#lBack")
    pg.wait_for_timeout(200)
    pg.click("#hBtnSolo"); pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }")
    pg.wait_for_timeout(1500)
    solo = pg.evaluate("""() => ({
        homeHidden: document.getElementById('home').classList.contains('hide'),
        handCount: document.querySelectorAll('#hand .tile').length,
        wallLeft: document.getElementById('wallTxt').textContent,
        roundinfo: document.getElementById('roundinfo').textContent,
        actBtns: Array.from(document.querySelectorAll('#acts button')).map(b => b.textContent)
    })""")
    print("单机:", solo)
    pg.screenshot(path="/tmp/mjtest/solo.png")

    # 4. 设置面板有「返回首页」
    pg.click("#btnSet")
    pg.wait_for_timeout(300)
    setBtns = pg.evaluate("() => Array.from(document.querySelectorAll('#sheet .btns button')).map(b => b.textContent)")
    print("设置面板按钮:", setBtns)
    pg.screenshot(path="/tmp/mjtest/set.png")

    b.close()

print("JS 错误:", errs if errs else "无")
sys.exit(1 if errs else 0)
