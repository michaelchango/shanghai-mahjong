# m32：联机多局 gname 端到端（v1.2.14 问题2排查）
# 单人房（房主+3bot）→ 打完一局 → 准备下一局 → 验证顶部 gname 变为「第 2 局」
import sys, time
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8099/'

def play_discard(page):
    # 轮到我出牌：点第一张手牌两次（选中→打出）
    page.evaluate("""() => {
      const t = document.querySelector('#hand .tile');
      if (t){ t.click(); t.click(); }
    }""")

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    page = b.new_page(viewport={'width': 390, 'height': 780})
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL, wait_until='domcontentloaded')
    page.wait_for_timeout(500)

    # 建房（单人房：房主 + 3 机器人）：真实按钮驱动
    page.click('#hBtnMulti')
    page.wait_for_timeout(400)
    page.fill('#lName', '房主测试')
    page.click('#lCreate')                       # 连接服务器并建房
    page.wait_for_selector('#rStart', timeout=5000)
    page.click('#rStart')                        # 房主开始游戏（空位自动补机器人）
    page.wait_for_timeout(1200)
    print('已建房开局，gname 初始:', page.inner_text('#gname').strip())

    t0 = time.time()
    hand1_done = False
    last_dbg = 0
    while time.time() - t0 < 240:
        # 轮到房主出牌
        is_my_discard = page.evaluate("() => !!(PEND && PEND.kind === 'discard' && document.querySelector('#hand .tile'))")
        if is_my_discard:
            play_discard(page)
            page.wait_for_timeout(150)
        # 结算弹窗出现（含「准备下一局」）
        sheet_has_ready = page.evaluate("() => { const s = document.getElementById('sheet'); return !!s && s.textContent.includes('准备下一局'); }")
        if sheet_has_ready and not hand1_done:
            hand1_done = True
            print('第一局结算，当前 gname:', page.inner_text('#gname').strip())
            page.evaluate("() => { const b=[...document.querySelectorAll('#sheet button')].find(x=>x.textContent.includes('准备下一局')); if(b) b.click(); }")
            page.wait_for_timeout(800)
        # 新局已开始（gname 变化）
        g = page.inner_text('#gname').strip()
        if hand1_done and g != '第 1 局':
            print('第二局 gname:', g)
            break
        # 诊断打印（每 10 秒）
        if time.time() - t0 - last_dbg > 10:
            last_dbg = time.time() - t0
            st = page.evaluate("() => ({ pend: PEND ? PEND.kind : null, myHand: document.querySelectorAll('#hand .tile').length, sheet: document.getElementById('sheet').textContent.slice(0, 40) })")
            print(f'  [{int(time.time()-t0)}s] pend={st["pend"]} 手牌数={st["myHand"]} sheet={st["sheet"]!r}')
        page.wait_for_timeout(200)

    final_g = page.inner_text('#gname').strip()
    ok = hand1_done and final_g == '第 2 局'
    print('最终 gname:', final_g, '| 第一局已结算:', hand1_done, '| JS错误:', errs if errs else '无')
    print('结果:', '✅ 通过' if (ok and not errs) else '❌ 失败')
    b.close()
    sys.exit(0 if (ok and not errs) else 1)
