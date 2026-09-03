# 收口：单机 claim hint 不显示「你」（remap 修复）+ 引擎吃牌 G.turn 已验证
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

    print("== 场景1：单机 remap 不偏移 ==")
    pg.click("#hBtnSolo"); pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }"); pg.wait_for_timeout(1500)
    # 确认 remap 在 !NET.active 时返回原 seat
    rm = pg.evaluate("() => { NET.active = false; return remap(3); }")
    check("单机 NET.active=false 时 remap(3) 应返回 3", rm == 3, rm)
    rm0 = pg.evaluate("() => { NET.active = false; return remap(0); }")
    check("单机 remap(0) 应返回 0", rm0 == 0, rm0)

    print("== 场景2：单机 claim hint 显示正确出牌人（非「你」）==")
    # 构造上家（seat 3）打牌询问我吃/过的 PEND
    hint = pg.evaluate("""() => {
      G.players[3].name = '测试上家';
      G.players[0].name = '你';
      PEND = { kind:'claim', payload:{ opts:[{k:'chow', tile:13, combo:[11,12]}],
        tile:13, from:3 }, res:null, seat:0 };
      renderActs();
      return document.getElementById('hint').textContent || '';
    }""")
    check("上家（seat 3）打牌时 hint 显示「测试上家」不是「你」",
          '测试上家' in hint and '你' not in hint, hint)

    print("== 场景3：联机 remap 仍正常换算 ==")
    rm2 = pg.evaluate("""() => {
      NET.active = true; NET.mySeat = 1;   // 我是服务端 seat 1
      return remap(3);   // 服务端 seat 3 → 本地 (3-1+4)%4 = 2
    }""")
    check("联机 NET.active=true 时 remap(3) 应返回 2（本地）", rm2 == 2, rm2)

    print("== 场景4：联机 toast 浮窗 remap 仍生效 ==")
    res = pg.evaluate("""() => {
      NET.active = true; NET.mySeat = 2;
      document.querySelectorAll('.seatTst').forEach(t => t.remove());
      netHandle({ t:'toast', text:'碰！', cls:'gold', seat:1 });
      const d = document.querySelector('.seatTst');
      const rvW = document.getElementById('rvW').getBoundingClientRect();
      if (!d) return { ok:false };
      const t = d.getBoundingClientRect();
      const cx = t.x + t.width/2, cy = t.y + t.height/2;
      return { inW: rvW.x <= cx && cx <= rvW.x + rvW.width && rvW.y <= cy && cy <= rvW.y + rvW.height };
    }""")
    check("联机 mySeat=2 时 seat=1 浮窗 remap(1)=3 后落在 rvW", res.get('inW'), res)

    b.close()

print("JS 错误:", errs[:5] if errs else "无")
print("结果:", "✅ 全部通过" if ok and not errs else "❌ 有失败项")
sys.exit(0 if ok and not errs else 1)