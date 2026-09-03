# m27：牌河高度自适应 + 选中同牌高亮 + 点空白落回（v1.2.13）
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

    # 注入确定性状态：停主循环；p0 手牌两张 1m(tile=1)（排序后第一个=1m），三家牌河各出过一张 1m
    page.evaluate("""() => {
      G.abort = true; G.running = false;
      PEND = { kind: 'discard', payload: null, res: null };
      G.players[0].hand = [1,1,4,5,6,7,8,9,10,11,12,13,14];
      G.players[0].drawn = null;
      G.players[0].discards = [];
      G.players[1].discards = [1];
      G.players[2].discards = [1];
      G.players[3].discards = [1];
      SEL = null; SELIDX = null;
      render();
    }""")
    page.wait_for_timeout(200)

    # 1) 点击手牌第一个 tile（排序后 = 1m）→ 台面相同牌高亮（.hl 应有 3 张）
    page.evaluate("""() => {
      document.querySelector('#hand .tile').click();
    }""")
    page.wait_for_timeout(150)
    sel_v = page.evaluate("() => ({ sel: SEL, hl: document.querySelectorAll('.river .tile.hl').length })")
    ok1 = sel_v['sel'] == 1 and sel_v['hl'] == 3
    print('选中后 SEL:', sel_v['sel'], '| 台面.hl:', sel_v['hl'])

    # 2) 点手牌空白 → 牌落回（SEL 清空、.hl 归零、手牌 .sel 消失）
    page.evaluate("""() => {
      const box = document.getElementById('hand');
      box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }""")
    page.wait_for_timeout(150)
    back_v = page.evaluate("() => ({ sel: SEL, hl: document.querySelectorAll('.river .tile.hl').length, selInHand: document.querySelectorAll('#hand .tile.sel').length })")
    ok2 = back_v['sel'] is None and back_v['hl'] == 0 and back_v['selInHand'] == 0
    print('点空白后 SEL:', back_v['sel'], '| .hl:', back_v['hl'], '| 手牌.sel:', back_v['selInHand'])

    # 3) 牌河高度自适应：矮视口 → 更低；高视口 → 更高
    def rv_h():
        return page.evaluate("() => document.getElementById('rvE').offsetHeight")
    h780 = rv_h()
    page.set_viewport_size({'width': 390, 'height': 600})
    page.wait_for_timeout(250)
    h600 = rv_h()
    page.set_viewport_size({'width': 390, 'height': 1000})
    page.wait_for_timeout(250)
    h1000 = rv_h()
    ok3 = h600 < h780 <= h1000
    print('rvE 高度 600/780/1000:', h600, '/', h780, '/', h1000)

    print('结果:', '✅ 通过' if (ok1 and ok2 and ok3 and not errs) else '❌ 失败',
          '| 高亮:', ok1, '| 落回:', ok2, '| 自适应:', ok3, '| JS错误:', errs if errs else '无')
    b.close()
    sys.exit(0 if (ok1 and ok2 and ok3 and not errs) else 1)
