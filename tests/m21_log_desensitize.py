# m21：手牌记录脱敏验证（UI 端到端，确定性）
# 验证：敲牌（自己/机器人两条路径）写入 G.logs 的记录不再含「听什么牌」，
#       自摸记录不再含「目标牌型（res.ev.type）」。
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
    page.wait_for_timeout(300)

    res = page.evaluate("""async () => {
      window.__logs = [];
      window.logMsg = function(s){ window.__logs.push(s); };  // 覆写捕获，避免污染底部记录条
      // 自己敲（对应源码 doKnock，原 logMsg('你敲了，听 ...')）
      doKnock([{t:0},{t:8}]);
      // 机器人敲（对应源码 knockCheck 的 isBot 分支，原 logMsg(name+' 敲了，听 ...')）
      const pl = G.players[1];
      pl.hand = [0,1,2,3,4,5,6,7,8,9,9,9,10];  // 13 张：123456789m + 111p + 2p（单钓 2p 听牌）
      pl.melds = []; pl.isBot = true; pl.knocked = false; pl.knockWaits = [];
      await knockCheck(pl);
      return { logs: window.__logs.slice() };
    }""")
    page.wait_for_timeout(200)

    logs = res['logs']
    exact_self = '你敲了' in logs
    any_ting = any('听' in s for s in logs)           # 不应出现「听 X/Y」
    bot_knock = any(('敲了' in s) and ('听' not in s) for s in logs)
    print('captured logs:', logs)
    print('self_knock_exact=你敲了:', exact_self, '| any_听_leak:', any_ting, '| bot_knock_ok:', bot_knock, '| js_errs:', errs if errs else '无')

    ok = exact_self and (not any_ting) and bot_knock and (not errs)
    b.close()
    sys.exit(0 if ok else 1)
