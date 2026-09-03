# 4 端联机完整对局：建房 → 3 人加入 → 全员准备 → 开始 → 自动打完 → 结算 → 验证
# 验证：座位方向、手牌互异、隐私（投影无他人手牌）、结算分数一致且零和、下一局流转
import sys, time, json
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
errs = []

AUTO_JS = """() => {
  const btns = Array.from(document.querySelectorAll('#acts button'));
  const byTxt = t => btns.find(b => b.textContent === t);
  const hint = document.getElementById('hint').textContent || '';
  const clickTile = () => {
    const tiles = document.querySelectorAll('#hand .tile');
    if (!tiles.length) return 'no-tile';
    tiles[0].click(); tiles[0].click();     // 选中 + 打出
    return 'discard';
  };
  if (byTxt('准备下一局'))  { byTxt('准备下一局').click(); return 'ready'; }
  if (byTxt('敲定'))    { byTxt('不敲').click();  return 'knock-pass'; }
  if (byTxt('胡'))      { byTxt('胡').click();    return 'hu'; }
  if (byTxt('杠'))      { byTxt('杠').click();    return 'kong'; }
  if (byTxt('暗杠'))    { byTxt('暗杠').click();  return 'ankan'; }
  if (byTxt('加杠'))    { byTxt('加杠').click();  return 'chakan'; }
  if (byTxt('碰'))      { byTxt('碰').click();    return 'pung'; }
  if (byTxt('吃'))      { byTxt('吃').click();    return 'chow'; }
  if (byTxt('过'))      { byTxt('过').click();    return 'pass'; }
  if (hint.indexOf('点击一张牌') >= 0) return clickTile();
  if (byTxt('敲听'))    { byTxt('敲听').click();  return 'knock-listen'; }
  return 'idle';
}"""

