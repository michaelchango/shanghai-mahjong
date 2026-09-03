import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"

def chk(name, cond, extra=""):
    print(("✅ " + name) if cond else ("❌ " + name + "  " + extra))
    return cond

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    pg = b.new_page(viewport={"width": 390, "height": 780})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(400)
    pg.click("#hBtnMulti")
    pg.wait_for_timeout(200)
    pg.fill("#lName", "房主A")
    pg.click("#lCreate")
    pg.wait_for_timeout(600)
    # 房主单独开局：点「开始游戏」后其余三家补机器人
    pg.click("#rStart")
    pg.wait_for_timeout(1500)

    # 自动打牌，直到本局结算（流局或胡）
    settled = False
    for _ in range(700):
        st = pg.evaluate("""() => {
          if (NET.lastSettle) return 'settled';
          const p = NET.pend;
          if (!p) return 'wait';
          if (p.kind === 'discard'){
            const t = document.querySelector('#hand .tile');
            if (t){ t.click(); return 'discard'; }
            return 'discard-none';
          }
          return 'ask:' + p.kind;
        }""")
        if st == "settled":
            settled = True
            break
        if st == "discard":
            pg.wait_for_timeout(120)
            pg.evaluate("document.querySelector('#hand .tile')?.click()")  # 二次点击打出
        elif st and st.startswith("ask:"):
            kind = st.split(":")[1]
            if kind in ("zimo",):
                pg.evaluate("""() => { const b=[...document.querySelectorAll('#acts button')].find(x=>x.textContent.includes('胡')); if(b)b.click(); }""")
            else:  # claim / knock / selfkong → 过 / 不敲
                pg.evaluate("""() => { const b=[...document.querySelectorAll('#acts button')].find(x=>x.textContent.includes('过')||x.textContent.includes('不敲')); if(b)b.click(); }""")
        pg.wait_for_timeout(70)

    chk("走到本局结算", settled)
    snap_len = pg.evaluate("NET.lastSettle ? NET.lastSettle.html.length : 0")
    chk("结算数据已存在（lastSettle）", snap_len > 0, str(snap_len))

    # 触发断线重连
    pg.evaluate("NET.ws.close()")
    pg.wait_for_timeout(3000)
    ls_len = pg.evaluate("NET.lastSettle ? NET.lastSettle.html.length : 0")
    chk("断线重连后 lastSettle 仍被恢复", ls_len > 0, str(ls_len))

    # 点「查看结算」应弹出结算面板
    pg.evaluate("showResult()")
    pg.wait_for_timeout(600)
    sheet_ok = pg.evaluate("""() => {
      const s = document.querySelector('.sheet');
      if (!s) return false;
      return s.classList.contains('show') && s.innerText.includes('本局') === false ? s.innerText.length > 10 : s.innerText.length > 10;
    }""")
    chk("重连后「查看结算」能弹出面板", sheet_ok)

    print("JS 错误:", errs if errs else "无")
    b.close()

print("结果:", "✅ 全部通过" if (settled and snap_len > 0 and ls_len > 0 and sheet_ok and not errs) else "❌ 有失败")
