# m28：手牌记录模块固定占位（v1.2.13）
# log 固定 3 行高度（39px），内容少时空白留在模块内，桌心圆位置不漂移
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

    def measure():
        return page.evaluate("""() => ({
          log: document.getElementById('log').offsetHeight,
          logDisplay: getComputedStyle(document.getElementById('log')).display,
          dial: document.querySelector('.dial').getBoundingClientRect().top
        })""")
    m1 = measure()

    # 模拟打牌 5 手：直接调 logMsg
    page.evaluate("""() => {
      G.abort = true; G.running = false;
      G.logs = [];
      for (let i = 0; i < 5; i++) logMsg('测试' + i + '手牌记录行');
    }""")
    page.wait_for_timeout(150)
    m2 = measure()

    # 模拟更多条（>3 条触发 while 测试）
    page.evaluate("""() => {
      G.logs = [];
      for (let i = 0; i < 12; i++) logMsg('手' + i);
    }""")
    page.wait_for_timeout(150)
    m3 = measure()

    # 同一窗口下：log 高度不随条数变化（内容多少不挤占），桌心圆稳定
    log_stable = m1['log'] == m2['log'] == m3['log']
    dial_stable = abs(m1['dial'] - m2['dial']) < 1 and abs(m2['dial'] - m3['dial']) < 1

    # 窗口压缩：小视口（600）→ log 变矮或隐藏；大视口（1000）→ 3 行（39px）
    page.set_viewport_size({'width': 390, 'height': 600})
    page.wait_for_timeout(250)
    m600 = measure()
    page.set_viewport_size({'width': 390, 'height': 1000})
    page.wait_for_timeout(250)
    m1000 = measure()
    compress_ok = m600['log'] <= m3['log'] and m1000['log'] == 39
    print('log 高 0条/5条/12条:', m1['log'], '/', m2['log'], '/', m3['log'])
    print('dial.top 0条/5条/12条:', round(m1['dial'],1), '/', round(m2['dial'],1), '/', round(m3['dial'],1))
    print('视口压缩 600/1000:', m600['log'], '/', m1000['log'], '(600 隐藏:' + m600['logDisplay'] + ')')
    print('结果:', '✅ 通过' if (log_stable and dial_stable and compress_ok and not errs) else '❌ 失败',
          '| log稳定:', log_stable, '| 圆稳定:', dial_stable, '| 压缩:', compress_ok, '| JS错误:', errs if errs else '无')
    b.close()
    sys.exit(0 if (log_stable and dial_stable and not errs) else 1)