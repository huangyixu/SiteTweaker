/*
 * 内容脚本：在匹配的网页里插入规则的 CSS（修改后实时生效），
 * 并请求后台运行规则的 JS（已注册为用户脚本的由 Chrome 自动注入，后台会跳过）。
 */
(() => {
  'use strict';

  const ST = self.SiteTweaker;
  const ATTR = 'data-site-tweaker';
  const isTop = window === window.top;

  const alive = () => {
    try {
      return !!chrome.runtime.id;
    } catch {
      return false;
    }
  };

  // 同一页面只保留一个有效实例；扩展重载后旧实例失效，新实例接管
  if (window.__siteTweaker && window.__siteTweaker.alive()) return;
  window.__siteTweaker = { alive };
  document.querySelectorAll(`style[${ATTR}]`).forEach((el) => el.remove());

  // 安装/更新后补注入到已打开的页面时，页面早已加载完，不再补跑 JS
  const lateInjected = document.readyState !== 'loading';

  let rules = [];
  let enabled = true;
  let styles = new Map(); // 规则 id -> <style>
  const previews = new Map(); // 规则 id -> 管理页 AI 助手正在预览的草稿 CSS
  let observer = null;
  let disposed = false;
  let lastHref = location.href;
  let lastBadge = -1;

  function check() {
    if (!disposed && !alive()) {
      disposed = true;
      if (observer) observer.disconnect();
    }
    return !disposed;
  }

  function activeRules() {
    if (!enabled) return [];
    const href = location.href;
    return rules.filter((r) => r.enabled && (isTop || r.allFrames) && ST.ruleMatchesUrl(r, href));
  }

  /** 让我们的 <style> 按规则顺序排在 <html> 的最后，优先级高于网页自身的样式 */
  function placeStyles() {
    const root = document.documentElement;
    if (!root || !styles.size) return;
    if (!observer) {
      observer = new MutationObserver(() => check() && placeStyles());
      observer.observe(root, { childList: true });
    }
    const els = [...styles.values()];
    let node = root.lastElementChild;
    for (let i = els.length - 1; i >= 0; i--) {
      if (node !== els[i]) {
        for (const el of els) root.appendChild(el);
        return;
      }
      node = node.previousElementSibling;
    }
  }

  function applyCss(active) {
    // 预览中的规则用草稿 CSS 替换已保存的（不论是否启用、是否已保存）
    const sheets = active.map((r) => [r.id, previews.has(r.id) ? previews.get(r.id) : r.css]);
    for (const [id, css] of previews) if (!sheets.some(([sid]) => sid === id)) sheets.push([id, css]);
    const next = new Map();
    for (const [id, css] of sheets) {
      if (!css.trim()) continue;
      let el = styles.get(id);
      if (!el) {
        el = document.createElement('style');
        el.setAttribute(ATTR, id);
      }
      if (el.textContent !== css) el.textContent = css;
      next.set(id, el);
    }
    for (const [id, el] of styles) if (!next.has(id)) el.remove();
    styles = next;
    placeStyles();
  }

  function reportBadge(count) {
    if (!isTop || count === lastBadge) return;
    lastBadge = count;
    chrome.runtime.sendMessage({ type: 'badge', count }).catch(() => {});
  }

  function whenReady(runAt, fn) {
    if (runAt === 'document_start') return fn();
    const go = runAt === 'document_idle' ? () => setTimeout(fn, 0) : fn;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
  }

  function requestJs(active) {
    const groups = {};
    for (const rule of active) {
      if (rule.js.trim()) (groups[rule.runAt] = groups[rule.runAt] || []).push(rule.id);
    }
    for (const [runAt, ids] of Object.entries(groups)) {
      whenReady(runAt, () => check() && chrome.runtime.sendMessage({ type: 'runJs', ids }).catch(() => {}));
    }
  }

  function refresh() {
    if (!check()) return;
    const active = activeRules();
    applyCss(active);
    reportBadge(active.length);
  }

  chrome.storage.local.get(['rules', 'settings']).then((data) => {
    if (!check()) return;
    rules = (data.rules || []).map(ST.normalizeRule);
    enabled = !data.settings || data.settings.enabled !== false;
    const active = activeRules();
    applyCss(active);
    reportBadge(active.length);
    if (!lateInjected) requestJs(active);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.rules || changes.settings)) return;
    if (changes.rules) rules = (changes.rules.newValue || []).map(ST.normalizeRule);
    if (changes.settings) enabled = !changes.settings.newValue || changes.settings.newValue.enabled !== false;
    refresh();
  });

  // 管理页的 AI 助手连到本页预览草稿 CSS；管理页关闭或断开后恢复为已保存的样式
  if (isTop) {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== 'site-tweaker-preview') return;
      const ids = new Set();
      port.onMessage.addListener((msg) => {
        if (!msg || typeof msg.id !== 'string') return;
        if (typeof msg.css === 'string') {
          previews.set(msg.id, msg.css);
          ids.add(msg.id);
        } else {
          previews.delete(msg.id);
          ids.delete(msg.id);
        }
        refresh();
      });
      port.onDisconnect.addListener(() => {
        for (const id of ids) previews.delete(id);
        refresh();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => check() && placeStyles(), { once: true });

  // 单页应用切换网址时重新判断 CSS 规则（JS 规则只在页面加载时运行一次）
  const onUrlChange = () => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    refresh();
  };
  if (window.navigation) window.navigation.addEventListener('currententrychange', onUrlChange);
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener('hashchange', onUrlChange);
})();
