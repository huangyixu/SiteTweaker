/*
 * 后台服务：
 * - 把带 JS 的规则注册为 Chrome 用户脚本（不受网站 CSP 限制）
 * - 用户脚本权限没开时，按内容脚本的请求以兼容方式（<script> 标签）运行 JS
 * - 维护工具栏图标上的规则数量角标
 * - 响应快捷键，打开快捷消除 / 代码小窗
 * - 把规则和设置通过 chrome.storage.sync 随浏览器账号同步
 */
importScripts('lib/rules.js', 'lib/tools.js', 'lib/sync.js');

const ST = self.SiteTweaker;
const SYNC = self.SiteTweakerSync;
const BADGE_COLOR = '#5b5bd6';

/** Chrome 120-137 需开启开发者模式，138+ 需在扩展详情页开启「允许用户脚本」 */
function userScriptsAvailable() {
  try {
    chrome.userScripts.getScripts().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function chromeMajorVersion() {
  const m = /Chrome\/(\d+)/.exec(navigator.userAgent);
  return m ? Number(m[1]) : 0;
}

async function loadState() {
  const { rules = [], settings = {} } = await chrome.storage.local.get(['rules', 'settings']);
  return { rules: rules.map(ST.normalizeRule), enabled: settings.enabled !== false };
}

// ---------- 用户脚本注册 ----------

let syncChain = Promise.resolve();

function syncUserScripts() {
  syncChain = syncChain.then(doSync, doSync);
  return syncChain;
}

async function doSync() {
  const available = userScriptsAvailable();
  const errors = {};
  if (available) {
    const { rules, enabled } = await loadState();
    await chrome.userScripts
      .configureWorld({ csp: "script-src 'self' 'unsafe-inline' 'unsafe-eval'", messaging: false })
      .catch((err) => console.warn('configureWorld 失败', err));
    await chrome.userScripts.unregister();
    if (enabled) {
      for (const rule of rules) {
        if (!rule.enabled || !rule.js.trim()) continue;
        const { matches, excludeMatches } = ST.compileSites(rule.sites);
        if (!matches.length) continue;
        try {
          // 逐条注册：一条规则出错不影响其他规则
          await chrome.userScripts.register([
            {
              id: rule.id,
              matches,
              excludeMatches,
              js: [{ code: ST.wrapUserJs(rule) }],
              runAt: rule.runAt,
              world: rule.world,
              allFrames: rule.allFrames,
            },
          ]);
        } catch (err) {
          errors[rule.id] = String((err && err.message) || err);
        }
      }
    }
  }
  await chrome.storage.session.set({ syncedWith: available, syncErrors: errors });
}

let syncTimer = 0;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncUserScripts, 200);
}

/** 用户可能刚开/关了用户脚本权限：状态和上次同步时不同就重新同步 */
async function syncIfPermissionChanged() {
  const { syncedWith } = await chrome.storage.session.get('syncedWith');
  if (syncedWith !== userScriptsAvailable()) await syncUserScripts();
}

// ---------- 账号同步 ----------

let reconcileChain = Promise.resolve();
let reconcileTimer = 0;

/** 合并有 2 秒防抖：编辑、开关连续触发时合成一次写入，避开同步区每分钟 120 次的写入上限 */
function scheduleReconcile(delay = 2000) {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    reconcileChain = reconcileChain.then(reconcile, reconcile);
  }, delay);
}

