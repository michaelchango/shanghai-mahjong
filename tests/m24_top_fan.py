# m24：顶部「番 / 单份」实时计算（v1.2.11）
# 开局后 mFan 应显示数字（当前牌型番），不再固定为 0 / '—'；mScore 同步为数字
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
    page.wait_for_timeout(1500)

    fan = page.inner_text('#mFan').strip()
    score = page.inner_text('#mScore').strip()

    fan_num = fan not in ('', '—', '0') and fan.isdigit()
    score_num = score not in ('', '—', '0') and score.isdigit()
    print('mFan:', repr(fan), '| mScore:', repr(score), '| js_errs:', errs if errs else '无')
    print('结果:', '✅ 通过' if (fan_num and score_num and not errs) else '❌ 失败',
          '| 番实时数字:', fan_num, '| 单份实时数字:', score_num)
    b.close()
    sys.exit(0 if (fan_num and score_num and not errs) else 1)
