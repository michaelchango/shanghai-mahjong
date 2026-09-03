# m42：v1.2.19 清混碰「吃过即锁门」UI 冒烟
#  吃过萬顺后：机器人打筒（其他花色）→ 按钮区不再出现 碰/杠/吃；
#  打風（字牌）/ 萬（本门）→ 正常出现 碰
import sys
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8099/'
errs = []
ok = True
def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("  ✅ " if cond else "  ❌ ") + name + (("  " + str(extra)) if extra and not cond else ""))

def btn_texts(pg):
    return pg.evaluate("() => [...document.querySelectorAll('#acts button')].map(b => b.textContent.trim())")

with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg = b.new_page(viewport={'width': 390, 'height': 780})
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until='domcontentloaded'); pg.wait_for_timeout(300)
    pg.click('#hBtnSolo'); pg.wait_for_timeout(200)
    # 切清混碰再开始
    pg.evaluate("""() => {
      const rows=[...document.querySelectorAll('#sheet .setrow')];
      const row=rows.find(r=>r.querySelector('.lb').textContent.startsWith('玩法'));
      const t=[...row.querySelectorAll('.seg button')].find(x=>x.textContent.trim()==='清混碰');
      t.click();
      const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏');
      if(b) b.click();
    }""")
    pg.wait_for_timeout(1400)
    laji = pg.evaluate('() => !!CFG.lajiHu')
    check('开局为清混碰', laji is False, laji)

    # 构造：我已吃「萬123」，手牌补 筒1x3（同牌可碰/杠）、風x2、萬x2
    r = pg.evaluate("""() => {
      const me = G.players[0];
      me.melds = [{ type:'chow', tile:0, tiles:[0,1,2], from:3 }];
      me.hand = [0,0, 9,9,9, 27,27, 18,19,20, 5,6, 33];   // 萬对 + 筒1x3 + 東x2 + 條456 + 散
      me.hand = me.hand.slice().sort((a,b)=>a-b);
      // 用过滤后的选项直接渲染按钮（= 服务端给真人发询问的内容）
      const o1 = claimOptions(me, 9, 3, true);     // 有人打 筒1
      const o2 = claimOptions(me, 27, 3, true);    // 有人打 東
      const o3 = claimOptions(me, 0, 3, true);     // 有人打 萬1
      return { tong: o1.map(x=>x.k), wind: o2.map(x=>x.k), wan: o3.map(x=>x.k) };
    }""")
    check('打筒（其他花色）：无 碰/杠/吃 选项', not any(k in r['tong'] for k in ('pung','kong','chow')), r['tong'])
    check('打風（字牌）：可碰', 'pung' in r['wind'], r['wind'])
    check('打萬（本门）：可碰', 'pung' in r['wan'], r['wan'])

    # 按钮层：把「打筒」场景真实渲染到按钮区，确认不出现「碰」按钮
    pg.evaluate("""() => {
      const me = G.players[0];
      const o1 = claimOptions(me, 9, 3, true);
      PEND = { kind:'claim', payload:{ opts:o1, tile:9, from:3 }, res:()=>{} };
      renderActs();
    }""")
    pg.wait_for_timeout(250)
    btns = btn_texts(pg)
    check('真人按钮区不含「碰/杠」（其他花色被锁）', not any(x in btns for x in ('碰', '杠', '吃')), btns)

    pg.evaluate("""() => {
      const me = G.players[0];
      const o2 = claimOptions(me, 27, 3, true);
      PEND = { kind:'claim', payload:{ opts:o2, tile:27, from:3 }, res:()=>{} };
      renderActs();
    }""")
    pg.wait_for_timeout(250)
    btns2 = btn_texts(pg)
    check('真人打風时仍有「碰」按钮（字牌合法）', '碰' in btns2, btns2)

    # v1.2.22：碰过数牌后彻底不再吃——即使打本门顺也不给「吃」按钮
    print('== Part D：碰过一门后本门吃也消失 ==')
    d = pg.evaluate("""() => {
      const me = G.players[0];
      me.melds = [{ type:'pung', tile:8, tiles:[8,8,8], from:2 }];   // 碰九萬
      me.hand = [0,1, 11,12, 18,19, 27,27, 31,31,32,33,33];
      const o = claimOptions(me, 2, 3, true);    // 上家打 萬2（本门顺 123 可吃）
      return o.map(x => x.k);
    }""")
    check('碰过萬后：打本门萬顺不再给吃', not any(k in d for k in ('chow','pung')), d)
    pg.close(); b.close()

print('JS 错误:', '、'.join(errs) if errs else '无')
print('结果:', '✅ 全部通过' if (ok and not errs) else '❌ 有失败项')
sys.exit(0 if (ok and not errs) else 1)
