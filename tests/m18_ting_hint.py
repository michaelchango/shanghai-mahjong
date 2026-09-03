# m18：已敲听后，底部 tingLine 应显示「听牌中 → xx牌」，而不是「打xx牌 听牌 → xx牌"
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    page = b.new_page(viewport={'width': 390, 'height': 780})
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL, wait_until='domcontentloaded')
    page.wait_for_timeout(600)
    page.click('#hBtnSolo'); page.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }")
    page.wait_for_timeout(600)

    # 强制进入已敲状态：手牌 1m3 2m3 3m3 4p3 7s2（14张，胡了？需要13张听牌）
    # 用 1m3 2m3 3m3 4p3 7s1 + 5m1 = 13张听 7s；再摸到 7s 成 14张
    # 更简单：直接构造 p0 已敲，手牌 13 张听 7s，并设置 drawn=7s（模拟摸牌后 14 张）
    page.evaluate("""() => {
      const p = G.players[0];
      p.knocked = true;
      p.knockWaits = [24];   // 7s
      p.hand = [0,0,0, 1,1,1, 2,2,2, 12,12,12, 24, 24];  // 14张：4刻子+7s对 = 已胡
      // 避免被当成自摸中断，把 drawn 也设成 7s 让流程认为刚摸牌
      p.drawn = 24;
      p.menqing = true;
      p.flowers = [];
      p.melds = [];
      renderHUD();
      return {
        tingLine: document.getElementById('tingLine').textContent,
        tingLineHtml: document.getElementById('tingLine').innerHTML,
        knockTag: document.getElementById('knockTag').textContent,
        hasDa: document.getElementById('tingLine').textContent.includes('打'),
        hasTingZhong: document.getElementById('tingLine').textContent.includes('听牌中')
      };
    }""")

    result = page.evaluate("""() => ({
      tingLine: document.getElementById('tingLine').textContent,
      hasDa: document.getElementById('tingLine').textContent.includes('打'),
      hasTingZhong: document.getElementById('tingLine').textContent.includes('听牌中')
    })""")
    print('tingLine 文本:', repr(result['tingLine']))
    ok1 = not result['hasDa']
    ok2 = result['hasTingZhong']
    print('结果:', '✅ 通过' if (ok1 and ok2 and not errs) else '❌ 失败',
          '| 不含"打":', ok1, '| 含"听牌中":', ok2, '| JS错误:', errs if errs else '无')
    b.close()
    sys.exit(0 if (ok1 and ok2 and not errs) else 1)
