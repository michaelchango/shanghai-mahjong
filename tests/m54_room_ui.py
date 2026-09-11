# m54：等待室昵称展示 / 准备高亮 / 倒计时设置项常显（v1.2.41）
import sys
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8099/'

INJECT = """()=>{
  NET.active = true; NET.mySeat = 0; NET.isHost = true; NET.roomNo = '123456';
  NET.players = [
    { seat:0, name:'八个字的名字测试', ready:false, online:true, host:true },
    { seat:1, name:'六个字的名字OK', ready:true, online:true, host:false },
    { seat:2, name:'掉线的小明', ready:false, online:false, host:false },
    { seat:3, name:'已准备的人', ready:true, online:true, host:false }
  ];
  $('homePick').classList.add('hide');
  $('homeLobby').classList.add('hide');
  $('homeRoom').classList.remove('hide');
  renderRoom();
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 390, 'height': 844})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until='domcontentloaded')
    pg.wait_for_timeout(400)
    pg.evaluate(INJECT)
    pg.wait_for_timeout(500)

    info = pg.evaluate("""()=>{
      const out = [];
      for (const el of document.querySelectorAll('#rBoard .rSeatSlot')){
        const nm = el.querySelector('.rSeatName'), tags = el.querySelector('.rSeatTags');
        const nr = nm ? nm.getBoundingClientRect() : null;
        out.push({ cls: el.className.replace('rSeatSlot','').trim(),
                   name: nm ? nm.textContent : '',
                   badgeInName: nm ? !!nm.querySelector('.st') : null,   // 昵称行里不应再混标签
                   clipped: nm ? (nm.scrollWidth > nm.clientWidth + 1 || nm.scrollHeight > nm.clientHeight + 2) : false,
                   tags: tags ? tags.textContent : '' });
      }
      const b = document.querySelector('#rBoard').getBoundingClientRect();
      return { seats: out, boardW: Math.round(b.width) };
    }""")
    print('board 宽:', info['boardW'])
    for s in info['seats']:
        print('  [%s] %r 截断=%s 标签=%r' % (s['cls'], s['name'], s['clipped'], s['tags']))

    ml = pg.evaluate("()=>document.getElementById('lName').maxLength")
    print('昵称输入 maxlength:', ml)

    pg.evaluate("()=>openSet()")
    pg.wait_for_timeout(300)
    txt = pg.inner_text('#sheet')
    hasCd = '出牌倒计时' in txt
    cdOn = pg.evaluate("()=>{ const el=document.querySelector('#sgCd .on'); return el?el.textContent:''; }")
    print('设置含「出牌倒计时」:', hasCd, '| 当前选中:', cdOn)
    pg.evaluate("()=>closeSet()")

    checks = {
        'board 已放大(>=340)':        info['boardW'] >= 340,
        '8 字昵称不截断':             all(not s['clipped'] for s in info['seats']),
        '已准备座位框高亮(2个)':       sum(1 for s in info['seats'] if 'readyok' in s['cls']) == 2,
        '掉线座位不高亮':             all('readyok' not in s['cls'] for s in info['seats'] if '掉线' in s['tags']),
        '标签独立成行(昵称行无 .st)':  all(s['badgeInName'] is False for s in info['seats']),
        '昵称输入上限 8':             ml == 8,
        '设置含「出牌倒计时」':        hasCd,
        '倒计时默认选中「无」':        cdOn == '无',
    }
    print('--- 校验 ---')
    allok = True
    for k, v in checks.items():
        print(('  ✅ ' if v else '  ❌ ') + k)
        allok = allok and v
    print('JS 错误:', errs if errs else '无')
    print('结果:', '✅ 通过' if allok and not errs else '❌ 失败')
    b.close()
    sys.exit(0 if allok and not errs else 1)
