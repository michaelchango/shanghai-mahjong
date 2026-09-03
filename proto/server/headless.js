/**
 * 无头运行环境：把 index.html 的规则引擎搬进 Node 跑
 *
 * 关键点：引擎源码是浏览器代码，会碰 DOM（render* / toast / openSheet 等）。
 * 这里不是去改源码，而是：
 *   1. 提供一套「什么都能接住」的 DOM 替身
 *   2. 加载后把纯 UI 函数替换成「服务端钩子」或空函数
 * 规则逻辑本身（evalAll / claimOptions / scoreOf / runHand …）一个字都不动。
 *
 * 服务端钩子（GameHost 的挂载点）：
 *   onRender()            —— 引擎每次 render()（= 局面已更新，该向各家推投影了）
 *   onSheet(html)         —— 引擎 openSheet()（= 结算面板出现）
 *   onSettle(html,dealer,rec) —— finishHand()（= 一局结束，rec 为结算记录）
 *   onToast(text,cls)     —— toast 提示（敲/胡等氛围消息，转发给客户端）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { seededMath } = require('./rng');

/* ---------------- DOM 替身 ---------------- */
function makeStyle(){
  return new Proxy({}, {
    get(t, k){
      if (k in t) return t[k];
      if (typeof k === 'string' && /^(set|remove|get|has)/.test(k)) return () => {};
      return '';
    },
    set(t, k, v){ t[k] = v; return true; }
  });
}

function makeEl(tag){
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    className: '', id: '', textContent: '', innerHTML: '', value: '',
    onclick: null, oninput: null, dataset: {},
    style: makeStyle(),
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    children: [], parentNode: null, parentElement: null,
    offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0,
    appendChild(c){ this.children.push(c); c.parentNode = this; c.parentElement = this; return c; },
    insertBefore(c){ return this.appendChild(c); },
    insertAdjacentHTML(){}, removeChild(){}, remove(){},
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    addEventListener(){}, removeEventListener(){},
    querySelector(){ return makeEl('div'); },
    querySelectorAll(){ return []; },
    getBoundingClientRect(){ return { width:0, height:0, top:0, left:0, right:0, bottom:0, x:0, y:0 }; },
    getContext(){ return null; },
    focus(){}, blur(){}, scrollIntoView(){}, click(){},
    get firstChild(){ return this.children[0] || null; },
    get lastChild(){ return this.children[this.children.length - 1] || null; }
  };
  return el;
}

function makeDocument(){
  const cache = new Map();
  return {
    createElement: t => makeEl(t),
    createDocumentFragment: () => makeEl('fragment'),
    createTextNode: t => { const e = makeEl('text'); e.textContent = t; return e; },
    getElementById(id){
      if (!cache.has(id)){ const e = makeEl('div'); e.id = id; cache.set(id, e); }
      return cache.get(id);
    },
    querySelector(){ return makeEl('div'); },
    querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){},
    body: makeEl('body'),
    documentElement: makeEl('html')
  };
}

/* ---------------- 加载引擎 ---------------- */
/**
 * @param {object} opts
 * @param {number}   opts.seed     随机种子（不传则用原生 Math.random）
 * @param {boolean}  opts.instant  压缩所有等待（仿真用；联机服务端必须 false 以保留真实节奏）
 * @param {function} opts.onRender 引擎 render() 钩子
 * @param {function} opts.onSheet  openSheet(html) 钩子
 * @param {function} opts.onSettle finishHand(html,dealer,rec) 钩子
 * @param {function} opts.onToast  toast(text,cls) 钩子
 */
