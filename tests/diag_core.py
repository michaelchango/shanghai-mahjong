# 诊断：对比单机 / 多人下桌心区域（turnNow + log）的文字是否被裁切
import sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"

PROBE = """() => {
  const info = el => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      text: el.textContent.trim(),
      clientW: el.clientWidth, scrollW: el.scrollWidth,
      clientH: el.clientHeight, scrollH: el.scrollHeight,
      overflowX: el.scrollWidth > el.clientWidth + 1,
      overflowY: el.scrollHeight > el.clientHeight + 1,
      whiteSpace: cs.whiteSpace, textOverflow: cs.textOverflow, fontSize: cs.fontSize
    };
  };
  const core = document.querySelector('.core');
  return {
    core: info(core),
    turnNow: info(document.getElementById('turnNow')),
    log: info(document.getElementById('log')),
    logLines: Array.from(document.querySelectorAll('#log div')).map(d => ({
      t: d.textContent, w: d.scrollWidth, cw: d.clientWidth, cut: d.scrollWidth > d.clientWidth + 1
    })),
    logs: (typeof G !== 'undefined' && G.logs) ? G.logs.slice(-3) : null
  };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-dev-shm-usage", "--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 780})
    pg = ctx.new_page()
    pg.goto(URL); pg.wait_for_timeout(400)

    # --- 单机 ---
    pg.click("#hBtnSolo"); pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }"); pg.wait_for_timeout(2500)
    solo = pg.evaluate(PROBE)
    pg.locator(".core").screenshot(path="/tmp/mjtest/core_solo.png")
    print("【单机】")
    print("  turnNow:", solo['turnNow'])
    print("  log:", solo['log'])
    for l in solo['logLines']: print("   行:", l)
    print("  logs:", solo['logs'])

    # 单机：自动打十几手，让日志累积到 3 行
    AUTO_SOLO = """() => {
      const b = Array.from(document.querySelectorAll('#acts button'));
      const by = t => b.find(x => x.textContent === t);
      if (by('下一局')) { by('下一局').click(); return; }
      if (by('不敲')) { by('不敲').click(); return; }
      const t = document.querySelectorAll('#hand .tile');
      if (t.length && (document.getElementById('hint').textContent || '').indexOf('点击一张牌') >= 0){
        t[0].click(); t[0].click(); return;
      }
      if (by('胡')) by('胡').click();
      else if (by('碰')) by('碰').click();
      else if (by('吃')) by('吃').click();
    }"""
    AUTO_NET = """() => {
      const b = Array.from(document.querySelectorAll('#acts button'));
      const by = t => b.find(x => x.textContent === t);
      if (by('下一局')) { by('下一局').click(); return; }
      if (by('不敲')) { by('不敲').click(); return; }
      const t = document.querySelectorAll('#hand .tile');
      if (t.length && (document.getElementById('hint').textContent || '').indexOf('点击一张牌') >= 0){
        t[0].click(); t[0].click(); return;
      }
      if (by('胡')) by('胡').click();
      else if (by('碰')) by('碰').click();
      else if (by('吃')) by('吃').click();
    }"""
    for _ in range(16):
        pg.evaluate(AUTO_SOLO); pg.wait_for_timeout(700)
    solo = pg.evaluate(PROBE)
    pg.locator(".core").screenshot(path="/tmp/mjtest/core_solo.png")
    print("\n【单机 · 打牌后】")
    print("  turnNow:", solo['turnNow'])
    print("  core 高:", solo['core']['clientH'], "内容高:", solo['core']['scrollH'],
          "纵向溢出:", solo['core']['overflowY'])
    for l in solo['logLines']: print("   行:", l)

    # --- 多人（1 真人 + 3 机器人，用长昵称压测）---
    pg2 = ctx.new_page()
    pg2.goto(URL); pg2.wait_for_timeout(300)
    pg2.click("#hBtnMulti"); pg2.wait_for_timeout(200)
    pg2.fill("#lName", "一二三四五六")
    pg2.click("#lCreate"); pg2.wait_for_timeout(700)
    pg2.click("#rReady"); pg2.wait_for_timeout(200)
    pg2.click("#rStart"); pg2.wait_for_timeout(3000)
    for _ in range(16):
        pg2.evaluate(AUTO_NET); pg2.wait_for_timeout(700)
    multi = pg2.evaluate(PROBE)
    pg2.locator(".core").screenshot(path="/tmp/mjtest/core_multi.png")
    print("\n【多人】")
    print("  turnNow:", multi['turnNow'])
    print("  log:", multi['log'])
    for l in multi['logLines']: print("   行:", l)
    print("  logs:", multi['logs'])
    print("  core 高:", multi['core']['clientH'], "内容高:", multi['core']['scrollH'],
          "纵向溢出:", multi['core']['overflowY'])
    b.close()
