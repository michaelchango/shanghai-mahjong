# m52：v1.2.40 吃/碰禁打同张 —— 牌面压暗 + 点了打不出（UI 层）
import sys
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8099/'

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 420, 'height': 860})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until='domcontentloaded')
    pg.wait_for_timeout(500)
    pg.click('#hBtnSolo')
    pg.evaluate("()=>{const b=[...document.querySelectorAll('#sheet .btns button')].find(x=>x.textContent==='开始游戏'); if(b) b.click();}")
    pg.wait_for_timeout(1500)

    # 造一个「刚碰进 5万」的出牌询问：手牌里放两张 5万 + 别的牌
    setup = pg.evaluate("""()=>{
      const p = G.players[0];
      p.hand = [4, 4, 8, 12, 16];       // 5万 5万 9万 4筒 8筒
      p.melds = [{ type:'pung', tile:4, tiles:[4,4,4], concealed:false, from:1 }];
      p.noDiscard = 4; p.noDiscardKind = 'pung';
      G.running = true;
      PEND = { kind:'discard', payload:{ ban:4, banKind:'碰' }, res:null, seat:0 };
      SEL = null; SELIDX = null;
      render();
      return { hand: p.hand.slice(), ban: 4 };
    }""")
    print('构造:', setup)

    dom = pg.evaluate("""()=>{
      const els = [...document.querySelectorAll('#hand .tile')];
      return els.map(e => ({ txt: (e.textContent||'').trim(), cls: e.className }));
    }""")
    print('手牌 DOM:', dom)

    banned = [d for d in dom if ' ban' in d['cls'] or d['cls'].endswith(' ban')]
    others = [d for d in dom if 'ban' not in d['cls']]

    # 点禁打的那张（第一次选中，第二次本应打出 → 应被拦下）
    before = pg.evaluate("()=>PEND && PEND.kind")
    clicked = pg.evaluate("""()=>{
      const els = [...document.querySelectorAll('#hand .tile')];
      const e = els.find(x => (x.className||'').indexOf('ban') >= 0);
      if (!e) return 'no-ban-el';
      e.click();   // 第一次：应被拦下（不选中、不打出）
      return 'clicked';
    }""")
    pg.wait_for_timeout(250)
    after = pg.evaluate("()=>PEND && PEND.kind")
    sel = pg.evaluate("()=>SEL")
    toast_txt = pg.evaluate("""()=>{ const t=document.getElementById('toast'); return t ? (t.textContent||'').trim() : ''; }""")
    hint = pg.evaluate("""()=>{ const h=document.getElementById('hint'); return h ? h.textContent.trim() : ''; }""")
    print('点击禁打牌:', clicked, '| PEND:', before, '->', after, '| SEL:', sel)
    print('toast:', toast_txt)
    print('hint:', hint)

    # 非禁打的牌仍可正常选中
    sel2 = pg.evaluate("""()=>{
      const els = [...document.querySelectorAll('#hand .tile')];
      const e = els.find(x => (x.className||'').indexOf('ban') < 0);
      if (!e) return 'no-other';
      e.click();
      return SEL;
    }""")
    print('点普通牌后 SEL:', sel2)

    checks = {
        '禁打牌被标记 ban': len(banned) == 2,          # 手里两张 5万
        '其它牌未被标记':   len(others) == 3,
        '点禁打牌不出牌':   after == 'discard',
        '点禁打牌不选中':   sel is None,
        '弹出提示':         ('不能立刻打出' in toast_txt) or ('不能立刻打出' in hint),
        '提示含「碰」':     ('碰' in toast_txt) or ('碰' in hint),
        '普通牌仍可选中':   isinstance(sel2, int),
    }
    print('\n--- 校验 ---')
    allok = True
    for k, v in checks.items():
        print(('  ✅ ' if v else '  ❌ ') + k)
        allok = allok and v

    print('\nJS 错误:', errs if errs else '无')
    ok = allok and not errs
    print('结果:', '✅ 通过' if ok else '❌ 失败')
    b.close()
    sys.exit(0 if ok else 1)