function boot(opts){
  opts = opts || {};
  const enginePath = path.join(__dirname, 'engine.js');
  let src = fs.readFileSync(enginePath, 'utf8');

  // 去掉 extract.js 追加的导出尾巴（这里用 vm 自己接管作用域）
  const tailAt = src.indexOf('/* ---------------- 导出');
  if (tailAt > 0) src = src.slice(0, tailAt);

  const doc = makeDocument();
  const store = new Map();

  // 仿真模式：把 setTimeout 压成微任务，一局瞬间跑完（不改动引擎里的 sleep/waitBot）
  const setTimeoutFn = opts.instant
    ? (fn) => { queueMicrotask(fn); return 0; }
    : setTimeout;

  const sandbox = {
    console,
    setTimeout: setTimeoutFn, clearTimeout, setInterval, clearInterval, setImmediate,
    Promise, JSON, Date, Object, Array, String, Number, Boolean, Error,
    Math: (opts.seed == null) ? Math : seededMath(opts.seed),
    document: doc,
    navigator: { userAgent: 'node' },
    location: { href: '', search: '', hash: '' },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      clear: () => store.clear()
    },
    requestAnimationFrame: cb => setTimeout(() => cb(Date.now()), 0),
    performance: { now: () => Date.now() }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  // 服务端没有联机模块：预置一个「永不激活」的 NET，让引擎里的联机分流恒走单机路径
  sandbox.NET = { active: false };
  vm.createContext(sandbox);

  vm.runInContext(src, sandbox, { filename: 'engine.js' });

  /* ---- UI 函数 → 服务端钩子 ---- */
  // 次级渲染：服务端永远不需要
  vm.runInContext(`
    renderTop   = function(){};
    renderHUD   = function(){};
    renderSeats = function(){};
    renderRiver = function(){};
    renderMe    = function(){};
    renderHand  = function(){};
    renderFx    = function(){};
    renderActs  = function(){};
    fitBacks    = function(){};
    closeSheet  = function(){};
    showResult  = function(){};
    openHistory = function(){};
    openHandLog = function(){};
    openSet     = function(){};
    openRule    = function(){};
    analyzeMe   = function(){};
    showTip     = function(){};
    viewHist    = function(){};
    var LAST_SHEET = '';
  `, sandbox);

  // render()：局面更新信号。有钩子则转发，否则空
  if (opts.onRender){
    sandbox.__onRender = opts.onRender;
    vm.runInContext(`render = function(){ __onRender(); };`, sandbox);
  } else {
    vm.runInContext(`render = function(){};`, sandbox);
  }

  // toast：转发给客户端做氛围提示（第三参 seat 用于把吃/碰/杠/敲定位到对应牌河）
  if (opts.onToast){
    sandbox.__onToast = opts.onToast;
    vm.runInContext(`toast = function(t,c,s){ __onToast(t,c,s); };`, sandbox);
  } else {
    vm.runInContext(`toast = function(){};`, sandbox);
  }

  // openSheet：结算面板出现
  if (opts.onSheet){
    sandbox.__onSheet = opts.onSheet;
    vm.runInContext(`openSheet = function(h){ LAST_SHEET = h; __onSheet(h); };`, sandbox);
  } else {
    vm.runInContext(`openSheet = function(h){ LAST_SHEET = h; };`, sandbox);
  }

  // finishHand：一局结束（包装原函数，原逻辑照跑）
  sandbox.__onSettle = opts.onSettle || null;
  vm.runInContext(`
    const __origFinishHand = finishHand;
    finishHand = function(html, dealer, rec){
      __origFinishHand(html, dealer, rec);
      if (globalThis.__onSettle) globalThis.__onSettle(html, dealer, rec);
    };
  `, sandbox);

  // const/let 声明不会挂到 vm 的全局对象上，这里架一座桥
  vm.runInContext(`
    globalThis.__state = {
      get G(){ return G; },
      get CFG(){ return CFG; },
      get PEND(){ return PEND; }, set PEND(v){ PEND = v; },
      get SEL(){ return SEL; }, set SEL(v){ SEL = v; },
      get SELIDX(){ return SELIDX; }, set SELIDX(v){ SELIDX = v; },
      get LAST_SHEET(){ return LAST_SHEET; }
    };
  `, sandbox);

  return sandbox;
}

module.exports = { boot, makeEl, makeDocument };
