# m31：历史记录弹窗（v1.2.14）
# 1) 去掉顶部「本轮总分」列；2) 列表显示「第 N 局」；3) 最近一局在最上面
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
    page.wait_for_timeout(800)

    # 注入两条历史（局1先、局2后）
    page.evaluate("""() => {
      G.abort = true; G.running = false;
      const html = '<h2><span>结算</span><span class="sp"></span></h2><div class="result"><div class="winner">你 自摸 · 平胡</div></div>';
      G.history = [
        { no:1, wind:'东风', kind:'自摸', winners:[0], note:'平胡 · 2 番 · 每家 6 分', delta:[18,-6,-6,-6], html },
        { no:2, wind:'东风', kind:'点炮', winners:[0], note:'清一色 · 8 番', delta:[30,-10,-10,-10], html }
      ];
      openHistory();
    }""")
    page.wait_for_timeout(200)

    sheet = page.inner_text('#sheet')
    ok1 = '本轮总分' not in sheet
    # 列表顺序：倒序 → 第2局（点炮）在前，第1局在后
    i2 = sheet.find('第2 局')
    i1 = sheet.find('第1 局')
    ok2 = i2 >= 0 and i1 >= 0 and i2 < i1
    # 显示"第 N 局"
    ok3 = '第2 局' in sheet and '第1 局' in sheet
    # 查看按钮：倒序第一条（第2局）点击应打开对应结算（标题含 第 2 局）
    page.evaluate("() => { const rows = document.querySelectorAll('#sheet .hrow'); if (rows[0]) rows[0].click(); }")
    page.wait_for_timeout(200)
    view_sheet = page.inner_text('#sheet')
    ok4 = '第 2 局' in view_sheet
    print('无「本轮总分」:', ok1, '| 倒序(第2局在前):', ok2, '| 显示第N局:', ok3, '| 倒序第一条可查看:', ok4)
    print('结果:', '✅ 通过' if (ok1 and ok2 and ok3 and ok4 and not errs) else '❌ 失败',
          '| JS错误:', errs if errs else '无')
    b.close()
    sys.exit(0 if (ok1 and ok2 and ok3 and ok4 and not errs) else 1)