async function reconcile() {
  const [local, remote] = await Promise.all([
    chrome.storage.local.get(['rules', 'settings', 'syncBase', 'syncState']),
    chrome.storage.sync.get(null),
  ]);
  const oldBase = local.syncBase || {};
  const plan = SYNC.merge({ rules: local.rules, settings: local.settings, remote, base: oldBase, keepLocal: isPristineExample });

  // 先写本地；合并期间用户又改了规则就放弃这一轮，稍后重来
  const patch = {};
  if (plan.rules) patch.rules = plan.rules;
  if (plan.settings) patch.settings = plan.settings;
  if (Object.keys(patch).length) {
    const now = await chrome.storage.local.get(['rules', 'settings']);
    if (JSON.stringify(now.rules) !== JSON.stringify(local.rules) || JSON.stringify(now.settings) !== JSON.stringify(local.settings)) {
      return scheduleReconcile();
    }
    await chrome.storage.local.set(patch);
  }

  let error = '';
  try {
    if (Object.keys(plan.set).length) await chrome.storage.sync.set(plan.set);
    if (plan.remove.length) await chrome.storage.sync.remove(plan.remove);
  } catch (err) {
    // 没写进同步区的改动保持原来的指纹，下次重试
    error = String((err && err.message) || err);
    for (const key of [...Object.keys(plan.set), ...plan.remove]) {
      if (key in oldBase) plan.base[key] = oldBase[key];
      else delete plan.base[key];
    }
    scheduleReconcile(60000);
  }

  const state = { unsynced: plan.unsynced, error };
  const meta = {};
  if (JSON.stringify(plan.base) !== JSON.stringify(oldBase)) meta.syncBase = plan.base;
  if (JSON.stringify(state) !== JSON.stringify(local.syncState)) meta.syncState = state;
  if (Object.keys(meta).length) await chrome.storage.local.set(meta);
}

// ---------- 兼容方式运行 JS ----------

/** 注入到页面主环境执行：用 <script> 标签运行代码，返回是否被 CSP / Trusted Types 拦截 */
function injectInlineScript(code) {
  try {
    const script = document.createElement('script');
    script.textContent = 'document.currentScript.dataset.ran = "1"; ' + code;
    (document.head || document.documentElement).appendChild(script);
    const ran = script.dataset.ran === '1';
    script.remove();
    if (ran) return 'ok';
  } catch {
    // Trusted Types 会直接抛错
  }
  console.warn('[网页定制] 当前网站的安全策略（CSP）拦截了规则脚本。在扩展详情页开启「允许用户脚本」后刷新页面即可解决。');
  return 'blocked';
}

async function runRulesForFrame(ruleIds, sender) {
  const tabId = sender.tab && sender.tab.id;
  const frameId = sender.frameId || 0;
  if (tabId == null || tabId < 0 || !Array.isArray(ruleIds) || !ruleIds.length) return;

  const { rules, enabled } = await loadState();
  if (!enabled) return;
  let todo = rules.filter((r) => ruleIds.includes(r.id) && r.enabled && r.js.trim() && ST.ruleMatchesUrl(r, sender.url));
  if (!todo.length) return;

  const target = { tabId, frameIds: [frameId] };

  if (userScriptsAvailable()) {
    // 已注册的规则由 Chrome 自动注入，这里只补跑没注册上的（比如刚开启权限）
    const registered = new Set((await chrome.userScripts.getScripts({ ids: todo.map((r) => r.id) })).map((s) => s.id));
    todo = todo.filter((r) => !registered.has(r.id));
    if (!todo.length) return;
    const { syncErrors = {} } = await chrome.storage.session.get('syncErrors');
    if (todo.some((r) => !syncErrors[r.id])) syncUserScripts();
    if (typeof chrome.userScripts.execute === 'function') {
      for (const rule of todo) {
        await chrome.userScripts
          .execute({ target, js: [{ code: ST.wrapUserJs(rule) }], world: rule.world, injectImmediately: true })
          .catch((err) => console.warn('userScripts.execute 失败', err));
      }
      return;
    }
  }

  let blocked = false;
  for (const rule of todo) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target,
        world: 'MAIN',
        injectImmediately: true,
        func: injectInlineScript,
        args: [ST.wrapUserJs(rule)],
      });
      if (res && res.result === 'blocked') blocked = true;
    } catch (err) {
      console.warn('注入脚本失败', err);
    }
  }
  if (frameId === 0) {
    const key = 'csp:' + tabId;
    if (blocked) await chrome.storage.session.set({ [key]: sender.url });
    else await chrome.storage.session.remove(key);
  }
}

// ---------- 状态与角标 ----------

