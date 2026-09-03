# m44：v1.2.20 清混碰免敲 UI 端到端
#  A. 清混碰：听牌不敲定——knockTag 显示「听 xx(n)」而不是「未敲·不能胡」；点炮有「胡」按钮
#  B. 敲麻对照：同手牌显示「可敲听 / 未敲·不能胡」，点炮无「胡」按钮
import sys
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8099/'
errs = []
ok = True
def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("  ✅ " if cond else "  ❌ ") + name + (("  " + str(extra)) if extra and not cond else ""))

def start_solo_with_play(pg, mode):
    pg.goto(URL, wait_until='domcontentloaded'); pg.wait_for_timeout(300)
    pg.click('#hBtnSolo'); pg.wait_for_timeout(250)
    pg.evaluate("""(mode) => {
      const rows=[...document.querySelectorAll('#sheet .setrow')];
      const row=rows.find(r=>r.querySelector('.lb').textContent.startsWith('玩法'));
      const t=[...row.querySelectorAll('.seg button')].find(x=>x.textContent.trim()===mode);
      t.click();
      const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏');
      if(b) b.click();
    }""", mode)
    pg.wait_for_timeout(1400)

TING_HAND = [0,0,0, 9,9,9, 18,18,18, 27,27,27, 31]  # 4 刻 + 单中 → 听「中」

with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ===== Part A：清混碰免敲 =====
    print('== Part A：清混碰免敲 ==')
    pg = b.new_page(viewport={'width': 390, 'height': 780})
    pg.on('pageerror', lambda e: errs.append('A:' + str(e)))
    start_solo_with_play(pg, '清混碰')
    laji = pg.evaluate('() => !!CFG.lajiHu')
    check('开局为清混碰', laji is False, laji)

    # 注入听牌手牌（无敲定），渲染 HUD
    hud = pg.evaluate("""(hand) => {
      const me = G.players[0];
      me.knocked = false;
      me.hand = hand.slice();
      renderHUD();
      const kt = document.getElementById('knockTag');
      const tl = document.getElementById('tingLine');
      return { kt: kt.textContent, cls: kt.className, ting: tl.innerHTML, tingCls: tl.className };
    }""", TING_HAND)
    check('knockTag 显示实时听牌（非「未敲·不能胡」）', '听' in hud['kt'] and '未敲' not in hud['kt'], hud)
    check('听牌行显示「听牌中 →」', '听牌中' in hud['ting'], hud['ting'])
    check('听牌行含「中」', '中' in hud['ting'], hud['ting'])

    # 别人点炮「中」→ 胡按钮出现（免敲，无敲定）
    pg.evaluate("""(hand) => {
      const me = G.players[0];
      me.hand = hand.slice();
      const opts = claimOptions(me, 31, 3, true);
      PEND = { kind:'claim', payload:{ opts, tile:31, from:3 }, res:()=>{} };
      renderActs();
    }""", TING_HAND)
    pg.wait_for_timeout(200)
    btns = pg.evaluate("() => [...document.querySelectorAll('#acts button')].map(x=>x.textContent.trim())")
    check('点炮出「胡」按钮（免敲直接可胡）', '胡' in btns, btns)
    check('没有「敲定」按钮', not any('敲' in x for x in btns), btns)
    pg.close()

    # ===== Part B：敲麻对照 =====
    print('== Part B：敲麻对照 ==')
    pg = b.new_page(viewport={'width': 390, 'height': 780})
    pg.on('pageerror', lambda e: errs.append('B:' + str(e)))
    start_solo_with_play(pg, '敲麻')
    laji = pg.evaluate('() => !!CFG.lajiHu')
    check('开局为敲麻', laji is True, laji)
    hud = pg.evaluate("""(hand) => {
      const me = G.players[0];
      me.knocked = false;
      me.hand = hand.slice();
      renderHUD();
      const kt = document.getElementById('knockTag');
      return { kt: kt.textContent, cls: kt.className };
    }""", TING_HAND)
    check('敲麻未敲显示「可敲听 / 未敲」类文案', ('可敲听' in hud['kt']) or ('未敲' in hud['kt']), hud['kt'])
    # 点炮无胡按钮
    pg.evaluate("""(hand) => {
      const me = G.players[0];
      me.hand = hand.slice();
      const opts = claimOptions(me, 31, 3, true);
      PEND = { kind:'claim', payload:{ opts, tile:31, from:3 }, res:()=>{} };
      renderActs();
    }""", TING_HAND)
    pg.wait_for_timeout(200)
    btns = pg.evaluate("() => [...document.querySelectorAll('#acts button')].map(x=>x.textContent.trim())")
    check('敲麻未敲定点炮无「胡」按钮', '胡' not in btns, btns)
    pg.close(); b.close()

print('JS 错误:', '、'.join(errs) if errs else '无')
print('结果:', '✅ 全部通过' if (ok and not errs) else '❌ 有失败项')
sys.exit(0 if (ok and not errs) else 1)
