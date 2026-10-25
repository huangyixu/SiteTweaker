/* 工具栏弹窗：查看并开关作用于当前页面的规则 */
(async () => {
  'use strict';

  const ST = self.SiteTweaker;
  const $ = (id) => document.getElementById(id);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || '';
  const injectable = ST.canInject(url);

  let rules = [];
  let settings = { enabled: true };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function openOptions(suffix) {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html' + suffix) });
    window.close();
  }

  function renderGlobal() {
    $('globalEnabled').checked = settings.enabled !== false;
    $('globalLabel').textContent = settings.enabled !== false ? '已启用' : '已暂停';
  }

  function matchedRules() {
    return injectable ? rules.filter((r) => ST.ruleMatchesUrl(r, url)) : [];
  }

  function renderRules() {
    const matched = matchedRules();
    const active = settings.enabled !== false ? matched.filter((r) => r.enabled).length : 0;
    $('count').textContent = matched.length ? `${active}/${matched.length} 生效` : '';
    $('empty').hidden = matched.length > 0;
    $('ruleList').replaceChildren(
      ...matched.map((rule) => {
        const li = el('li', 'rule-item' + (rule.enabled ? '' : ' off'));
        const name = el('span', 'rule-name', rule.name);
        name.title = rule.sites.join('\n');
        const tags = el('span', 'rule-tags');
        if (rule.css.trim()) tags.append(el('span', 'tag css', 'CSS'));
        if (rule.js.trim()) tags.append(el('span', 'tag js', 'JS'));

        const edit = el('button', 'btn ghost edit-btn', '✎');
        edit.title = '编辑规则';
        edit.addEventListener('click', () => openOptions('#rule=' + rule.id));

        const toggle = el('input', 'switch');
        toggle.type = 'checkbox';
        toggle.checked = rule.enabled;
        toggle.title = rule.enabled ? '点击停用' : '点击启用';
        toggle.addEventListener('change', async () => {
          rule.enabled = toggle.checked;
          await chrome.storage.local.set({ rules });
          if (rule.js.trim()) $('reloadBar').hidden = false;
          renderRules();
        });

        li.append(name, tags, edit, toggle);
        return li;
      }),
    );
  }

  async function renderNotice() {
    const notice = $('notice');
    const btn = $('noticeBtn');
    if (!injectable) {
      $('noticeText').textContent = '浏览器内置页面和扩展商店页面不允许注入样式或脚本。';
      btn.hidden = true;
      notice.hidden = false;
      return;
    }
    const usesJs = matchedRules().some((r) => r.enabled && r.js.trim());
    if (!usesJs) return;

    let status = null;
    try {
      status = await chrome.runtime.sendMessage({ type: 'getStatus' });
    } catch {
      return;
    }
    if (!status || status.userScripts) return;

    const key = 'csp:' + tab.id;
    const blocked = (await chrome.storage.session.get(key))[key] === url;
    const how = status.chromeVersion >= 138 ? '在扩展详情页打开「允许用户脚本」' : '在扩展管理页打开「开发者模式」';
    $('noticeText').textContent = blocked
      ? `此网站的安全策略拦截了规则脚本。${how}后刷新页面即可解决。`
      : `脚本正以兼容模式运行，部分网站可能被拦截。建议${how}。`;
    btn.hidden = false;
    notice.hidden = false;
  }

  // ---------- 初始化 ----------

  const data = await chrome.storage.local.get(['rules', 'settings']);
  rules = (data.rules || []).map(ST.normalizeRule);
  settings = { enabled: true, ...(data.settings || {}) };

  let host = url;
  try {
    const u = new URL(url);
    host = u.protocol === 'file:' ? decodeURIComponent(u.pathname.split('/').pop() || '本地文件') : u.host || url;
  } catch {
    // 保留原始网址
  }
  $('siteHost').textContent = host || '—';
  $('siteHost').title = url;

  renderGlobal();
  renderRules();
  renderNotice();

  if (!injectable) {
    $('rulesSection').hidden = true;
    $('newBtn').disabled = true;
    $('pickerBtn').disabled = true;
    $('viewerBtn').disabled = true;
  }

  async function runTool(tool) {
    try {
      await SiteTweakerTools.openTool(tab.id, tool);
      window.close();
    } catch (err) {
      $('noticeText').textContent = '无法在此页面打开：' + ((err && err.message) || err);
      $('noticeBtn').hidden = true;
      $('notice').hidden = false;
    }
  }
  $('pickerBtn').addEventListener('click', () => runTool('picker'));
  $('viewerBtn').addEventListener('click', () => runTool('viewer'));

  // 把实际生效的快捷键写进按钮提示
  chrome.commands.getAll().then((commands) => {
    const keys = Object.fromEntries(commands.map((c) => [c.name, c.shortcut]));
    $('pickerBtn').title = keys['start-picker'] ? '快捷键：' + keys['start-picker'] : '可在扩展快捷键设置里指定快捷键';
    $('viewerBtn').title = keys['toggle-viewer'] ? '快捷键：' + keys['toggle-viewer'] : '可在扩展快捷键设置里指定快捷键';
  });

  $('globalEnabled').addEventListener('change', async (e) => {
    settings = { ...settings, enabled: e.target.checked };
    await chrome.storage.local.set({ settings });
    renderGlobal();
    renderRules();
    if (matchedRules().some((r) => r.js.trim())) $('reloadBar').hidden = false;
  });
  $('newBtn').addEventListener('click', () => openOptions('?new=' + encodeURIComponent(ST.siteFromUrl(url))));
  $('manageBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
  $('noticeBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
    window.close();
  });
  $('reloadBtn').addEventListener('click', () => {
    chrome.tabs.reload(tab.id);
    window.close();
  });
})();
