# m29：加杠提示文案不再出现 NaN（v1.2.13）
# 摸牌后 / 出牌前 两条路径都验证
import sys
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8099/'

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    page = b.new_page(viewport={'width': 390, 'height': 780})
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL, wait_until='domcontentloaded')
    page.wait_for_timeout(400)
    page.click('#hBtnSolo'); page.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }")
    page.wait_for_timeout(1200)

    # 摸牌后路径：payload 含 tile=0（一萬）、source='draw'
    h1 = page.evaluate("""() => {
      PEND = { kind: 'selfkong', payload: { options: [{k:'chakan', tile:0}], tile: 0, source: 'draw' } };
      renderActs();
      return document.getElementById('hint').textContent;
    }""")

    # 出牌前路径：payload 含 tile=0、source='preDiscard'
    h2 = page.evaluate("""() => {
      PEND = { kind: 'selfkong', payload: { options: [{k:'chakan', tile:0}], tile: 0, source: 'preDiscard' } };
      renderActs();
      return document.getElementById('hint').textContent;
    }""")

    print('摸牌后 hint:', h1)
    print('出牌前 hint:', h2)
    ok1 = 'NaN' not in h1 and '一萬' in h1 and '摸到' in h1
    ok2 = 'NaN' not in h2 and '一萬' in h2 and '你有' in h2
    print('结果:', '✅ 通过' if (ok1 and ok2 and not errs) else '❌ 失败',
          '| 摸牌路径:', ok1, '| 出牌前路径:', ok2, '| JS错误:', errs if errs else '无')
    b.close()
    sys.exit(0 if (ok1 and ok2 and not errs) else 1)