# m56：等待页在手机视口下「房间号」和「退出房间」必须都够得着（v1.2.43）
#   #home 是 position:fixed + overflow:hidden —— 内容高于视口时上下两头直接被截断，
#   必须给手机浏览器开全屏才看得见。修完要求：
#     ① 盒子本身不超出视口（不被 #home 截断）
#     ② 常规手机视口（≥620 高）内容完全放得下、无需滚动
#     ③ 极矮屏允许 #homeRoom 内部滚动，但「退出房间」必须能滚到
import sys
from playwright.sync_api import sync_playwright

INJECT = """()=>{
  NET.active=true; NET.mySeat=0; NET.isHost=true; NET.roomNo='123456';
  NET.players=[{seat:0,name:'八个字的名字测试',ready:false,online:true,host:true},
               {seat:1,name:'六个字的名字OK',ready:true,online:true,host:false},
               {seat:2,name:'掉线的小明',ready:false,online:false,host:false},
               {seat:3,name:'已准备的人',ready:true,online:true,host:false}];
  $('homePick').classList.add('hide'); $('homeLobby').classList.add('hide');
  $('homeRoom').classList.remove('hide'); renderRoom();
}"""

CHECKS = """()=>{
  const box=document.getElementById('homeRoom');
  if(!box) return {err:'no homeRoom'};
  const bb=box.getBoundingClientRect();
  const rnEl=document.querySelector('#homeRoom .rNoLab');
  const lvEl=document.getElementById('rLeave');
  const board=document.getElementById('rBoard');
  const vh=window.innerHeight;
  const inBox = el => { const b=el.getBoundingClientRect(); return b.top >= bb.top-0.5 && b.bottom <= bb.bottom+0.5; };
  // 真的滚到底，再判断「退出房间」是否露出来（滚动兜底的诚实校验）
  const before = box.scrollTop;
  box.scrollTop = box.scrollHeight;
  const lvReachable = inBox(lvEl);
  box.scrollTop = before;
  return { vh: Math.round(vh), boxH: Math.round(bb.height),
           boxTop: Math.round(bb.top), boxBottom: Math.round(bb.bottom),
           board: Math.round(board.getBoundingClientRect().width),
           rnIn: inBox(rnEl), lvIn: inBox(lvEl), lvReachable,
           overflow: Math.round(box.scrollHeight - box.clientHeight) };
}"""

VIEWPORTS = [
    ('iPhone 14  390x844', (390, 844)),
    ('iPhone SE  375x667', (375, 667)),
    ('安卓小屏   360x640', (360, 640)),
    ('矮屏       360x620', (360, 620)),
    ('超矮       360x560', (360, 560)),
    ('大屏       430x932', (430, 932)),
    ('极端矮     320x480', (320, 480)),
    ('横屏       844x390', (844, 390)),
]

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    fails = []
    for name, (w, h) in VIEWPORTS:
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.goto('http://localhost:8099/', wait_until='load')
        pg.wait_for_timeout(700)
        pg.evaluate(INJECT)
        pg.wait_for_timeout(500)
        r = pg.evaluate(CHECKS)
        if r.get('err'):
            fails.append(name + ':' + r['err'])
            pg.close()
            continue
        boxFits = r['boxTop'] >= -0.5 and r['boxBottom'] <= r['vh'] + 0.5
        ok = boxFits and r['rnIn'] and r['lvReachable'] and (r['overflow'] <= 0 if h >= 620 else True)
        if not ok:
            fails.append('%s(boxFits=%s rnIn=%s lvReach=%s ovf=%d)'
                         % (name, boxFits, r['rnIn'], r['lvReachable'], r['overflow']))
        print('%-18s 视口%4d 盒高%4d 牌桌%3d | 盒不越界=%-5s 房间号=%-5s 退出可达=%-5s 需滚动=%+dpx  %s'
              % (name, r['vh'], r['boxH'], r['board'], boxFits, r['rnIn'], r['lvReachable'],
                 r['overflow'], '✅' if ok else '❌'))
        pg.close()
    b.close()
    if fails:
        print('失败:', '; '.join(fails))
        sys.exit(1)
    print('结果: ✅ 全部通过（盒子不越界、房间号可见、退出房间可达）')
