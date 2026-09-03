# 多人「准备下一局」流程：结算 → 四家准备 → 自动开局（可取消）
import sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
errs = []
ok = True

def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("  ✅ " if cond else "  ❌ ") + name + (("  " + str(extra)) if extra and not cond else ""))

# 自动对局：适配新结算按钮「准备下一局」
AUTO = """() => {
  const btns = Array.from(document.querySelectorAll('#acts button'));
  const by = t => btns.find(b => b.textContent === t);
  const hint = document.getElementById('hint').textContent || '';
  const clickTile = () => { const t = document.querySelectorAll('#hand .tile'); if (!t.length) return 'idle'; t[0].click(); t[0].click(); return 'discard'; };
  if (by('不敲')) { by('不敲').click(); return 'knock-pass'; }
  if (by('胡')) { by('胡').click(); return 'hu'; }
  if (by('杠')) { by('杠').click(); return 'kong'; }
  if (by('暗杠')) { by('暗杠').click(); return 'ankan'; }
  if (by('加杠')) { by('加杠').click(); return 'chakan'; }
  if (by('碰')) { by('碰').click(); return 'pung'; }
  if (by('吃')) { by('吃').click(); return 'chow'; }
  if (by('过')) { by('过').click(); return 'pass'; }
  if (hint.indexOf('点击一张牌') >= 0) return clickTile();
  if (by('敲听')) { by('敲听').click(); return 'knock-listen'; }
  return 'idle';
}"""

def mkjoin(pg, name, room_no=None):
    pg.goto(URL); pg.wait_for_timeout(300)
    pg.click("#hBtnMulti"); pg.wait_for_timeout(200)
    pg.fill("#lName", name)
    if room_no is None:
        pg.click("#lCreate")
    else:
        pg.fill("#lRoomNo", room_no); pg.click("#lJoin")
    for _ in range(30):
        if pg.evaluate("() => NET.roomNo"): return pg.evaluate("() => NET.roomNo")
        pg.wait_for_timeout(200)
    return None

