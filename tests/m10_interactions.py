# 交互收口：吃牌显示牌型 / 罗盘指针跟随碰杠吃 / 浮窗 remap / 听牌一次点
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

    print("== 场景1：吃牌按钮显示具体牌型 ==")
    btns = pg.evaluate("""() => {
      PEND = { kind:'claim', payload:{ opts:[
        { k:'chow', tile:4, combo:[2,3] },
        { k:'chow', tile:4, combo:[3,5] }
      ], tile:4, from:3 }, res:null, seat:0 };
      renderActs();
      return Array.from(document.querySelectorAll('#acts button')).map(b => b.textContent);
    }""")
    check("两种吃法分别显示 345萬 / 456萬",
          '吃 345萬' in btns and '吃 456萬' in btns, btns)

    print("== 场景2：罗盘指针跟随碰/杠/吃（引擎内 G.turn = p.idx）==")
    src = pg.evaluate("() => document.documentElement.innerHTML")
    check("引擎内碰/杠/吃三处都设置 G.turn = p.idx", src.count("G.turn = p.idx;") == 3,
          src.count("G.turn = p.idx;"))

    print("== 场景3：吃碰杠浮窗按本地视角重映射 ==")
    res = pg.evaluate("""() => {
      NET.active = true; NET.mySeat = 1;   // 我是服务端 seat 1（非房主）
      document.querySelectorAll('.seatTst').forEach(t => t.remove());
      netHandle({ t:'toast', text:'我 碰！', cls:'gold', seat:1 });
      const d = document.querySelector('.seatTst');
      const rvS = document.getElementById('rvS').getBoundingClientRect();
      if (!d) return { inMyRiver:false, err:'no .seatTst' };
      const t = d.getBoundingClientRect();
      const cx = t.x + t.width/2, cy = t.y + t.height/2;
      return { inMyRiver: rvS.x <= cx && cx <= rvS.x + rvS.width && rvS.y <= cy && cy <= rvS.y + rvS.height };
    }""")
    check("服务端 seat=1 的浮窗重映射后落在我的牌河", res.get('inMyRiver'), res)

    print("== 场景4：听牌敲听一次点（自动敲定）==")
    res2 = pg.evaluate("""() => {
      const sent = [];
      NET.active = true; NET.mySeat = 0;
      NET.ws = { readyState: 1, send: o => sent.push(JSON.parse(o)) };
      NET.autoKnock = true;
      netAsk({ kind:'knock', payload:{ waits:[{t:1}] }, askLeft: 5000 });
      const knocks = sent.filter(x => x.t === 'act' && x.kind === 'knock');
      return { autoKnocked: knocks.length === 1 && knocks[0].value === 'knock',
               flagCleared: NET.autoKnock === false };
    }""")
    check("点「敲听」后服务端再问敲不敲 → 自动敲定", res2.get('autoKnocked'), res2)
    check("自动敲定后标志已清除", res2.get('flagCleared'), res2)

    # 无 autoKnock 时应正常走「敲定/不敲」按钮，不自动
    res3 = pg.evaluate("""() => {
      const sent = [];
      NET.active = true; NET.mySeat = 0;
      NET.ws = { readyState: 1, send: o => sent.push(JSON.parse(o)) };
      NET.autoKnock = false;
      netAsk({ kind:'knock', payload:{ waits:[{t:1}] }, askLeft: 5000 });
      return { sentKnock: sent.some(x => x.t === 'act' && x.kind === 'knock'),
               hasButtons: !!document.querySelector('#acts button') };
    }""")
    check("未点敲听时，敲不敲仍弹「敲定/不敲」按钮（不自动）",
          (not res3.get('sentKnock')) and res3.get('hasButtons'), res3)

    b.close()

print("JS 错误:", errs[:5] if errs else "无")
print("结果:", "✅ 全部通过" if ok and not errs else "❌ 有失败项")
sys.exit(0 if ok and not errs else 1)
