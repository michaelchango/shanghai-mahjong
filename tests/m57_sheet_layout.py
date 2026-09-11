# m57：弹窗统一「头尾固定、中间滚动」（v1.2.45）
#   遍历所有 openSheet 调用点：头（h2 + 提示）与尾（.btns）必须**无需滚动**就完整可见，
#   只有中间 .sBody 滚动。同时保证短内容弹窗不产生多余滚动、弹窗整体不超出视口。
import sys
from playwright.sync_api import sync_playwright

CHK = """()=>{
  const s=document.getElementById('sheet');
  const r=s.getBoundingClientRect();
  const h2=s.querySelector('h2'), body=s.querySelector('.sBody');
  const btns=[...s.querySelectorAll('.btns')].pop();
  const vis = el => { if(!el) return null; const b=el.getBoundingClientRect();
    return b.top >= r.top-1 && b.bottom <= r.bottom+1; };
  return {
    flex: s.classList.contains('sheetFlex'),
    hasBody: !!body,
    hasBtns: !!btns,
    bodyOver: body ? Math.round(body.scrollHeight - body.clientHeight) : 0,
    bodyScrollTop: body ? Math.round(body.scrollTop) : 0,
    h2Visible: vis(h2),
    btnsVisible: vis(btns),
    sheetFits: r.top >= -0.5 && r.bottom <= innerHeight+0.5,
    sheetH: Math.round(r.height),
    btnsText: btns ? btns.innerText.replace(/\\n/g,'/').slice(0,30) : '(无按钮)',
    bodyText: body ? body.innerText.replace(/\\s+/g,' ').slice(0,40) : '',
  };
}"""


def check(pg, name, opener, expect_btns=True, allow_no_body=False):
    pg.evaluate(opener)
    pg.wait_for_timeout(420)
    r = pg.evaluate(CHK)
    ok = bool(r['h2Visible']) and bool(r['sheetFits']) and r['bodyScrollTop'] == 0 \
        and (bool(r['btnsVisible']) if expect_btns else True) \
        and (bool(r['hasBody']) or allow_no_body)
    print('%-16s flex=%-5s 中滚=%-4s 头可见=%-5s 尾可见=%-5s 整体合适=%-5s | 中间=%s  %s'
          % (name, r['flex'], r['bodyOver'], r['h2Visible'],
             r['btnsVisible'] if r['hasBtns'] else 'n/a', r['sheetFits'], r['bodyText'], '✅' if ok else '❌'))
    pg.evaluate("()=>closeSheet()")
    pg.wait_for_timeout(180)
    return ok


with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 400, 'height': 620})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8099/', wait_until='load')
    pg.wait_for_timeout(500)

    ok = True
    # 首页态就能开的：单机设置、规则
    ok &= check(pg, '单机设置', "()=>openSet()")
    ok &= check(pg, '规则', "()=>openRule()")

    # 开局
    pg.click('#hBtnSolo')
    pg.evaluate("()=>{const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click();}")
    pg.wait_for_timeout(1500)

    ok &= check(pg, '顶部四栏明细', "()=>openHudWhy()")
    ok &= check(pg, '出牌建议', "()=>showTip()")
    ok &= check(pg, '历史记录(空)', "()=>openHistory()")
    # 历史记录「有内容」态 —— 这是最容易漏的：按钮后面还跟着一句脚注 .dimc，
    # 若尾部分割规则写错，按钮会被卷进滚动区
    ok &= check(pg, '历史(有内容)', """()=>{
      G.history = Array.from({length:12},(_,i)=>({
        no:i+1, kind:(i%3===0?'流局':'胡牌'), winners:(i%3===0?[]:[0]),
        note:'你 胡牌 · 自摸 · 混一色 · 底10 番3',
        delta:[6,-2,-2,-2]
      }));
      openHistory();
    }""")
    ok &= check(pg, '局内设置', "()=>openSet()")

    # 本局记录（logMsg 里点开的那份）
    ok &= check(pg, '本局记录', """()=>{
      openSheet('<h2><span>本局记录</span><span class="sp"></span><button class="close" onclick="closeSheet()">×</button></h2>' +
        '<p class="dimc">本局全部动作</p>' + '<div class="hlist">' +
        Array.from({length:30},(_,i)=>'<div class="hrow">第 '+i+' 手</div>').join('') +
        '</div><div class="btns"><button class="pri" onclick="closeSheet()">知道了</button></div>');
    }""")

    # 出牌前的「选择听法」（多听法时的弹窗）—— 这个弹窗本来就没有结尾按钮组，
    # 选项本身就是按钮，所以 expect_btns=False
    ok &= check(pg, '选择听法', """()=>{
      openSheet('<h2><span>选择听法</span><span class="sp"></span><button class="close" onclick="closeSheet()">×</button></h2>' +
        '<div class="knockList">' + Array.from({length:12},(_,i)=>
          '<button class="knockOpt">打 '+(i+1)+' → 听 五萬(3)/六萬(2)</button>').join('') + '</div>');
    }""", expect_btns=False)

    # 重新开局确认
    ok &= check(pg, '重新开局确认', """()=>{
      openSheet('<h2><span>重新开局？</span><span class="sp"></span><button class="close" onclick="closeSheet()">×</button></h2>' +
        '<p class="dimc">当前本局记录会被清空。</p>' +
        '<div class="btns"><button onclick="closeSheet()">取消</button><button class="pri" onclick="closeSheet()">确定</button></div>');
    }""")

    # 结算面板
    ok &= check(pg, '结算面板', """()=>{
      openSheet(settleHtml('<h2><span>结算</span><span class="sp"></span><button class="close" onclick="closeSheet()">×</button></h2>' +
        '<div class="result"><div class="winner">你 胡牌</div><div class="sub">自摸 · 清一色</div></div>' +
        '<div class="tlist">' + Array.from({length:14},(_,i)=>'<div class="tile"></div>').join('') + '</div>' +
        '<div class="fanbreak">' + Array.from({length:8},(_,i)=>'<div class="li"><span class="n">项'+i+'</span><span class="v">+1</span></div>').join('') + '</div>', 0));
    }""")

    print('JS 错误:', errs if errs else '无')
    allok = bool(ok) and not errs
    print('结果:', '✅ 全部弹窗头尾固定、中间滚动' if allok else '❌ 有失败')
    b.close()
    sys.exit(0 if allok else 1)
