// 真实浏览器端到端测试（需要 Chrome for Testing 或 Chromium，品牌版 Chrome 不允许命令行加载扩展）：
//   node tools/e2e-test.js <chrome.exe> <空的临时目录> [扩展目录]
// 通过 --remote-debugging-pipe 驱动浏览器，加载扩展，在本地测试网站上检查 CSS/JS 是否按规则生效。
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const [CHROME, WORK_DIR, EXT_ARG] = process.argv.slice(2);
if (!CHROME || !WORK_DIR) {
  console.error('用法：node tools/e2e-test.js <chrome.exe> <空的临时目录> [扩展目录]');
  process.exit(2);
}
const EXT = EXT_ARG || path.join(__dirname, '..', 'site-tweaker');
const PROFILE = path.join(WORK_DIR, 'profile');
const SHOTS = path.join(WORK_DIR, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// ---------- 结果统计 ----------

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '  ✔' : '  ✖'} ${name}${ok || detail === undefined ? '' : '  → ' + JSON.stringify(detail)}`);
}
function section(title) {
  console.log('\n' + title);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 8000, interval = 150) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await sleep(interval);
  }
  return last;
}

// ---------- 测试网站 ----------

const PAGE_CSS = 'body { background: rgb(255, 255, 255); } h1 { color: rgb(0, 0, 0); }';
const PAGE_JS = "window.pageVar = 'page';";

function page(title) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="/page.css"><script src="/page.js"></script></head>
<body><h1>${title}</h1><p>site tweaker e2e</p>
<div class="feed" id="feed">
  <div class="item"><a class="title" href="#a">Item A</a> <span class="meta">first</span></div>
  <div class="item ad"><a class="title" href="#b">Item B (ad)</a> <span class="meta">second</span></div>
  <div class="item"><a class="title" href="#c">Item C</a> <span class="meta">third</span></div>
</div></body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/page.css') return res.writeHead(200, { 'content-type': 'text/css' }).end(PAGE_CSS);
  if (url.pathname === '/page.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(PAGE_JS);
  const headers = { 'content-type': 'text/html; charset=utf-8' };
  if (url.pathname.startsWith('/csp')) {
    // 严格策略：禁止内联脚本和内联样式，并强制 Trusted Types
    headers['content-security-policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; require-trusted-types-for 'script'";
  }
  res.writeHead(200, headers).end(page(url.pathname.slice(1) || 'home'));
});

// ---------- CDP（管道传输） ----------

class CDP {
  constructor(writable, readable) {
    this.writable = writable;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    let buffer = Buffer.alloc(0);
    readable.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let end;
      while ((end = buffer.indexOf(0)) !== -1) {
        const msg = JSON.parse(buffer.subarray(0, end).toString('utf8'));
        buffer = buffer.subarray(end + 1);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject, method } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
          else resolve(msg.result);
        } else {
          for (const fn of this.listeners) fn(msg);
        }
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.writable.write(JSON.stringify(msg) + '\0');
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  waitEvent(method, sessionId, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('等待事件超时：' + method));
      }, timeout);
      const off = this.on((msg) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
          clearTimeout(timer);
          off();
          resolve(msg.params);
        }
      });
    });
  }
}

let cdp;

async function attach(targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  return sessionId;
}

async function evaluate(sessionId, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
  if (r.exceptionDetails) {
    throw new Error('执行出错：' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  }
  return r.result.value;
}

/** 打开一个标签页，收集它的控制台输出和未捕获异常 */
async function openPage(url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const sessionId = await attach(targetId);
  const tab = { targetId, sessionId, logs: [], contexts: [] };
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.executionContextCreated') {
      tab.contexts.push(msg.params.context);
    } else if (msg.method === 'Runtime.executionContextDestroyed') {
      tab.contexts = tab.contexts.filter((c) => c.id !== msg.params.executionContextId);
    } else if (msg.method === 'Runtime.executionContextsCleared') {
      tab.contexts = [];
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      tab.logs.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      tab.logs.push('exception: ' + ((d.exception && d.exception.description) || d.text));
    }
  });
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  if (url) await navigate(tab, url);
  return tab;
}

async function navigate(tab, url) {
  const loaded = cdp.waitEvent('Page.loadEventFired', tab.sessionId);
  await cdp.send('Page.navigate', { url }, tab.sessionId);
  await loaded;
}

async function reload(tab) {
  const loaded = cdp.waitEvent('Page.loadEventFired', tab.sessionId);
  await cdp.send('Page.reload', {}, tab.sessionId);
  await loaded;
}

/** 在扩展内容脚本所在的隔离环境里执行（页面内工具的状态只在那里可见） */
async function evaluateInExtension(tab, expression) {
  const { frameTree } = await cdp.send('Page.getFrameTree', {}, tab.sessionId);
  // 「隔离环境」用户脚本也各有一个同名的上下文，按内容脚本留下的全局变量找
  let ctx = null;
  for (const c of [...tab.contexts].reverse()) {
    if (!c.auxData || c.auxData.frameId !== frameTree.frame.id || c.auxData.type !== 'isolated') continue;
    const r = await cdp.send('Runtime.evaluate', { expression: `typeof __siteTweaker === 'object'`, contextId: c.id, returnByValue: true }, tab.sessionId).catch(() => null);
    if (r && r.result && r.result.value === true) {
      ctx = c;
      break;
    }
  }
  if (!ctx) throw new Error('找不到扩展的隔离环境：' + JSON.stringify(tab.contexts.map((c) => [c.name, c.auxData])));
  const r = await cdp.send('Runtime.evaluate', { expression, contextId: ctx.id, awaitPromise: true, returnByValue: true }, tab.sessionId);
  if (r.exceptionDetails) throw new Error('执行出错：' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}

async function mouse(tab, type, { x, y }, extra = {}) {
  await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', clickCount: 0, ...extra }, tab.sessionId);
}

async function click(tab, point) {
  await mouse(tab, 'mouseMoved', point);
  await mouse(tab, 'mousePressed', point, { button: 'left', clickCount: 1 });
  await mouse(tab, 'mouseReleased', point, { button: 'left', clickCount: 1 });
}

const KEY_CODES = { Tab: ['Tab', 9], Enter: ['Enter', 13], Escape: ['Escape', 27], z: ['KeyZ', 90] };
const SHIFT = 8;
const CTRL = 2;

async function press(tab, key, modifiers = 0) {
  const [code, keyCode] = KEY_CODES[key];
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }, tab.sessionId);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, tab.sessionId);
}

async function screenshot(tab, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, tab.sessionId);
  const file = path.join(SHOTS, name + '.png');
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

/** 页面里我们关心的状态 */
const PAGE_STATE = `(() => {
  const h1 = document.querySelector('h1');
  const d = document.documentElement.dataset;
  return {
    bg: getComputedStyle(document.body).backgroundColor,
    h1Color: getComputedStyle(h1).color,
    h1Deco: getComputedStyle(h1).textDecorationLine,
    styles: document.querySelectorAll('style[data-site-tweaker]').length,
    mainRan: d.mainRan, mainSees: d.mainSees, isoRan: d.isoRan, isoSees: d.isoSees,
    start: d.startState, awaited: d.awaited,
  };
})()`;

// ---------- 主流程 ----------

async function findServiceWorker(extId, previous) {
  const url = `chrome-extension://${extId}/background.js`;
  const target = await waitFor(async () => {
    const { targetInfos } = await cdp.send('Target.getTargets');
    return targetInfos.find((t) => t.type === 'service_worker' && t.url === url && (!previous || t.targetId !== previous.targetId));
  }, 15000);
  if (!target || !target.targetId) throw new Error('找不到扩展的后台 Service Worker');
  const sessionId = await attach(target.targetId);
  const sw = { targetId: target.targetId, sessionId, logs: [] };
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type !== 'log') {
      sw.logs.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      sw.logs.push('exception: ' + ((d.exception && d.exception.description) || d.text));
    }
  });
  await cdp.send('Runtime.enable', {}, sessionId);
  return sw;
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const site = `127.0.0.1:${port}`;
  console.log('测试网站：' + origin);

  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      // 测试用浏览器放在临时目录里时，Windows 沙箱读不到可执行文件；只访问本地测试网站，关掉沙箱
      ...(process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []),
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--window-size=1280,800',
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      '--user-data-dir=' + PROFILE,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
  );
  const stderr = fs.createWriteStream(path.join(WORK_DIR, 'chrome-stderr.log'));
  proc.stderr.pipe(stderr);
  proc.on('exit', (code) => console.log('浏览器退出，代码 ' + code));
  cdp = new CDP(proc.stdio[3], proc.stdio[4]);

  try {
    const { product } = await cdp.send('Browser.getVersion');
    console.log('浏览器：' + product);

    // ===== 安装 =====
    section('安装扩展');
    const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: EXT });
    check('扩展加载成功', !!extId, extId);
    let sw = await findServiceWorker(extId);
    const seeded = await waitFor(() => evaluate(sw.sessionId, `chrome.storage.local.get('rules').then(d => d.rules && d.rules.map(r => r.name))`));
    check('安装时写入示例规则', Array.isArray(seeded) && seeded.some((n) => n.includes('example.com')), seeded);
    const optionsOpened = await waitFor(async () => {
      const { targetInfos } = await cdp.send('Target.getTargets');
      return targetInfos.some((t) => t.url.startsWith(`chrome-extension://${extId}/options/options.html`));
    }, 5000);
    check('安装后自动打开规则管理页', optionsOpened);

    const rules = [
      { id: 'cssMain', name: 'CSS 背景', sites: [`${site}/plain`, `${site}/csp`], css: 'body { background: rgb(1, 2, 3); }' },
      { id: 'cssExclude', name: 'CSS 排除', sites: [site, `!${site}/csp`], css: 'h1 { text-decoration: underline; }' },
      { id: 'cssOff', name: '已停用', enabled: false, sites: [site], css: 'h1 { color: rgb(200, 0, 0) !important; }' },
      { id: 'cssOther', name: '其他网站', sites: ['example.org'], css: 'h1 { color: rgb(0, 200, 0) !important; }' },
      {
        id: 'jsMain', name: 'JS 页面环境', sites: [site], world: 'MAIN',
        js: 'const d = document.documentElement.dataset;\nd.mainRan = String(Number(d.mainRan || 0) + 1);\nd.mainSees = typeof window.pageVar;',
      },
      {
        id: 'jsIso', name: 'JS 隔离环境', sites: [site], world: 'USER_SCRIPT',
        js: 'document.documentElement.dataset.isoRan = "1";\ndocument.documentElement.dataset.isoSees = typeof window.pageVar;',
      },
      {
        id: 'jsStart', name: 'JS 开始时', sites: [site], runAt: 'document_start',
        js: 'document.documentElement.dataset.startState = document.readyState + ":" + !!document.body;',
      },
      { id: 'jsAwait', name: 'JS await', sites: [site], js: 'await new Promise(r => setTimeout(r, 20));\ndocument.documentElement.dataset.awaited = "1";' },
      { id: 'jsError', name: '会出错的规则', sites: [site], js: 'throw new Error("boom-e2e");' },
    ];
    await evaluate(sw.sessionId, `chrome.storage.local.set({ settings: { enabled: true }, rules: ${JSON.stringify(rules)}.map(self.SiteTweaker.normalizeRule) })`);
    const available = () => evaluate(sw.sessionId, `(() => { try { chrome.userScripts.getScripts(); return true; } catch { return false; } })()`);
    check('初始状态：用户脚本权限未开启', (await available()) === false);

    // ===== 兼容模式 =====
    section('兼容模式（未开启用户脚本）');
    const plain = await openPage(`${origin}/plain`);
    let s = await waitFor(async () => {
      const st = await evaluate(plain.sessionId, PAGE_STATE);
      return st.mainRan && st.awaited && st.isoRan ? st : null;
    });
    s = await evaluate(plain.sessionId, PAGE_STATE);
    check('CSS 生效，并压过网页同优先级样式', s.bg === 'rgb(1, 2, 3)', s.bg);
    check('多条规则的 CSS 同时生效', s.h1Deco === 'underline' && s.styles === 2, s);
    check('停用的规则和其他网站的规则不生效', s.h1Color === 'rgb(0, 0, 0)', s.h1Color);
    check('JS 运行且只运行一次', s.mainRan === '1', s.mainRan);
    check('JS 能访问网页变量', s.mainSees === 'string', s.mainSees);
    check('脚本可以使用 await', s.awaited === '1', s.awaited);
    check('document_start 规则运行', !!s.start, s.start);
    await sleep(300);
    check('脚本出错时控制台标明规则名', plain.logs.some((l) => l.includes('会出错的规则') && l.includes('boom-e2e')), plain.logs);
    const tabIdOf = (url) => evaluate(sw.sessionId, `chrome.tabs.query({}).then(ts => ts.find(t => t.url === ${JSON.stringify(url)}).id)`);
    const plainTabId = await tabIdOf(`${origin}/plain`);
    const badge = await evaluate(sw.sessionId, `chrome.action.getBadgeText({ tabId: ${plainTabId} })`);
    check('图标角标显示生效规则数', badge === '7', badge);

    const csp = await openPage(`${origin}/csp`);
    s = await waitFor(async () => {
      const st = await evaluate(csp.sessionId, PAGE_STATE);
      return st.bg === 'rgb(1, 2, 3)' ? st : null;
    });
    await sleep(800);
    s = await evaluate(csp.sessionId, PAGE_STATE);
    check('严格 CSP 网站上 CSS 照样生效', s.bg === 'rgb(1, 2, 3)', s.bg);
    check('排除规则生效（/csp 被排除）', s.h1Deco === 'none', s.h1Deco);
    check('兼容模式下 JS 被 CSP 拦截（预期行为）', !s.mainRan, s.mainRan);
    const cspTabId = await tabIdOf(`${origin}/csp`);
    const flagged = await evaluate(sw.sessionId, `chrome.storage.session.get('csp:${cspTabId}').then(d => d['csp:${cspTabId}'])`);
    check('记录了被拦截的页面，供弹窗提示', flagged === `${origin}/csp`, flagged);
    check('页面控制台给出开启用户脚本的提示', csp.logs.some((l) => l.includes('允许用户脚本')), csp.logs);

    // ===== 实时更新 =====
    section('实时更新');
    await evaluate(sw.sessionId, `chrome.storage.local.get('rules').then(d => { d.rules.find(r => r.id === 'cssMain').css = 'body { background: rgb(4, 5, 6); }'; return chrome.storage.local.set({ rules: d.rules }); })`);
    s = await waitFor(async () => {
      const st = await evaluate(plain.sessionId, PAGE_STATE);
      return st.bg === 'rgb(4, 5, 6)' ? st : null;
    }, 4000);
    check('修改 CSS 后已打开页面立即更新', s && s.bg === 'rgb(4, 5, 6)', s);
    await evaluate(sw.sessionId, `chrome.storage.local.set({ settings: { enabled: false } })`);
    s = await waitFor(async () => {
      const st = await evaluate(plain.sessionId, PAGE_STATE);
      return st.styles === 0 ? st : null;
    }, 4000);
    check('关闭总开关后样式移除', s && s.bg === 'rgb(255, 255, 255)', s);
    const badgeOff = await evaluate(sw.sessionId, `chrome.action.getBadgeText({ tabId: ${plainTabId} })`);
    check('关闭总开关后角标清空', badgeOff === '', badgeOff);
    await evaluate(sw.sessionId, `chrome.storage.local.set({ settings: { enabled: true } })`);
    s = await waitFor(async () => {
      const st = await evaluate(plain.sessionId, PAGE_STATE);
      return st.styles === 2 ? st : null;
    }, 4000);
    check('打开总开关后样式恢复', s && s.bg === 'rgb(4, 5, 6)', s);

    await evaluate(plain.sessionId, `history.pushState({}, '', '/other')`);
    s = await waitFor(async () => {
      const st = await evaluate(plain.sessionId, PAGE_STATE);
      return st.styles === 1 ? st : null;
    }, 4000);
    check('单页应用切换到不匹配的网址后，对应 CSS 移除', s && s.bg === 'rgb(255, 255, 255)' && s.h1Deco === 'underline', s);
    await evaluate(plain.sessionId, `history.back()`);
    s = await waitFor(async () => {
      const st = await evaluate(plain.sessionId, PAGE_STATE);
      return st.styles === 2 ? st : null;
    }, 4000);
    check('返回原网址后 CSS 恢复', s && s.bg === 'rgb(4, 5, 6)', s);

    // ===== 管理页（真实扩展环境） =====
    section('规则管理页');
    const opt = await openPage(`chrome-extension://${extId}/options/options.html`);
    await sleep(800);
    const optState = await evaluate(opt.sessionId, `({
      items: document.querySelectorAll('.rule-item').length,
      banner: !document.getElementById('banner').hidden,
      bannerText: document.getElementById('banner').textContent.replace(/\\s+/g, ' ').trim(),
    })`);
    check('管理页列出全部规则', optState.items === rules.length, optState.items);
    check('未开启用户脚本时显示提示条', optState.banner, optState.bannerText);
    await screenshot(opt, 'options-compat');
    // 通过界面修改并保存一条规则
    await evaluate(opt.sessionId, `(async () => {
      [...document.querySelectorAll('.rule-item')].find(li => li.textContent.includes('CSS 背景')).click();
      await new Promise(r => setTimeout(r, 100));
      const css = document.getElementById('ruleCss');
      css.value = 'body { background: rgb(7, 8, 9); }';
      css.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('saveBtn').click();
    })()`);
    s = await waitFor(async () => {
      const st = await evaluate(plain.sessionId, PAGE_STATE);
      return st.bg === 'rgb(7, 8, 9)' ? st : null;
    }, 4000);
    check('在管理页保存后，已打开的页面同步更新', s && s.bg === 'rgb(7, 8, 9)', s);
    check('管理页没有报错', !opt.logs.some((l) => /^(error|exception)/.test(l)), opt.logs);

    // ===== 账号同步 =====
    // 测试浏览器没有登录账号，chrome.storage.sync 照样可读写；“另一台设备”用直接改同步区来模拟
    section('账号同步');
    const syncGet = () => evaluate(sw.sessionId, `chrome.storage.sync.get(null)`);
    const localRules = () => evaluate(sw.sessionId, `chrome.storage.local.get('rules').then(d => d.rules.map(r => r.id))`);
    let remote = await waitFor(async () => {
      const d = await syncGet();
      return d.settings && d['rule:cssMain'] && d['rule:cssMain'].css.includes('7, 8, 9') ? d : null;
    });
    const remoteIds = Object.keys(remote || {}).filter((k) => k.startsWith('rule:'));
    check('规则和设置写入同步区，每条规则单独一项', remoteIds.length === rules.length && remote.settings.enabled === true, remote && Object.keys(remote));
    check('没改过的示例规则不上传', !remote['rule:example'], Object.keys(remote));

    await evaluate(sw.sessionId, `chrome.storage.sync.set({ 'rule:fromOther': self.SiteTweaker.normalizeRule({ id: 'fromOther', name: '另一台设备的规则', sites: ['example.net'], css: 'h1 {}' }) })`);
    let pulled = await waitFor(async () => (await localRules()).includes('fromOther'));
    check('别的设备新增的规则拉取到本地', pulled === true);
    const optListed = await waitFor(() => evaluate(opt.sessionId, `[...document.querySelectorAll('.rule-item')].some(li => li.textContent.includes('另一台设备的规则'))`), 3000);
    check('管理页即时列出拉取到的规则', optListed === true);
    await evaluate(sw.sessionId, `chrome.storage.sync.remove('rule:fromOther')`);
    const dropped = await waitFor(async () => !(await localRules()).includes('fromOther'));
    check('别的设备删除规则后，本机也删除', dropped === true);

    await evaluate(sw.sessionId, `chrome.storage.sync.set({ settings: { enabled: false } })`);
    const paused = await waitFor(() => evaluate(sw.sessionId, `chrome.storage.local.get('settings').then(d => d.settings.enabled === false)`));
    check('别的设备关闭总开关，本机跟着关闭', paused === true);
    await evaluate(sw.sessionId, `chrome.storage.sync.set({ settings: { enabled: true } })`);
    await waitFor(() => evaluate(sw.sessionId, `chrome.storage.local.get('settings').then(d => d.settings.enabled === true)`));

    await evaluate(sw.sessionId, `chrome.storage.local.get('rules').then(d => chrome.storage.local.set({ rules: [...d.rules, self.SiteTweaker.normalizeRule({ id: 'bigRule', name: '超大规则', sites: ['example.net'], css: '/* ' + 'x'.repeat(9000) + ' */' })] }))`);
    const bigState = await waitFor(() => evaluate(sw.sessionId, `chrome.storage.local.get('syncState').then(d => d.syncState && d.syncState.unsynced.bigRule)`));
    check('超过 8 KB 的规则记为只在本机', bigState === 'tooLarge', bigState);
    remote = await syncGet();
    check('超大规则没有写入同步区，其他规则照常同步', !remote['rule:bigRule'] && !!remote['rule:cssMain'], Object.keys(remote));
    const bigUi = await waitFor(() =>
      evaluate(opt.sessionId, `(async () => {
        const li = [...document.querySelectorAll('.rule-item')].find(li => li.textContent.includes('超大规则'));
        if (!li || !li.textContent.includes('仅本机')) return null;
        li.click();
        await new Promise(r => setTimeout(r, 100));
        const hint = document.getElementById('syncHint');
        return hint.hidden ? null : hint.title;
      })()`),
    3000);
    check('管理页标注「仅本机」并说明原因', typeof bigUi === 'string' && bigUi.includes('8 KB'), bigUi);
    await screenshot(opt, 'options-sync-too-large');

    await evaluate(sw.sessionId, `chrome.storage.local.set({ agent: { baseUrl: 'http://localhost:1/v1', apiKey: 'sk-e2e-secret', model: 'm' } })`);
    await sleep(2800);
    check('AI 接口设置和 API Key 不进同步区', !JSON.stringify(await syncGet()).includes('sk-e2e-secret'));
    await evaluate(sw.sessionId, `chrome.storage.local.remove('agent')`);
    await evaluate(sw.sessionId, `chrome.storage.local.get('rules').then(d => chrome.storage.local.set({ rules: d.rules.filter(r => r.id !== 'bigRule') }))`);
    const cleared = await waitFor(() => evaluate(sw.sessionId, `chrome.storage.local.get('syncState').then(d => !d.syncState.unsynced.bigRule)`));
    check('删掉超大规则后，同步状态恢复', cleared === true);

    // ===== 开启用户脚本 =====
    section('用户脚本模式（开启「允许用户脚本」后）');
    const ext = await openPage(`chrome://extensions/?id=${extId}`);
    await sleep(500);
    let toggled = await evaluate(
      ext.sessionId,
      `new Promise(resolve => {
        try {
          chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ${JSON.stringify(extId)}, userScriptsAccess: true }, () => resolve(chrome.runtime.lastError ? 'err: ' + chrome.runtime.lastError.message : 'ok'));
        } catch (e) { resolve('err: ' + e.message); }
      })`,
    );
    check('通过扩展管理页打开用户脚本权限', toggled === 'ok', toggled);
    await screenshot(ext, 'extensions-page');
    check('后台检测到用户脚本可用', await waitFor(available, 5000), false);

    // 管理页重新获取状态（会触发同步注册）
    await evaluate(opt.sessionId, `window.dispatchEvent(new Event('focus'))`);
    const registered = await waitFor(async () => {
      const ids = await evaluate(sw.sessionId, `chrome.userScripts.getScripts().then(list => list.map(s => s.id).sort())`);
      return ids.length === 5 ? ids : null;
    }, 6000);
    check('带 JS 的已启用规则都注册为用户脚本', Array.isArray(registered) && registered.length === 5, registered);
    if (!Array.isArray(registered)) {
      console.log('    诊断：', JSON.stringify(await evaluate(sw.sessionId, `chrome.storage.session.get(null)`)));
      console.log('    手动注册：', await evaluate(sw.sessionId, `chrome.userScripts.register([{ id: 'diag', matches: ['*://127.0.0.1/*'], js: [{ code: '1' }] }]).then(() => chrome.userScripts.getScripts()).then(l => 'ok ' + JSON.stringify(l.map(s => s.id)), e => 'err ' + e.message)`));
    }
    const bannerHidden = await waitFor(() => evaluate(opt.sessionId, `document.getElementById('banner').hidden`), 3000);
    check('开启后管理页提示条消失', bannerHidden);

    await reload(plain);
    s = await waitFor(async () => {
      const st = await evaluate(plain.sessionId, PAGE_STATE);
      return st.mainRan && st.awaited && st.isoRan ? st : null;
    });
    await sleep(500);
    s = await evaluate(plain.sessionId, PAGE_STATE);
    check('页面环境 JS 运行一次（不会和兼容模式重复）', s.mainRan === '1', s.mainRan);
    check('页面环境能访问网页变量', s.mainSees === 'string', s.mainSees);
    check('隔离环境看不到网页变量', s.isoRan === '1' && s.isoSees === 'undefined', s);
    check('document_start 规则在 body 出现前运行', s.start === 'loading:false', s.start);
    check('await 正常', s.awaited === '1', s.awaited);

    csp.logs.length = 0;
    await reload(csp);
    s = await waitFor(async () => {
      const st = await evaluate(csp.sessionId, PAGE_STATE);
      return st.mainRan && st.isoRan ? st : null;
    });
    s = await evaluate(csp.sessionId, PAGE_STATE);
    check('严格 CSP + Trusted Types 网站上 JS 也能运行', s && s.mainRan === '1' && s.isoRan === '1', s);
    check('严格 CSP 网站上 CSS 仍然生效', s && s.bg === 'rgb(7, 8, 9)', s && s.bg);

    // 修改 JS 后重新注册
    await evaluate(sw.sessionId, `chrome.storage.local.get('rules').then(d => { d.rules.find(r => r.id === 'jsAwait').js = 'document.documentElement.dataset.awaited = "2";'; return chrome.storage.local.set({ rules: d.rules }); })`);
    await sleep(800);
    await reload(plain);
    const awaited2 = await waitFor(() => evaluate(plain.sessionId, `document.documentElement.dataset.awaited === '2'`), 4000);
    check('修改 JS 后刷新页面运行新代码', awaited2);

    // 停用规则后注销
    await evaluate(sw.sessionId, `chrome.storage.local.get('rules').then(d => { d.rules.find(r => r.id === 'jsError').enabled = false; return chrome.storage.local.set({ rules: d.rules }); })`);
    const afterDisable = await waitFor(async () => {
      const ids = await evaluate(sw.sessionId, `chrome.userScripts.getScripts().then(list => list.map(s => s.id))`);
      return ids.includes('jsError') ? null : ids;
    }, 4000);
    check('停用的规则从用户脚本中注销', Array.isArray(afterDisable) && afterDisable.length === 4, afterDisable);

    // ===== 弹窗 =====
    section('弹窗');
    const popup = await openPage(`chrome-extension://${extId}/popup/popup.html`);
    await sleep(500);
    const popupState = await evaluate(popup.sessionId, `({ host: document.getElementById('siteHost').textContent, notice: document.getElementById('noticeText').textContent })`);
    check('弹窗正常打开', !!popupState.host, popupState);
    check('弹窗没有报错', !popup.logs.some((l) => /^(error|exception)/.test(l)), popup.logs);
    const toolButtons = await evaluate(popup.sessionId, `['pickerBtn', 'viewerBtn'].map(id => document.getElementById(id)).map(b => b && { disabled: b.disabled, title: b.title })`);
    check('弹窗有「快捷消除」和「代码小窗」按钮', toolButtons.every(Boolean), toolButtons);
    check('不能注入的页面上工具按钮不可用', toolButtons.every((b) => b && b.disabled), toolButtons);
    // 无界面模式不绑定快捷键，这时按钮提示会说明去哪里设置
    check('按钮提示显示快捷键或设置方法', toolButtons.every((b) => b && /快捷键/.test(b.title)), toolButtons);
    await screenshot(popup, 'popup');

    // ===== 扩展重载 =====
    section('扩展重载（模拟更新）');
    // 和用户在扩展管理页点「重新加载」一样；未开发者模式时 Chrome 会停用重载的已解压扩展，所以先打开
    await evaluate(ext.sessionId, `new Promise(r => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, r))`);
    const reloaded = await evaluate(
      ext.sessionId,
      `new Promise(resolve => chrome.developerPrivate.reload(${JSON.stringify(extId)}, { failQuietly: true }, () => resolve(chrome.runtime.lastError ? 'err: ' + chrome.runtime.lastError.message : 'ok')))`,
    );
    check('扩展重新加载', reloaded === 'ok', reloaded);
    await sleep(1500);
    const info = await evaluate(
      ext.sessionId,
      `new Promise(r => chrome.developerPrivate.getExtensionInfo(${JSON.stringify(extId)}, i => r({ state: i.state, location: i.location, disableReasons: i.disableReasons, manifestErrors: i.manifestErrors, runtimeErrors: i.runtimeErrors, userScripts: i.userScriptsAccess })))`,
    );
    check('重载后扩展仍处于启用状态', info.state === 'ENABLED', info);
    sw = await findServiceWorker(extId, sw);
    s = await waitFor(async () => {
      const st = await evaluate(plain.sessionId, PAGE_STATE);
      return st.styles === 2 ? st : null;
    }, 6000);
    await sleep(800);
    s = await evaluate(plain.sessionId, PAGE_STATE);
    check('重载后已打开页面的样式不重复', s.styles === 2, s.styles);
    check('重载后样式仍然生效', s.bg === 'rgb(7, 8, 9)', s.bg);
    check('重载后不会重复运行页面上的 JS', s.mainRan === '1', s.mainRan);
    await evaluate(sw.sessionId, `chrome.storage.local.get('rules').then(d => { d.rules.find(r => r.id === 'cssMain').css = 'body { background: rgb(10, 11, 12); }'; return chrome.storage.local.set({ rules: d.rules }); })`);
    s = await waitFor(async () => {
      const st = await evaluate(plain.sessionId, PAGE_STATE);
      return st.bg === 'rgb(10, 11, 12)' ? st : null;
    }, 4000);
    check('重载后实时更新仍然有效', s && s.bg === 'rgb(10, 11, 12)' && s.styles === 2, s);

    // ===== 快捷消除 =====
    section('快捷消除');
    const commands = await evaluate(sw.sessionId, `chrome.commands.getAll().then(list => list.map(c => c.name))`);
    check('注册了两个快捷键命令', commands.includes('start-picker') && commands.includes('toggle-viewer'), commands);
    await cdp.send('Page.bringToFront', {}, plain.sessionId); // 后台标签页不跑 requestAnimationFrame
    const plainTab = await tabIdOf(`${origin}/plain`);
    await evaluate(sw.sessionId, `self.SiteTweakerTools.openTool(${plainTab}, 'picker')`);
    check('工具条出现在页面上', await evaluate(plain.sessionId, `!!document.querySelector('site-tweaker-picker')`));
    const pickerState = () => evaluateInExtension(plain, `self.SiteTweakerPicker.debug()`);
    const centerOf = (selector) =>
      evaluate(plain.sessionId, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const adTitle = await centerOf('.feed .ad .title');
    await mouse(plain, 'mouseMoved', adTitle);
    let p = await waitFor(async () => {
      const d = await pickerState();
      return d && d.current && d.boxVisible ? d : null;
    }, 3000);
    check('指向元素时高亮最内层元素', p && p.current === 'a.title', p);
    await press(plain, 'Tab');
    p = await pickerState();
    check('Tab 切换到外层', p.current === 'div.item.ad' && p.depth === 1, p);
    await press(plain, 'Tab');
    p = await pickerState();
    check('再按 Tab 继续往外', p.current === 'div#feed.feed' && p.depth === 2, p);
    await press(plain, 'Tab', SHIFT);
    p = await pickerState();
    check('Shift+Tab 回到内层', p.current === 'div.item.ad' && p.depth === 1, p);
    await mouse(plain, 'mouseMoved', { x: adTitle.x + 2, y: adTitle.y });
    p = await pickerState();
    check('在同一元素上轻微移动鼠标不会丢掉外层选择', p.current === 'div.item.ad', p);
    await sleep(200);
    await screenshot(plain, 'picker');

    const zapCss = () => evaluate(sw.sessionId, `chrome.storage.local.get('rules').then(d => { const r = d.rules.find(r => r.id.startsWith('zap-')); return r ? { css: r.css, sites: r.sites, name: r.name, enabled: r.enabled } : null; })`);
    const adHidden = () => evaluate(plain.sessionId, `getComputedStyle(document.querySelector('.feed .ad')).display === 'none'`);
    await click(plain, adTitle);
    let zap = await waitFor(async () => {
      const z = await zapCss();
      return z && z.css.includes('display: none') ? z : null;
    }, 3000);
    check('单击后写入本网站的「快捷消除」规则', !!zap && zap.name === `快捷消除 · ${site}` && zap.sites[0] === site, zap);
    check('被点击的元素立即隐藏', await waitFor(adHidden, 3000));
    check('同类的其他元素不受影响', await evaluate(plain.sessionId, `[...document.querySelectorAll('.feed .item:not(.ad)')].every(e => getComputedStyle(e).display !== 'none')`));
    check('点击没有触发网页上的链接', await evaluate(plain.sessionId, `location.hash === ''`));
    const zapSelector = zap && /^(.+?) \{ display: none !important; \}$/m.exec(zap.css)[1];
    check('生成的选择器只选中这一个元素', await evaluate(plain.sessionId, `document.querySelectorAll(${JSON.stringify(zapSelector)}).length === 1 && document.querySelector(${JSON.stringify(zapSelector)}).matches('.ad')`), zapSelector);

    await press(plain, 'z', CTRL);
    check('Ctrl+Z 撤销后元素恢复', await waitFor(async () => !(await adHidden()), 3000));
    zap = await zapCss();
    check('撤销后规则里那一行被删掉', zap && !zap.css.includes('display: none'), zap && zap.css);

    // 键盘路径：Tab 选外层 + Enter 隐藏
    await mouse(plain, 'mouseMoved', { x: 5, y: 5 });
    await mouse(plain, 'mouseMoved', adTitle);
    await press(plain, 'Tab');
    await press(plain, 'Enter');
    check('Enter 也能隐藏当前高亮的元素', await waitFor(adHidden, 3000));
    await press(plain, 'Escape');
    check('Esc 退出快捷消除', await waitFor(() => evaluate(plain.sessionId, `!document.querySelector('site-tweaker-picker')`), 2000));
    check('退出后网页点击恢复正常', await evaluate(plain.sessionId, `(() => { let hit = false; const a = document.querySelector('.feed .item .title'); a.addEventListener('click', e => { hit = true; e.preventDefault(); }, { once: true }); a.click(); return hit; })()`));
    await reload(plain);
    check('刷新后元素仍然隐藏', await waitFor(adHidden, 3000));

    // ===== 代码小窗 =====
    section('代码小窗');
    await evaluate(sw.sessionId, `self.SiteTweakerTools.openTool(${plainTab}, 'viewer')`);
    check('小窗出现在页面上', await evaluate(plain.sessionId, `!!document.querySelector('site-tweaker-viewer')`));
    const viewerState = () => evaluateInExtension(plain, `self.SiteTweakerViewer.debug()`);
    let v = await waitFor(async () => {
      const d = await viewerState();
      return d && d.cards.length ? d : null;
    }, 3000);
    if (!v || !v.cards) {
      for (const c of plain.contexts) {
        const r = await cdp.send('Runtime.evaluate', { expression: `Object.keys(self).filter(k => k.startsWith('SiteTweaker')).join(',')`, contextId: c.id, returnByValue: true }, plain.sessionId).catch((e) => ({ result: { value: e.message } }));
        console.log('    上下文', c.id, c.name, JSON.stringify(c.auxData), '→', r.result && r.result.value);
      }
      throw new Error('读取小窗状态失败：' + String((v && v.stack) || JSON.stringify(v)));
    }
    const cardNames = v.cards.map((c) => c.name);
    check('列出作用于本页的规则（含停用的）', cardNames.includes(`快捷消除 · ${site}`) && cardNames.includes('CSS 背景') && cardNames.includes('已停用'), cardNames);
    check('不列出其他网站的规则', !cardNames.includes('其他网站'), cardNames);
    const zapCard = v && v.cards.find((c) => c.id.startsWith('zap-'));
    check('显示规则的 CSS 代码', zapCard && zapCard.code.some((c) => c.includes('display: none !important')), zapCard);
    check('显示规则的 JS 代码', v && v.cards.find((c) => c.name === 'JS await').code.some((c) => c.includes('dataset.awaited')), v && v.cards.find((c) => c.name === 'JS await'));
    check('停用的规则显示为灰色', v && v.cards.find((c) => c.name === '已停用').off);
    await sleep(200);
    await screenshot(plain, 'viewer');

    await click(plain, zapCard.switchAt);
    check('在小窗里关掉规则，元素立刻恢复', await waitFor(async () => !(await adHidden()), 3000));
    check('关掉的规则写回存储', (await zapCss()).enabled === false);
    v = await viewerState();
    await click(plain, v.cards.find((c) => c.id.startsWith('zap-')).switchAt);
    check('再打开规则，元素重新隐藏', await waitFor(adHidden, 3000));
    v = await waitFor(async () => {
      const d = await viewerState();
      return d && !d.cards.find((c) => c.id.startsWith('zap-')).off ? d : null;
    }, 2000);
    check('小窗随规则变化自动刷新', !!v, v);

    await evaluate(sw.sessionId, `self.SiteTweakerTools.openTool(${plainTab}, 'viewer')`);
    check('再次打开即关闭小窗', await waitFor(() => evaluate(plain.sessionId, `!document.querySelector('site-tweaker-viewer')`), 2000));
    check('页面工具没有报错', !plain.logs.some((l) => /^exception/.test(l)), plain.logs.filter((l) => /^exception/.test(l)));

    await screenshot(plain, 'plain-page');
    section('后台日志');
    console.log(sw.logs.length ? sw.logs.join('\n') : '  （无警告或错误）');
  } catch (err) {
    check('测试流程未中断', false, String((err && err.stack) || err));
  } finally {
    await cdp.send('Browser.close').catch(() => {});
    server.close();
    setTimeout(() => proc.kill(), 2000).unref();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n共 ${results.length} 项，通过 ${results.length - failed} 项，失败 ${failed} 项`);
    console.log('截图：' + SHOTS);
    process.exitCode = failed ? 1 : 0;
  }
}

main();
