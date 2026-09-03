# m20：起手花暂存显示 + 首次出牌补花后清除（UI 端到端，确定性）
# 复用 m18 的发现：浏览器内 G / render / 引擎函数均为全局可访问
import sys
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8099/'

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    page = b.new_page(viewport={'width': 390, 'height': 780})
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL, wait_until='domcontentloaded')
    page.wait_for_timeout(500)
    page.click('#hBtnSolo'); page.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }")
    page.wait_for_timeout(400)

    # 停掉主循环，避免与补花竞态；直接给四家塞起手花，模拟 deal 后的 pendingFlowers
    page.evaluate("""() => {
      G.abort = true; G.running = false;
      for (const pl of G.players) pl.pendingFlowers = [100, 101, 108];  // 春 夏 中
      render();
    }""")
    page.wait_for_timeout(150)
    pending_before = page.query_selector_all('.tile.pending')

    # 模拟「首次出牌补花」：花移入正式 flowers 区，pending 清空
    page.evaluate("""() => {
      for (const pl of G.players){ pl.flowers = pl.flowers.concat(pl.pendingFlowers); pl.pendingFlowers = []; }
      render();
    }""")
    page.wait_for_timeout(150)
    pending_after = page.query_selector_all('.tile.pending')

    ok1 = len(pending_before) > 0          # 起手花以虚线样式暂显
    ok2 = len(pending_after) == 0          # 补花后暂存区清空
    print('pending_before:', len(pending_before), 'pending_after:', len(pending_after))
    print('结果:', '✅ 通过' if (ok1 and ok2 and not errs) else '❌ 失败',
          '| 暂存显示:', ok1, '| 补花后清除:', ok2, '| JS错误:', errs if errs else '无')
    b.close()
    sys.exit(0 if (ok1 and ok2 and not errs) else 1)
