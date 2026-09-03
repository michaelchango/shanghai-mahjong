# m40：v1.2.18 UI 三项改动
#  A. 单机入口先弹设置：底部「返回 / 开始游戏」；开始后开局；局内改设置点「完成」弹
#     「重新开局？」确认——取消=不改不重开、确定=应用并清记录重开（新发牌）
#  B. 点手牌算牌：自己吃碰杠区（副露）同牌也高亮 + 高亮样式加强（3px 蓝 + 光晕）
#  C. 已敲定且唯一听张：按钮上方显示「听牌中 → xx · 还有 n 张」
import sys, time
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8099/'
errs = []
ok = True

def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("  ✅ " if cond else "  ❌ ") + name + (("  " + str(extra)) if extra and not cond else ""))

START_SOLO = """() => {
  const b = [...document.querySelectorAll('#sheet .btns button')].find(x => x.textContent === '开始游戏');
  if (b) b.click();
}"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg = b.new_page(viewport={'width': 390, 'height': 780})
    pg.on('pageerror', lambda e: errs.append('A:' + str(e)))

    # ===== Part A：单机入口流程 =====
    print('== Part A：单机入口先弹设置 ==')
    pg.goto(URL, wait_until='domcontentloaded'); pg.wait_for_timeout(300)
    pg.click('#hBtnSolo'); pg.wait_for_timeout(300)
    st = pg.evaluate("""() => ({
      sheetOn: !!document.getElementById('sheet').innerHTML.trim().length,
      btns: [...document.querySelectorAll('#sheet .btns button')].map(x => x.textContent),
      rows: document.querySelectorAll('#sheet .setrow').length,
      homeStill: !document.getElementById('home').classList.contains('hide')
    })""")
    check('点单机弹出设置面板', st['sheetOn'] and st['homeStill'], st)
    check('底部按钮为「返回 / 开始游戏」', st['btns'] == ['返回', '开始游戏'], st['btns'])
    check('面板含玩法行等规则项', st['rows'] >= 8, st['rows'])

    # 「返回」→ 回首页不开局
    pg.evaluate("""() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='返回'); if(b) b.click(); }""")
    pg.wait_for_timeout(300)
    st = pg.evaluate("() => ({ maskHide: document.getElementById('mask').classList.contains('hide'), homeOn: !document.getElementById('home').classList.contains('hide') })")
    check('点「返回」关闭面板仍在首页', st['maskHide'] and st['homeOn'], st)

    # 「开始游戏」→ 开局
    pg.click('#hBtnSolo'); pg.wait_for_timeout(200)
    pg.evaluate(START_SOLO); pg.wait_for_timeout(1500)
    st = pg.evaluate("""() => ({
      homeHide: document.getElementById('home').classList.contains('hide'),
      hand: document.querySelectorAll('#hand .tile').length,
      maskHide: document.getElementById('mask').classList.contains('hide')
    })""")
    check('点「开始游戏」进入牌桌并关面板', st['homeHide'] and st['maskHide'], st)
    check('已发牌', st['hand'] >= 9, st['hand'])

    # 局内改设置 → 完成 → 确认弹窗
    pg.click('#btnSet'); pg.wait_for_timeout(300)
    pg.evaluate("""() => {
      const rows=[...document.querySelectorAll('#sheet .setrow')];
      const row=rows.find(r=>r.querySelector('.lb').textContent.startsWith('底'));
      const t=[...row.querySelectorAll('.seg button')].find(x=>x.textContent.trim()==='3');
      t.click();
    }""")
    pg.wait_for_timeout(200)
    pg.evaluate("""() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='完成'); if(b) b.click(); }""")
    pg.wait_for_timeout(300)
    c1 = pg.evaluate("""() => ({
      head: (document.querySelector('#sheet h2 span')||{}).textContent || '',
      btns: [...document.querySelectorAll('#sheet .btns button')].map(x => x.textContent),
      txt: document.querySelector('#sheet .ru') ? document.querySelector('#sheet .ru').textContent : ''
    })""")
    check('完成 → 弹「重新开局？」确认', c1['head'] == '重新开局？', c1['head'])
    check('确认文案提示清空记录重开', '清空本局记录' in c1['txt'] and '重新开局' in c1['txt'], c1['txt'])
    check('确认按钮为「取消 / 确定，重新开局」', c1['btns'] == ['取消', '确定，重新开局'], c1['btns'])

    # 取消 → 设置不生效、本局继续
    pg.evaluate("""() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='取消'); if(b) b.click(); }""")
    pg.wait_for_timeout(300)
    st = pg.evaluate("() => ({ base: CFG.base, running: !!G.running, hand: G.players[0].hand.length })")
    check('取消后设置未生效（底=2）', st['base'] == 2, st)
    check('取消后本局继续（手牌还在）', st['running'] or st['hand'] > 0, st)

    # 再改 → 完成 → 确定，重新开局 → 设置生效 + 新局
    pg.click('#btnSet'); pg.wait_for_timeout(300)
    pg.evaluate("""() => {
      const rows=[...document.querySelectorAll('#sheet .setrow')];
      const row=rows.find(r=>r.querySelector('.lb').textContent.startsWith('底'));
      const t=[...row.querySelectorAll('.seg button')].find(x=>x.textContent.trim()==='3');
      t.click();
    }""")
    pg.wait_for_timeout(200)
    pg.evaluate("""() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='完成'); if(b) b.click(); }""")
    pg.wait_for_timeout(200)
    pg.evaluate("""() => { const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='确定，重新开局'); if(b) b.click(); }""")
    pg.wait_for_timeout(1600)
    st = pg.evaluate("""() => ({
      base: CFG.base, homeHide: document.getElementById('home').classList.contains('hide'),
      hand: document.querySelectorAll('#hand .tile').length, handNo: G.handNo
    })""")
    check('确定后设置生效（底=3）', st['base'] == 3, st)
    check('已重新开局发牌', st['homeHide'] and st['hand'] >= 9, st)

    # ===== Part B：副露高亮 + 加强 =====
    print('== Part B：吃碰杠区高亮 ==')
    # 等轮到我出牌（庄家先手）以便选中
    for _ in range(30):
        pend = pg.evaluate("() => (PEND ? PEND.kind : 'none')")
        if pend == 'discard': break
        pg.wait_for_timeout(400)
    # 注入：自己副露里有一萬刻子、牌河里有別家打的一萬、手里也有一萬可选中
    pg.evaluate("""() => {
      const me = G.players[0];
      me.melds.push({ type: 'pung', tile: 0, tiles: [0,0,0], from: 1 });
      const other = G.players.find(q => q !== me);
      other.discards.push(0);
      if (me.hand.indexOf(0) < 0){ me.hand.push(0); }
      me.hand = me.hand.slice().sort((a,b)=>a-b);
      render();
    }""")
    pg.wait_for_timeout(300)
    # 选中手里的一张一萬
    pg.evaluate("""() => {
      const tiles=[...document.querySelectorAll('#hand .tile')];
      const t=tiles.find(el=>el.__t===undefined && true);
      // 通过点击事件选中一萬：手牌 DOM 顺序=排序后，第 1 张即一萬（若手里有）
      const me=G.players[0];
      const k=me.hand.indexOf(0);
      const els=[...document.querySelectorAll('#hand .tile')];
      if (k>=0 && els[k]){ els[k].click(); }
    }""")
    pg.wait_for_timeout(300)
    hl = pg.evaluate("""() => {
      const river = document.querySelectorAll('.river .tile.hl').length;
      const meld = document.querySelectorAll('#ml0 .meld .tile.hl').length;
      const sel = SEL;
      const cs = getComputedStyle(document.querySelector('#ml0 .meld .tile.hl') || document.querySelector('.river .tile.hl'));
      return { sel, river, meld, shadow: cs ? cs.boxShadow : '' };
    }""")
    check('牌河同牌高亮', hl['river'] >= 1, hl)
    check('自己吃碰杠区同牌也高亮', hl['meld'] >= 3, hl)   # 一萬刻子 3 张全亮
    check('高亮样式加强（3px 蓝框 + 光晕）', '57, 192, 255' in hl['shadow'] or '39, 192, 255' in hl['shadow'], hl['shadow'][:120])

    # 点空白取消选中，副露高亮消失
    pg.evaluate("""() => { document.getElementById('hand').dispatchEvent(new MouseEvent('click', { bubbles: true })); }""")
    pg.wait_for_timeout(200)
    gone = pg.evaluate("() => document.querySelectorAll('#ml0 .meld .tile.hl').length")
    check('取消选中后副露高亮清除', gone == 0, gone)

    # ===== Part C：唯一听张提示 =====
    print('== Part C：唯一听法提示 ==')
    # 构造：已敲定、只听说白板
    pg.evaluate("""() => {
      const me = G.players[0];
      me.knocked = true;
      me.knockWaits = [33];
      render();
    }""")
    pg.wait_for_timeout(300)
    # 需要轮到出牌（PEND discard）时 hint 才显示唯一听张
    for _ in range(20):
        pend = pg.evaluate("() => (PEND ? PEND.kind : 'none')")
        if pend == 'discard': break
        pg.evaluate("""() => { const by=t=>[...document.querySelectorAll('#acts button')].find(x=>x.textContent.trim()===t); if(by('过')) by('过').click(); }""")
        pg.wait_for_timeout(400)
    pg.evaluate("() => { renderActs(); }")
    pg.wait_for_timeout(200)
    h = pg.evaluate("() => ({ hint: document.getElementById('hint').innerHTML, knocked: G.players[0].knocked, waits: G.players[0].knockWaits })")
    check('唯一听法时按钮上方显示「听牌中 → 白」', '听牌中' in h['hint'] and '白' in h['hint'], h['hint'])
    check('提示含剩余张数', '还有' in h['hint'] and '张' in h['hint'], h['hint'])

    pg.close(); b.close()

print('JS 错误:', '、'.join(errs) if errs else '无')
print('结果:', '✅ 全部通过' if (ok and not errs) else '❌ 有失败项')
sys.exit(0 if (ok and not errs) else 1)