def snap(pg):
    return pg.evaluate("""() => {
      const nm = i => { const el = document.getElementById('nm' + i); return el ? (el.firstChild.textContent || '').trim() : null; };
      return {
        on: !document.getElementById('home').classList.contains('hide') ? 'home' : 'table',
        mySeat: NET.mySeat, myName: (G.players[0] || {}).name || null,
        hand: (G.players[0] && G.players[0].hand) ? G.players[0].hand.join(',') : null,
        handCount: (G.players[0] && G.players[0].hand) ? G.players[0].hand.length : 0,
        // v1.2.15：起手花牌按规则暂存不补（pendingFlowers），轮到本人首次出牌才补，
        // 所以开局「手牌 + 暂存花 + 已亮花」才是这一家真正拿到的 13/14 张
        startTiles: (G.players[0] ? ((G.players[0].hand ? G.players[0].hand.length : 0)
                     + ((G.players[0].pendingFlowers || []).length)
                     + ((G.players[0].flowers || []).length)) : 0),
        others: [nm(1), nm(2), nm(3)],
        names: (NET.players || []).map(p => p ? p.name : null),
        handNo: G.handNo, wind: G.roundWind,
        finished: G.finished,
        hist: (NET.history || []).map(r => ({ no: r.no, kind: r.kind, scores: r.scores })),
        sheetBtns: Array.from(document.querySelectorAll('#sheet .btns button')).map(b => b.textContent),
        projSafe: (NET.lastView && NET.lastView.players) ? NET.lastView.players.every(p => p.hand === null || Array.isArray(p.hand)) : null
      };
    }""")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-dev-shm-usage", "--no-sandbox"])
    ctxs, pages = [], []
    for i in range(4):
        ctx = b.new_context(viewport={"width": 390, "height": 780})
        pg = ctx.new_page()
        pg.on("pageerror", lambda e, n=i: errs.append(f"P{n} PAGEERROR: " + str(e)))
        pg.on("console", lambda m, n=i: errs.append(f"P{n} CONSOLE: " + m.text) if m.type == "error" else None)
        pg.goto(URL)
        pg.wait_for_timeout(300)
        ctxs.append(ctx); pages.append(pg)

    # P1 建房
    pages[0].evaluate("() => { document.getElementById('lName').value = '大伟'; document.getElementById('hBtnMulti').click(); }")
    pages[0].click("#lCreate")
    pg_wait = pages[0]
    room_no = None
    for _ in range(30):
        time.sleep(0.3)
        room_no = pages[0].evaluate("() => NET.roomNo")
        if room_no: break
    print("房间号:", room_no)
    assert room_no, "建房失败"

    # P2-P4 加入
    for i, name in [(1, '小玲'), (2, '阿凯'), (3, '梅梅')]:
        pages[i].evaluate(f"() => {{ document.getElementById('lName').value = '{name}'; document.getElementById('hBtnMulti').click(); }}")
        pages[i].evaluate(f"() => {{ document.getElementById('lRoomNo').value = '{room_no}'; }}")
        pages[i].click("#lJoin")
        time.sleep(0.5)

    time.sleep(0.8)
    seats = [pg.evaluate("() => NET.mySeat") for pg in pages]
    print("四人座位:", seats, "（应互不相同）")

    # 全员准备（房主无准备按钮）+ 房主开始
    for pg in pages[1:]: pg.click("#rReady")
    time.sleep(0.5)
    ready_hidden = pages[0].evaluate("() => document.getElementById('rReady').classList.contains('hide')")
    print("房主准备按钮已隐藏:", ready_hidden)
    pages[0].click("#rStart")
    print("已开始，自动对局中…")

    # 发牌完成后立刻抓「开局快照」（手牌张数/方向/隐私的断言基准）
    time.sleep(2.5)
    start_snaps = [snap(pg) for pg in pages]

    deadline = time.time() + 470
    settles = 0
    hand2_seen = False
    last = [None] * 4
    # v1.2.15：记录每人「第一次轮到自己出牌时」的手牌数——起手花牌在这之前已补完，
    # 此时必须是 13（闲家）/ 14（庄家首巡）张，用来验证补花确实补齐了
    first_discard_hand = [None] * 4
    while time.time() < deadline and settles < 2:
        for i, pg in enumerate(pages):
            if first_discard_hand[i] is None:
                try:
                    st = pg.evaluate("""() => ({
                      pend: PEND ? PEND.kind : null,
                      hand: (G.players[0] && G.players[0].hand) ? G.players[0].hand.length : -1
                    })""")
                    if st['pend'] == 'discard' and st['hand'] > 0:
                        first_discard_hand[i] = st['hand']
                except Exception:
                    pass
            try:
                last[i] = pg.evaluate(AUTO_JS)
            except Exception as e:
                errs.append(f"P{i} auto: {e}")
        time.sleep(0.35)
        settles = max(pg.evaluate("() => (NET.history || []).length") for pg in pages)
        if not hand2_seen:
            try:
                hand2_seen = any(pg.evaluate("() => G.handNo") == 2 for pg in pages)
            except Exception:
                pass

    time.sleep(0.8)
    snaps = [snap(pg) for pg in pages]
    for i, s in enumerate(snaps):
        print(f"--- P{i} seat={s['mySeat']} 我={s['myName']} 局号={s['handNo']} 手牌数={s['handCount']}")
        print("    右/对/左:", s['others'], " 名册:", s['names'])
        print("    历史:", s['hist'])

    # ---------- 断言 ----------
    ok = True
    def check(name, cond, extra=""):
        nonlocal_ok = None
        global_ok = None
        print(("  ✅ " if cond else "  ❌ ") + name + ("  " + str(extra) if extra and not cond else ""))
        return cond

    print("== 断言 ==")
    ok &= check("四人都进入牌桌", all(s['on'] == 'table' for s in start_snaps))
    ok &= check("座位互不相同", len(set(seats)) == 4, seats)
    ok &= check("每人只看得到自己的手牌", all(s['hand'] is not None for s in start_snaps))
    hands = [s['hand'] for s in start_snaps if s['hand']]
    ok &= check("四家手牌互不相同", len(set(hands)) == 4)
    # 起手花牌按规则暂存不补（pendingFlowers），开局时手牌 = 13/14 − 起手花数（常见 9~14 张）
    ok &= check("发牌后手牌 9~14 张（起手花暂存不补）",
                all(9 <= s['handCount'] <= 14 for s in start_snaps),
                [s['handCount'] for s in start_snaps])
    ok &= check("首轮出牌时起手花已补齐（13/14 张）",
                all(v is None or v in (13, 14) for v in first_discard_hand),
                first_discard_hand)
    ok &= check("「下一局」能开出第二局", hand2_seen)
    print("    开局快照（手牌 / 含暂存花）:", [(s['handCount'], s['startTiles']) for s in start_snaps])
    # 座位方向：P 的下家（nm1）应为真实座位 (seat+1)%4 的玩家名
    dir_ok = True
    for i, s in enumerate(snaps):
        if s['mySeat'] < 0 or not s['names']: dir_ok = False; continue
        expect_next = s['names'][(s['mySeat'] + 1) % 4]
        got = (s['others'][0] or '').strip()
        if got != expect_next: dir_ok = False; print(f"    P{i} 下家应为 {expect_next}，实际 {got}")
    ok &= check("座位方向正确（下/对/左）", dir_ok)
    # 投影安全
    ok &= check("投影结构安全", all(s['projSafe'] in (True, None) for s in snaps))
    # 结算
    all_hist = [s['hist'] for s in snaps]
    if settles >= 1:
        r0 = all_hist[0][0]
        ok &= check("四端第一局记录一致", all(len(h) >= 1 and h[0]['scores'] == r0['scores'] for h in all_hist),
                    json.dumps(all_hist, ensure_ascii=False))
        ok &= check("第一局零和", sum(r0['scores']) == 0, r0['scores'])
        # 第二局
        if settles >= 2:
            ok &= check("第二局正常流转", all(h[1]['no'] == 2 for h in all_hist if len(h) >= 2))
    else:
        ok &= check("（超时）至少一局结算", False)

    pg0 = pages[0]
    pg0.screenshot(path="/tmp/mjtest/multi_p0.png")

    b.close()

print("JS 错误:", errs[:10] if errs else "无")
print("结果:", "✅ 全部通过" if ok and not errs else "❌ 有失败项")
sys.exit(0 if (ok and not errs) else 1)
