# m50：顶部四栏「牌没摸齐就显示 —」（v1.2.40）
# deal() 会把起手花先摘到 pendingFlowers，等轮到本人首次出牌才补回来；
# 这期间手牌张数不足，底/番/得分/封顶 都不该显示数字。
import sys
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8099/'

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 420, 'height': 860})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until='domcontentloaded')
    pg.wait_for_timeout(500)

    # 还没开局：四栏应为 —（至少 底/番/得分 不为数字）
    pre = pg.evaluate("""()=>({
      mDi: document.getElementById('mDi').textContent.trim(),
      mFan: document.getElementById('mFan').textContent.trim(),
      mScore: document.getElementById('mScore').textContent.trim(),
      mCap: document.getElementById('mCap').textContent.trim()
    })""")
    print('开局前:', pre)

    pg.click('#hBtnSolo')
    pg.evaluate("()=>{const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click();}")
    pg.wait_for_timeout(1500)

    read = """()=>({
      running: G.running,
      hand: G.players[0].hand.length,
      pend: (G.players[0].pendingFlowers||[]).length,
      mDi: document.getElementById('mDi').textContent.trim(),
      mFan: document.getElementById('mFan').textContent.trim(),
      mScore: document.getElementById('mScore').textContent.trim(),
      mCap: document.getElementById('mCap').textContent.trim()
    })"""

    normal = pg.evaluate(read)
    print('摸齐后:', normal)

    # 人为造「牌不齐」：把手上一张挪进 pendingFlowers（等价起手花未补）
    blanked = pg.evaluate("""()=>{
      const p = G.players[0];
      p.pendingFlowers = p.pendingFlowers || [];
      p.pendingFlowers.push(p.hand.shift());
      renderHUD();
      return {
        pend: p.pendingFlowers.length,
        hand: p.hand.length,
        mDi: document.getElementById('mDi').textContent.trim(),
        mFan: document.getElementById('mFan').textContent.trim(),
        mScore: document.getElementById('mScore').textContent.trim(),
        mCap: document.getElementById('mCap').textContent.trim()
      };
    }""")
    print('牌不齐时:', blanked)

    # 还原（模拟补花完成）
    restored = pg.evaluate("""()=>{
      const p = G.players[0];
      p.hand.push(p.pendingFlowers.pop());
      renderHUD();
      return {
        pend: p.pendingFlowers.length,
        mDi: document.getElementById('mDi').textContent.trim(),
        mFan: document.getElementById('mFan').textContent.trim(),
        mScore: document.getElementById('mScore').textContent.trim(),
        mCap: document.getElementById('mCap').textContent.trim()
      };
    }""")
    print('补花后:', restored)

    def is_dash(v): return v == '—' or v == '-'

    checks = {
        '摸齐后底为数字':      normal['mDi'].isdigit(),
        '摸齐后番为数字':      normal['mFan'].isdigit(),
        '摸齐后得分为数字':    normal['mScore'].isdigit(),
        '摸齐后封顶有值':      normal['mCap'] not in ('', '—'),
        '牌不齐→底为—':        is_dash(blanked['mDi']),
        '牌不齐→番为—':        is_dash(blanked['mFan']),
        '牌不齐→得分为—':      is_dash(blanked['mScore']),
        '牌不齐→封顶为—':      is_dash(blanked['mCap']),
        '补花后数字恢复':      restored['mDi'].isdigit() and restored['mFan'].isdigit() and restored['mScore'].isdigit(),
        '补花后封顶恢复':      restored['mCap'] not in ('', '—'),
    }
    print('\n--- 校验 ---')
    allok = True
    for k, v in checks.items():
        print(('  ✅ ' if v else '  ❌ ') + k)
        allok = allok and v

    print('\nJS 错误:', errs if errs else '无')
    ok = allok and not errs
    print('结果:', '✅ 通过' if ok else '❌ 失败')
    b.close()
    sys.exit(0 if ok else 1)