async function getStatus() {
  await syncIfPermissionChanged();
  const { syncErrors = {} } = await chrome.storage.session.get('syncErrors');
  return {
    userScripts: userScriptsAvailable(),
    chromeVersion: chromeMajorVersion(),
    extensionId: chrome.runtime.id,
    syncErrors,
  };
}

function setBadge(sender, count) {
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null || tabId < 0 || sender.frameId !== 0) return;
  chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' }).catch(() => {});
}

function setupBadge() {
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => {});
  if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: '#ffffff' }).catch(() => {});
}

// ---------- 安装 ----------

function exampleRule() {
  return ST.normalizeRule({
    id: 'example',
    name: '示例：example.com 暗色主题',
    sites: ['example.com'],
    css: [
      '/* 示例规则：打开 https://example.com 看看效果，不需要时可以停用或删除 */',
      'body {',
      '  background: #17181c !important;',
      '  color: #d8dae0 !important;',
      '}',
      '',
      'div {',
      '  background: #22242a !important;',
      '  border-radius: 16px;',
      '  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);',
      '}',
      '',
      'a {',
      '  color: #9db4ff !important;',
      '}',
      '',
    ].join('\n'),
    js: [
      '// 示例脚本：在标题下面加一行提示',
      "const tip = document.createElement('p');",
      "tip.textContent = '✔ 网页定制已生效：这段文字由你的规则脚本插入';",
      "tip.style.color = '#7ee2a8';",
      "document.querySelector('h1')?.after(tip);",
      '',
    ].join('\n'),
  });
}

/** 没改过的示例规则不上传，免得每台新设备都往账号里再塞一份 */
function isPristineExample(rule) {
  if (rule.id !== 'example') return false;
  const plain = (r) => JSON.stringify({ ...r, updatedAt: 0 });
  return plain(rule) === plain(exampleRule());
}

/** 安装或更新后，让已打开的页面也立即用上 CSS（JS 需要刷新页面） */
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['lib/rules.js', 'content.js'] })
      .catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  setupBadge();
  if (reason === 'install') {
    const { rules } = await chrome.storage.local.get('rules');
    if (!rules) {
      // 账号里已经同步过规则（在别的设备上用过）就不放示例规则，稍后合并时拉取
      const remote = await chrome.storage.sync.get(null).catch(() => ({}));
      const synced = Object.keys(remote).some((key) => key.startsWith(SYNC.RULE_PREFIX));
      await chrome.storage.local.set({ rules: synced ? [] : [exampleRule()], settings: { enabled: true } });
    }
    chrome.runtime.openOptionsPage();
  }
  scheduleReconcile(0);
  await syncUserScripts();
  injectIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(() => {
  setupBadge();
  syncUserScripts();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.rules || changes.settings)) {
    scheduleSync();
    scheduleReconcile();
  } else if (area === 'sync') {
    scheduleReconcile();
  }
});

// 后台每次被唤醒都对一下账号里的数据：只读不写，没有差异时没有开销
scheduleReconcile();

chrome.commands.onCommand.addListener(async (command, tab) => {
  const tool = { 'start-picker': 'picker', 'toggle-viewer': 'viewer' }[command];
  if (!tool) return;
  const target = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!target || !ST.canInject(target.url)) return;
  self.SiteTweakerTools.openTool(target.id, tool).catch((err) => console.warn('打开页面工具失败', err));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove('csp:' + tabId).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg && msg.type) {
    case 'badge':
      setBadge(sender, msg.count);
      return false;
    case 'runJs':
      runRulesForFrame(msg.ids, sender)
        .catch((err) => console.warn(err))
        .finally(() => sendResponse({}));
      return true;
    case 'getStatus':
      getStatus().then(sendResponse);
      return true;
    case 'openOptions': {
      // 页面内小窗请求打开管理页（内容脚本不能直接打开扩展页面）
      const query = typeof msg.query === 'string' && /^[#?][^\s]{0,300}$/.test(msg.query) ? msg.query : '';
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html' + query), index: sender.tab ? sender.tab.index + 1 : undefined });
      return false;
    }
    default:
      return false;
  }
});
