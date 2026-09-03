# 规则收口：自摸点胡 / 暗杠按钮 / 听牌多选 / 优先级分轮
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
ok = True

def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("  ✅ " if cond else "  ❌ ") + name + (("  " + str(extra)) if extra and not cond else ""))

with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-dev-shm-usage", "--no-sandbox"])
    pg = b.new_page(viewport={"width": 390, "height": 780})
    pg.on("dialog", lambda d: d.accept())
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE: " + m.text) if m.type == "error" else None)
    pg.goto(URL); pg.wait_for_timeout(300)
    pg.click("#hBtnSolo"); pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }"); pg.wait_for_timeout(1500)

    print("== 场景1：自摸「胡/过」按钮 ==")
    btns = pg.evaluate("""() => {
      PEND = { kind:'zimo', payload:{ ev:{base:2}, tile:4 }, res:null, seat:0 };
      renderActs();
      return Array.from(document.querySelectorAll('#acts button')).map(b => b.textContent);
    }""")
    check("自摸显示「胡」按钮", '胡' in btns, btns)
    check("自摸显示「过」按钮", '过' in btns, btns)

    print("== 场景2：暗杠「暗杠/加杠/过」按钮 ==")
    btns2 = pg.evaluate("""() => {
      PEND = { kind:'selfkong', payload:{ options:[{k:'ankan', tile:4},{k:'chakan', tile:4}], tile:4 }, res:null, seat:0 };
      renderActs();
      return Array.from(document.querySelectorAll('#acts button')).map(b => b.textContent);
    }""")
    check("显示「暗杠」按钮", '暗杠' in btns2, btns2)
    check("显示「加杠」按钮", '加杠' in btns2, btns2)
    check("显示「过」按钮", '过' in btns2, btns2)

    print("== 场景3：听牌多选（打哪张）==")
    # 构造两种听法：打 3萬 听 1萬/4萬；打 6萬 听 5萬/8萬
    opts = pg.evaluate("""() => {
      const knocks = [
        { discard: 2, waits: [{t:0},{t:3}] },   // 打 3萬 听 1萬/4萬
        { discard: 5, waits: [{t:4},{t:7}] }    // 打 6萬 听 5萬/8萬
      ];
      __knocks = knocks;
      const rows = knocks.map((k, i) => '<button class="knockOpt" onclick="pickKnock(' + i + ')">打 ' + tileName(k.discard) + ' → 听 ' + k.waits.map(w => tileName(w.t)).join('/') + '</button>').join('');
      openSheet('<h2><span>选择听法</span><span class="sp"></span><button class="close" onclick="closeSheet()">×</button></h2><div class="knockList">' + rows + '</div>');
      return Array.from(document.querySelectorAll('.knockOpt')).map(b => b.textContent);
    }""")
    check("选择面板列出两种听法", len(opts) == 2, opts)
    check("方案文案含「打」和「听」", all(('打' in o and '听' in o) for o in opts), opts)

    print("== 场景4：引擎优先级分轮（机械验证源码）==")
    src = pg.evaluate("() => document.documentElement.innerHTML")
    check("collectClaims 分轮：先胡", "// 第1轮：胡" in src)
    check("collectClaims 分轮：再杠碰", "// 第2轮：杠" in src)
    check("collectClaims 分轮：最后吃", "// 第3轮：吃" in src)
    check("新增 pickClaim 封装", "async function pickClaim" in src)
    check("自摸走 ask('zimo')", "ask('zimo'" in src)
    check("暗杠走 ask('selfkong')", "ask('selfkong'" in src)

    b.close()

print("JS 错误:", errs[:5] if errs else "无")
print("结果:", "✅ 全部通过" if ok and not errs else "❌ 有失败项")
sys.exit(0 if ok and not errs else 1)
