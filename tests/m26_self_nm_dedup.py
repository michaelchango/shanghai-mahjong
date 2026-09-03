# m26：自己名牌显示（名字+总分）+ 历史记录去重（v1.2.12）
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

    nm = page.inner_text('#nm0').strip()
    ok1 = ('分' in nm) and len(nm) > 1
    print('nm0 名牌:', repr(nm))

    # 历史去重：netPushSettleRec 重复 rec 不重复入列
    r = page.evaluate("""() => {
      NET.history = [];
      netPushSettleRec({no:1, wind:'东风', kind:'自摸'});
      netPushSettleRec({no:1, wind:'东风', kind:'自摸'});   // 重复（重连补发）
      netPushSettleRec({no:2, wind:'东风', kind:'点炮'});
      return { len: NET.history.length, recs: NET.history.map(x => x.no + x.wind) };
    }""")
    ok2 = r['len'] == 2
    print('历史去重 len:', r['len'], 'recs:', r['recs'], '| js_errs:', errs if errs else '无')
    print('结果:', '✅ 通过' if (ok1 and ok2 and not errs) else '❌ 失败',
          '| 名牌显示:', ok1, '| 去重:', ok2)
    b.close()
    sys.exit(0 if (ok1 and ok2 and not errs) else 1)
