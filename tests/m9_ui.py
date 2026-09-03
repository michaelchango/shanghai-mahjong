# 界面新增元素：房间号复制提示、罗盘指针、吃碰杠浮窗停留 2 秒
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
errs = []
ok = True

def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("  ✅ " if cond else "  ❌ ") + name + (("  " + str(extra)) if extra and not cond else ""))

def wait_room(pg):
    for _ in range(30):
        if pg.evaluate("() => document.getElementById('home').classList.contains('hide')"): return True
        pg.wait_for_timeout(200)
    return False

with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-dev-shm-usage", "--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 780},
                        permissions=["clipboard-read", "clipboard-write"])
    pg = ctx.new_page()
    pg.on("dialog", lambda d: d.accept())
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE: " + m.text) if m.type == "error" else None)

    print("== 场景1：房间号「点击数字复制」提示 + 真能复制 ==")
    pg.goto(URL); pg.wait_for_timeout(300)
    pg.click("#hBtnMulti"); pg.wait_for_timeout(200)
    pg.fill("#lName", "界面测")
    pg.click("#lCreate")
    wait_room(pg); pg.wait_for_timeout(400)

    room = pg.evaluate("() => NET.roomNo")
    tip = pg.evaluate("""() => {
      const el = document.querySelector('.rNoCopy');
      return el ? { text: el.textContent.trim(), visible: !el.classList.contains('hide') } : null;
    }""")
    check("房间号下方有复制提示", tip is not None, tip)
    check("提示文案为「（点击数字复制）」", tip and '点击数字复制' in tip['text'], tip)

    # 点房间号 → 剪贴板
    pg.evaluate("() => { const e = document.getElementById('rNoTxt'); if (e) e.click(); }")
    pg.wait_for_timeout(400)
    clip = None
    try:
        clip = pg.evaluate("() => navigator.clipboard.readText()")
    except Exception as e:
        clip = "ERR:" + str(e)[:80]
    check("点击房间号已复制到剪贴板", clip == str(room), f"clip={clip} room={room}")

    print("== 场景2：罗盘指针（四个方位向外指的三角）==")
    # 借单机开局拿到 .dw.cur
    pg.evaluate("() => backHome()"); pg.wait_for_timeout(300)
    pg.click("#hBtnSolo"); pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }"); pg.wait_for_timeout(1500)
    dial = pg.evaluate("""() => {
      const out = {};
      for (const id of ['dwN','dwS','dwW','dwE']){
        const el = document.getElementById(id);
        if (!el) { out[id] = null; continue; }
        const cs = getComputedStyle(el, '::after');
        out[id] = { cls: el.className, content: cs.content, bw: cs.borderWidth, bc: cs.borderColor, anim: cs.animationName };
      }
      return out;
    }""")
    cur = [k for k, v in dial.items() if v and 'cur' in v['cls']]
    check("当前出牌方位已标记 cur", len(cur) == 1, cur)
    def hasPtr(v):
        return v and v['content'] not in (None, 'none', 'normal') and v['bw'] not in (None, '0px', '')
    if cur:
        v = dial[cur[0]]
        check(f"当前方位 {cur[0]} 有向外指的指针", hasPtr(v), v)
        check(f"指针带动画（dialPtr）", v and 'dialPtr' in (v['anim'] or ''), v)
        for k, vv in dial.items():
            if k != cur[0]:
                check(f"非当前方位 {k} 不显示指针", not hasPtr(vv), vv)
    # 四个方位各自有一套朝外的三角（区分 n/s/w/e）
    for k, v in dial.items():
        check(f"{k} 的方位类名正确", v and any(c in v['cls'].split() for c in ['n','s','w','e']), v)

    print("== 场景3：toast 浮窗停留 2 秒 ==")
    pg.evaluate("() => document.querySelectorAll('#toast .tst').forEach(t => t.remove())")
    pg.wait_for_timeout(100)
    pg.evaluate("() => toast('测试浮窗', 'gold')")
    pg.wait_for_timeout(200)
    n1 = pg.evaluate("() => document.querySelectorAll('#toast .tst').length")
    check("浮窗已出现", n1 >= 1, n1)
    pg.wait_for_timeout(1400)   # 累计 1.6s，应还在
    n2 = pg.evaluate("() => document.querySelectorAll('#toast .tst').length")
    check("1.6 秒时浮窗仍在（不是一闪而过）", n2 >= 1, n2)
    pg.wait_for_timeout(1000)   # 累计 2.6s，应已消失
    n3 = pg.evaluate("() => document.querySelectorAll('#toast .tst').length")
    check("2.6 秒后浮窗已消失", n3 == 0, n3)

    print("== 场景4：吃/碰/杠/敲 都有浮窗提示 ==")
    src = pg.evaluate("""() => {
      const s = document.documentElement.innerHTML;
      return {
        peng: /toast\\([^)]*碰/.test(s),
        chi:  /toast\\([^)]*吃/.test(s),
        gang: /toast\\([^)]*杠/.test(s),
        qiao: /toast\\([^)]*敲/.test(s)
      };
    }""")
    for k, label in [('peng','碰'), ('chi','吃'), ('gang','杠'), ('qiao','敲')]:
        check(f"{label} 有 toast 浮窗", src[k], src)

    print("== 场景5：seatToast 把浮窗定位到对应牌河 ==")
    loc = pg.evaluate("""() => {
      const out = {};
      for (let seat = 0; seat < 4; seat++){
        const rid = ['rvS','rvE','rvN','rvW'][seat];
        const rv = document.getElementById(rid);
        document.querySelectorAll('.seatTst').forEach(t => t.remove());
        seatToast(seat, '测' + seat);
        const d = document.querySelector('.seatTst');
        if (!rv || !d) { out[seat] = false; continue; }
        const r = rv.getBoundingClientRect(), t = d.getBoundingClientRect();
        const cx = t.x + t.width/2, cy = t.y + t.height/2;
        out[seat] = r.x <= cx && cx <= r.x + r.width && r.y <= cy && cy <= r.y + r.height;
      }
      document.querySelectorAll('.seatTst').forEach(t => t.remove());
      return out;
    }""")
    for k in ['0','1','2','3']:
        check(f"座位{k} 浮窗落在牌河内", loc[k], loc)

    b.close()

print("JS 错误:", errs[:8] if errs else "无")
print("结果:", "✅ 全部通过" if ok and not errs else "❌ 有失败项")
sys.exit(0 if ok and not errs else 1)
