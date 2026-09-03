# m35：桌心新布局多视口自适应（问题 4）
#  1) 圆上方：骰子 + 剩余牌（豹子只高亮不写字）
#  2) 圆中间：纯数字黄色倒计时（单机/机器人「——」）
#  3) 圆下方：最近手牌 0~3 行，空间不够「减行」而不是重叠
#  4) 各视口下：骰子行不压圆、log 行不压圆、log 行之间不重叠、整块不溢出牌桌
import sys
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8099/'
errs = []
ok = True

def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("  ✅ " if cond else "  ❌ ") + name + (("  " + str(extra)) if extra and not cond else ""))

# 视口：(宽, 高, 说明)
VIEWS = [
    (360, 640, '小屏 360×640'),
    (390, 780, '常见手机 390×780'),
    (430, 932, '大屏手机 430×932'),
    (600, 800, '窄高 600×800'),
    (780, 700, '矮宽 780×700'),
    (1000, 760, '平板横 1000×760'),
]

PROBE = """() => {
  const r = el => { const b = el.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), h: Math.round(b.height) }; };
  const dl = document.getElementById('diceLine');
  const dial = document.querySelector('.dial');
  const ctr = document.querySelector('.dial .ctr');
  const cd = document.getElementById('cdTxt');
  const logBox = document.getElementById('log');
  const more = document.getElementById('btnLog');
  const core = document.querySelector('.core');
  const rows = [...logBox.querySelectorAll('div')];
  const rowRects = rows.map(r);
  // 相邻行是否重叠（log 是 column-reverse，DOM 顺序与视觉相反 → 按 top 排序后再比）
  const byTop = rowRects.slice().sort((a, b) => a.t - b.t);
  let overlap = false;
  for (let i = 1; i < byTop.length; i++){
    if (byTop[i].t < byTop[i-1].b - 1) overlap = true;
  }
  const logR = r(logBox), dialR = r(dial), dlR = r(dl), moreR = r(more), coreR = r(core), ctrR = r(ctr);
  return {
    rows: rowRects.length,
    rowOverlap: overlap,
    rowH: rowRects.length ? rowRects[0].h : 0,
    diceHasSvg: !!(dl && dl.querySelector('.diceC')),
    wallTxt: (document.getElementById('wallTxt') || {}).textContent,
    diceLineText: dl ? dl.textContent.replace(/\\s+/g, '') : '',
    cdText: cd ? cd.textContent : null,
    cdColor: cd ? getComputedStyle(cd).color : null,
    cdInsideCircle: ctrR.t <= r(cd).t && r(cd).b <= ctrR.b,
    noTurnWord: dl ? (dl.textContent.indexOf('轮到') < 0) : false,
    diceAboveDial: dlR.b <= dialR.t + 1,
    logBelowDial: logR.t >= dialR.b - 1,
    moreBelowLog: more ? moreR.t >= logR.b - 1 : true,
    coreBottomOk: coreR.b <= document.body.scrollHeight + 1,
    docScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight
  };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-dev-shm-usage', '--no-sandbox'])
    for (w, h, desc) in VIEWS:
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.on('pageerror', lambda e: errs.append('%s:%s' % (desc, e)))
        pg.goto(URL, wait_until='domcontentloaded'); pg.wait_for_timeout(300)
        pg.click('#hBtnSolo'); pg.evaluate("() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click(); }"); pg.wait_for_timeout(1500)
        # 打几手，让「最近手牌」有内容
        for _ in range(14):
            pg.evaluate("""() => {
              const btn = [...document.querySelectorAll('#acts button')];
              const by = t => btn.find(x => x.textContent.trim() === t);
              if (by('准备下一局')) { by('准备下一局').click(); return; }
              if (PEND && PEND.kind === 'discard'){
                const t = document.querySelectorAll('#hand .tile');
                if (t.length){ t[0].click(); t[0].click(); }
                return;
              }
              if (by('胡')) { by('胡').click(); return; }
              if (by('不敲')) { by('不敲').click(); return; }
              if (by('过')) by('过').click();
            }""")
            pg.wait_for_timeout(400)
        s = pg.evaluate(PROBE)
        print('== %s ==  最近手牌 %d 行（行高 %d）' % (desc, s['rows'], s['rowH']))
        check('骰子行含骰子图形', s['diceHasSvg'], s)
        check('剩余牌为数字且跟在骰子后', (s['wallTxt'] or '').isdigit()
              and s['diceLineText'].endswith(str(s['wallTxt']).strip()), s['diceLineText'])
        check('圆上方无「轮到」', s['noTurnWord'], s['diceLineText'])
        check('骰子行不压圆', s['diceAboveDial'], s)
        # v1.2.16：无人决策时圆心留空；有人决策时是纯数字
        check('圆心为纯数字或留空（无「——」）',
              str(s['cdText']).strip() == '' or str(s['cdText']).strip().isdigit(), repr(s['cdText']))
        check('倒计时在圆内', s['cdInsideCircle'], s)
        check('最近手牌不超过 3 行', s['rows'] <= 3, s['rows'])
        check('最近手牌行之间不重叠', not s['rowOverlap'], s)
        check('最近手牌在圆下方', s['logBelowDial'], s)
        check('「全部手牌记录」在手牌下方', s['moreBelowLog'], s)
        check('页面无纵向溢出', s['docScroll'] <= 1, s['docScroll'])
        pg.close()
    b.close()

print('JS 错误:', errs[:8] if errs else '无')
print('结果:', '✅ 全部通过' if ok and not errs else '❌ 有失败项')
sys.exit(0 if ok and not errs else 1)