with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-dev-shm-usage", "--no-sandbox"])
    ctxs, pages = [], []
    for i in range(4):
        ctx = b.new_context(viewport={"width": 390, "height": 780})
        pg = ctx.new_page()
        pg.on("dialog", lambda d: d.accept())
        pg.on("pageerror", lambda e, n=i: errs.append(f"P{n} PAGEERROR: " + str(e)))
        pg.on("console", lambda m, n=i: errs.append(f"P{n} CONSOLE: " + m.text) if m.type == "error" else None)
        ctxs.append(ctx); pages.append(pg)

    room = mkjoin(pages[0], "甲准备")
    for i, nm in enumerate(["乙准备", "丙准备", "丁准备"], 1):
        mkjoin(pages[i], nm, room)
    pages[0].wait_for_timeout(500)

    # 全员准备（房主无需）+ 开始
    for pg in pages[1:]: pg.click("#rReady")
    pages[0].wait_for_timeout(400)
    pages[0].click("#rStart")
    print("已开局，自动对局至第一次结算…")

    # 自动对局到 G.finished
    deadline = time.time() + 200
    while time.time() < deadline:
        for pg in pages:
            try: pg.evaluate(AUTO)
            except Exception as e: errs.append("auto: " + str(e))
        if pages[0].evaluate("() => G.finished"):
            break
        time.sleep(0.3)
    time.sleep(0.8)

    print("== 场景1：结算后底部按钮 ==")
    btns = pages[0].evaluate("() => Array.from(document.querySelectorAll('#acts button')).map(b => b.textContent)")
    check("底部有「准备下一局」", '准备下一局' in btns, btns)
    check("底部有「回到首页」", '回到首页' in btns, btns)
    check("底部有「查看结算」", '查看结算' in btns, btns)
    check("底部没有旧「下一局」", '下一局' not in btns, btns)

    print("== 场景2：点「准备下一局」→ 牌河显示「准备」可取消 ==")
    pages[0].evaluate("() => { const b = Array.from(document.querySelectorAll('#acts button')).find(x => x.textContent === '准备下一局'); if (b) b.click(); }")
    pages[0].wait_for_timeout(600)
    badge = pages[0].evaluate("() => { const d = document.querySelector('#rvS .readyBadge'); return d ? d.textContent : null; }")
    check("自己牌河显示「准备」字样", badge == '准备', badge)
    btns2 = pages[0].evaluate("() => Array.from(document.querySelectorAll('#acts button')).map(b => b.textContent)")
    check("按钮变为「取消准备」", '取消准备' in btns2, btns2)

    # 取消
    pages[0].evaluate("() => { const b = Array.from(document.querySelectorAll('#acts button')).find(x => x.textContent === '取消准备'); if (b) b.click(); }")
    pages[0].wait_for_timeout(600)
    badge2 = pages[0].evaluate("() => { const d = document.querySelector('#rvS .readyBadge'); return d ? d.textContent : null; }")
    check("取消后牌河「准备」字样消失", badge2 is None, badge2)

    print("== 场景2.5：准备状态其他三家可见 ==")
    pages[0].evaluate("() => { const b = Array.from(document.querySelectorAll('#acts button')).find(x => x.textContent === '准备下一局'); if (b) b.click(); }")
    pages[0].wait_for_timeout(600)
    seen = [pages[i].evaluate("() => document.querySelectorAll('#app .readyBadge').length") for i in range(1, 4)]
    check("其他三家都能看到房主的「准备」字样", all(n >= 1 for n in seen), seen)
    self_badge = pages[0].evaluate("() => !!document.querySelector('#rvS .readyBadge')")
    check("房主自己的准备字样在自己牌河", self_badge)

    print("== 场景2.6：结算后断线重连，底部按钮不消失 ==")
    # 关掉结算弹窗，模拟浏览器切后台把 WS 断掉后回前台触发的重连
    pages[0].evaluate("() => closeSheet()")
    pages[0].wait_for_timeout(300)
    btns0 = pages[0].evaluate("() => Array.from(document.querySelectorAll('#acts button')).map(b => b.textContent)")
    check("重连前底部按钮在", '准备下一局' in btns0 or '取消准备' in btns0, btns0)
    # 强制断线 → 立即重连（等价于切后台后回前台触发的 netKickReconnect）
    pages[0].evaluate("() => { try{ NET.ws.onclose = null; NET.ws.onerror = null; NET.ws.close(); }catch(e){} NET.ws = null; NET.reconnecting = false; NET.reconnectTries = 0; netKickReconnect(); }")
    pages[0].wait_for_timeout(3500)
    st = pages[0].evaluate("""() => ({
      fin: G.finished, tableOn: NET.tableOn, roomNo: NET.roomNo,
      btns: Array.from(document.querySelectorAll('#acts button')).map(b => b.textContent),
      badge: !!(document.querySelector('#rvS .readyBadge'))
    })""")
    check("重连后仍在牌桌且 finished=true", st['fin'] and st['tableOn'], st)
    check("重连后底部按钮仍在（准备/回到首页/查看结算）",
          any('准备' in t for t in st['btns']) and '回到首页' in st['btns'] and '查看结算' in st['btns'], st['btns'])
    check("重连后准备状态保留（牌河仍有「准备」）", st['badge'])

    print("== 场景3：四家都准备 → 自动进入下一局 ==")
    for pg in pages:
        pg.evaluate("() => { const b = Array.from(document.querySelectorAll('#acts button')).find(x => x.textContent === '准备下一局'); if (b) b.click(); }")
    pages[0].wait_for_timeout(2000)
    handNo = pages[0].evaluate("() => G.handNo")
    finished = pages[0].evaluate("() => G.finished")
    check("四家准备后自动进入下一局", (not finished) and handNo >= 2, f"handNo={handNo} finished={finished}")

    b.close()

print("JS 错误:", errs[:6] if errs else "无")
print("结果:", "✅ 全部通过" if ok and not errs else "❌ 有失败项")
sys.exit(0 if ok and not errs else 1)
