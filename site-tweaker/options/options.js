/* 规则管理页 */
(() => {
  'use strict';

  const ST = self.SiteTweaker;
  const $ = (id) => document.getElementById(id);

  const els = {
    global: $('globalEnabled'),
    banner: $('banner'),
    bannerHow: $('bannerHow'),
    search: $('search'),
    list: $('ruleList'),
    listEmpty: $('listEmpty'),
    editor: $('editor'),
    editorEmpty: $('editorEmpty'),
    name: $('ruleName'),
    enabled: $('ruleEnabled'),
    sites: $('ruleSites'),
    preview: $('sitesPreview'),
    testUrl: $('testUrl'),
    testResult: $('testResult'),
    css: $('ruleCss'),
    js: $('ruleJs'),
    runAt: $('ruleRunAt'),
    world: $('ruleWorld'),
    allFrames: $('ruleAllFrames'),
    saveState: $('saveState'),
    toast: $('toast'),
  };

  const cssEditor = CodeEditor.attach(els.css, els.css.previousElementSibling);
  const jsEditor = CodeEditor.attach(els.js, els.js.previousElementSibling);

  let rules = [];
  let settings = { enabled: true };
  let status = null;
  let draft = null; // 正在编辑的规则副本
  let isNew = false; // draft 是否还没保存过
  let baseline = ''; // 打开时的内容快照，用来判断有没有改动
  let dirty = false;

  // ---------- 工具 ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  let toastTimer = 0;
  function toast(message, isError) {
    els.toast.textContent = message;
    els.toast.classList.toggle('error', !!isError);
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
  }

  function snapshot(rule) {
    return JSON.stringify([rule.name.trim(), rule.sites, rule.css, rule.js, rule.runAt, rule.world, rule.allFrames]);
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    const sameDay = d.toDateString() === new Date().toDateString();
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return sameDay ? `今天 ${time}` : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
  }

  function persistRules() {
    return chrome.storage.local.set({ rules });
  }

  function confirmDiscard() {
    return !dirty || confirm('当前规则有未保存的修改，确定要放弃吗？');
  }

  // ---------- 列表 ----------

  function renderList() {
    const q = els.search.value.trim().toLowerCase();
    const items = isNew && draft ? [draft, ...rules] : rules;
    const shown = q
      ? items.filter((r) => r.name.toLowerCase().includes(q) || r.sites.some((s) => s.toLowerCase().includes(q)))
      : items;
    els.list.replaceChildren(...shown.map(renderItem));
    els.listEmpty.hidden = shown.length > 0;
    els.listEmpty.textContent = items.length ? '没有找到匹配的规则' : '还没有规则，点击「新建」开始定制网页吧';
  }

  function renderItem(rule) {
    const current = draft && rule.id === draft.id;
    const view = current ? draft : rule;

    const li = el('li', 'rule-item' + (current ? ' active' : '') + (view.enabled ? '' : ' off'));
    const main = el('div', 'rule-main');
    const title = el('div', 'rule-title');
    title.append(el('span', 'name', view.name.trim() || (current && isNew ? '新规则' : '未命名规则')));
    if (current && (dirty || isNew)) {
      const mark = el('span', 'unsaved');
      mark.title = '尚未保存';
      title.append(mark);
    }
    main.append(title, el('div', 'rule-sites', view.sites.length ? view.sites.join(' · ') : '未设置网站'));

    const tags = el('div', 'rule-tags');
    if (view.css.trim()) tags.append(el('span', 'tag css', 'CSS'));
    if (view.js.trim()) tags.append(el('span', 'tag js', 'JS'));
    if (tags.childElementCount) main.append(tags);

    const toggle = el('input', 'switch');
    toggle.type = 'checkbox';
    toggle.checked = view.enabled;
    toggle.title = view.enabled ? '点击停用' : '点击启用';
    toggle.addEventListener('click', (e) => e.stopPropagation());
    toggle.addEventListener('change', () => setEnabled(rule.id, toggle.checked));

    li.append(main, toggle);
    li.addEventListener('click', () => selectRule(rule.id));
    return li;
  }

  /** 启用开关即时生效（新规则除外，它跟着保存一起写入） */
  async function setEnabled(id, on) {
    if (draft && draft.id === id) {
      draft.enabled = on;
      els.enabled.checked = on;
      if (isNew) return updateDirty();
    }
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;
    rule.enabled = on;
    await persistRules();
    renderList();
    toast(on ? '规则已启用' : '规则已停用');
  }

  // ---------- 编辑区 ----------

  function openDraft(rule, asNew) {
    draft = structuredClone(rule);
    isNew = asNew;
    baseline = snapshot(draft);
    dirty = false;
    fillEditor();
    renderList();
    updateHash();
  }

  function selectRule(id) {
    if (draft && draft.id === id) return;
    const rule = rules.find((r) => r.id === id);
    if (!rule || !confirmDiscard()) return;
    openDraft(rule, false);
  }

  function newRule(site) {
    if (!confirmDiscard()) return;
    openDraft(
      {
        id: ST.uid(),
        name: '',
        enabled: true,
        sites: site ? [site] : [],
        css: '',
        js: '',
        runAt: 'document_idle',
        world: 'MAIN',
        allFrames: false,
        updatedAt: Date.now(),
      },
      true,
    );
    (site ? els.css : els.sites).focus();
  }

  function fillEditor() {
    els.editor.hidden = !draft;
    els.editorEmpty.hidden = !!draft;
    if (!draft) return;
    els.name.value = draft.name;
    els.enabled.checked = draft.enabled;
    els.sites.value = draft.sites.join('\n');
    els.css.value = draft.css;
    els.js.value = draft.js;
    els.runAt.value = draft.runAt;
    els.world.value = draft.world;
    els.allFrames.checked = draft.allFrames;
    els.css.scrollTop = els.js.scrollTop = 0;
    cssEditor.refresh();
    jsEditor.refresh();
    setTab(!draft.css.trim() && draft.js.trim() ? 'js' : 'css');
    renderPreview();
    renderDots();
    renderSaveState();
  }

  function readEditor() {
    draft.name = els.name.value;
    draft.sites = els.sites.value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    draft.css = els.css.value;
    draft.js = els.js.value;
    draft.runAt = els.runAt.value;
    draft.world = els.world.value;
    draft.allFrames = els.allFrames.checked;
  }

  function updateDirty() {
    dirty = snapshot(draft) !== baseline;
    renderSaveState();
    renderDots();
    renderList();
  }

  function renderSaveState() {
    let text;
    if (isNew) text = '新规则 · 尚未保存';
    else if (dirty) text = '有未保存的修改';
    else text = '已保存 · ' + formatTime(draft.updatedAt);
    els.saveState.textContent = text;
    els.saveState.classList.toggle('dirty', isNew || dirty);
  }

  function renderDots() {
    document.querySelector('[data-dot="css"]').classList.toggle('on', !!draft.css.trim());
    document.querySelector('[data-dot="js"]').classList.toggle('on', !!draft.js.trim());
  }

  function chip(kind, text) {
    return el('span', 'chip ' + kind, text);
  }

  function renderPreview() {
    const { matches, excludeMatches, errors } = ST.compileSites(draft.sites);
    const label = (p) => (p === '<all_urls>' ? '所有网站' : p);
    const chips = [
      ...matches.map((p) => chip('include', label(p))),
      ...excludeMatches.map((p) => chip('exclude', label(p))),
      ...errors.map((e) => chip('error', `「${e.text}」${e.message}`)),
    ];
    if (!matches.length && !errors.length) chips.push(chip('warn', '还没有填写网站，规则不会生效'));
    const syncError = status && status.syncErrors && status.syncErrors[draft.id];
    if (syncError && !dirty) chips.push(chip('error', 'Chrome 注册脚本失败：' + syncError));
    els.preview.replaceChildren(...chips);
    renderTest();
  }

  function renderTest() {
    const raw = els.testUrl.value.trim();
    els.testResult.className = 'test-result';
    if (!raw) {
      els.testResult.textContent = '';
      return;
    }
    const href = /^[a-z]+:/i.test(raw) ? raw : 'https://' + raw;
    let valid = true;
    try {
      new URL(href);
    } catch {
      valid = false;
    }
    const ok = valid && ST.ruleMatchesUrl(draft, href);
    els.testResult.textContent = !valid ? '网址无效' : ok ? '✓ 会生效' : '✕ 不会生效';
    els.testResult.classList.add(ok ? 'yes' : 'no');
  }

  function setTab(name) {
    document.querySelectorAll('.tab').forEach((tab) => {
      const on = tab.dataset.tab === name;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.pane').forEach((pane) => (pane.hidden = pane.dataset.pane !== name));
    document.querySelectorAll('.tab-hint').forEach((hint) => (hint.hidden = hint.dataset.hint !== name));
  }

  function updateHash() {
    const hash = draft && !isNew ? '#rule=' + draft.id : '';
    history.replaceState(null, '', location.pathname + hash);
  }

  // ---------- 保存 / 删除 / 复制 ----------

  async function save() {
    if (!draft) return;
    readEditor();
    const { matches, errors } = ST.compileSites(draft.sites);
    if (errors.length) {
      toast('「适用网站」里有写法错误，请先修正', true);
      els.sites.focus();
      return;
    }
    if (!matches.length) {
      toast('请至少填写一个适用网站', true);
      els.sites.focus();
      return;
    }

    const fallbackName = draft.sites.find((s) => !s.startsWith('!') && !s.startsWith('#')) || '未命名规则';
    const rule = ST.normalizeRule({ ...draft, name: draft.name.trim() || fallbackName, updatedAt: Date.now() });
    const index = rules.findIndex((r) => r.id === rule.id);
    if (index === -1) rules.unshift(rule);
    else rules[index] = rule;
    await persistRules();

    draft = structuredClone(rule);
    isNew = false;
    baseline = snapshot(draft);
    dirty = false;
    els.name.value = draft.name;
    renderSaveState();
    renderList();
    updateHash();

    const hasCss = !!rule.css.trim();
    const hasJs = !!rule.js.trim();
    toast(
      hasCss && hasJs
        ? '已保存：CSS 已实时更新，JS 需刷新页面后生效'
        : hasJs
          ? '已保存：刷新页面后脚本生效'
          : '已保存：已打开的页面已实时更新',
    );
    setTimeout(refreshStatus, 800);
  }

  async function removeRule() {
    if (!draft) return;
    if (!isNew && !confirm(`确定删除规则「${draft.name}」吗？此操作无法撤销。`)) return;
    const id = draft.id;
    const wasNew = isNew;
    draft = null;
    isNew = false;
    dirty = false;
    if (!wasNew) {
      rules = rules.filter((r) => r.id !== id);
      await persistRules();
    }
    fillEditor();
    renderList();
    updateHash();
    toast(wasNew ? '已放弃新规则' : '规则已删除');
  }

  function duplicateRule() {
    if (!draft || !confirmDiscard()) return;
    readEditor();
    const copy = { ...structuredClone(draft), id: ST.uid(), name: (draft.name.trim() || '未命名规则') + ' 副本' };
    dirty = false;
    openDraft(copy, true);
    baseline = '';
    updateDirty();
    els.name.focus();
    els.name.select();
  }

  // ---------- 导入 / 导出 ----------

  function exportRules() {
    if (!rules.length) return toast('还没有可以导出的规则', true);
    const data = { app: 'site-tweaker', version: 1, exportedAt: new Date().toISOString(), rules };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = el('a');
    a.href = url;
    a.download = `网页定制-规则-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`已导出 ${rules.length} 条规则`);
  }

  async function importRules(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast('文件不是有效的 JSON', true);
    }
    const list = Array.isArray(data) ? data : data && Array.isArray(data.rules) ? data.rules : null;
    const valid = (list || []).filter((x) => x && typeof x === 'object');
    if (!valid.length) return toast('文件里没有找到规则', true);
    if (!confirm(`将导入 ${valid.length} 条规则，追加在现有规则之后（不会覆盖已有规则）。继续吗？`)) return;

    const ids = new Set(rules.map((r) => r.id));
    const existing = new Set(rules.map(snapshot));
    const added = [];
    for (const raw of valid) {
      const rule = ST.normalizeRule(raw);
      if (existing.has(snapshot(rule))) continue; // 完全相同的规则跳过
      if (ids.has(rule.id)) rule.id = ST.uid();
      ids.add(rule.id);
      existing.add(snapshot(rule));
      added.push(rule);
    }
    rules = rules.concat(added);
    await persistRules();
    renderList();
    const skipped = valid.length - added.length;
    toast(`已导入 ${added.length} 条规则` + (skipped ? `，跳过 ${skipped} 条重复规则` : ''));
  }

  // ---------- 用户脚本权限提示 ----------

  async function refreshStatus() {
    try {
      status = await chrome.runtime.sendMessage({ type: 'getStatus' });
    } catch {
      status = null;
    }
    renderBanner();
    if (draft) renderPreview();
  }

  function renderBanner() {
    const show = !!status && !status.userScripts && rules.some((r) => r.js.trim());
    els.banner.hidden = !show;
    if (show) {
      els.bannerHow.textContent =
        status.chromeVersion >= 138
          ? '解决方法：在扩展详情页打开「允许用户脚本」开关，然后刷新网页。'
          : '解决方法：在扩展管理页（chrome://extensions）右上角打开「开发者模式」，然后刷新网页。';
    }
  }

  // ---------- 事件 ----------

  for (const input of [els.name, els.sites, els.css, els.js]) {
    input.addEventListener('input', () => {
      readEditor();
      if (input === els.sites) renderPreview();
      updateDirty();
    });
  }
  for (const input of [els.runAt, els.world, els.allFrames]) {
    input.addEventListener('change', () => {
      readEditor();
      updateDirty();
    });
  }
  els.enabled.addEventListener('change', () => setEnabled(draft.id, els.enabled.checked));
  els.testUrl.addEventListener('input', renderTest);
  els.search.addEventListener('input', renderList);
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.tab)));

  $('newBtn').addEventListener('click', () => newRule());
  $('emptyNewBtn').addEventListener('click', () => newRule());
  $('saveBtn').addEventListener('click', save);
  $('deleteBtn').addEventListener('click', removeRule);
  $('dupBtn').addEventListener('click', duplicateRule);
  $('exportBtn').addEventListener('click', exportRules);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importRules(file);
  });
  $('bannerOpen').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id }));

  els.global.addEventListener('change', async () => {
    settings = { ...settings, enabled: els.global.checked };
    document.body.classList.toggle('paused', !settings.enabled);
    await chrome.storage.local.set({ settings });
    toast(settings.enabled ? '已恢复所有规则' : '已暂停所有规则');
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  // 用户在别的标签页开了权限后回来，更新提示
  window.addEventListener('focus', refreshStatus);

  // 弹窗或其他标签页改了规则
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      settings = { enabled: true, ...(changes.settings.newValue || {}) };
      els.global.checked = settings.enabled !== false;
      document.body.classList.toggle('paused', !els.global.checked);
    }
    if (!changes.rules) return;
    rules = (changes.rules.newValue || []).map(ST.normalizeRule);
    if (draft && !isNew) {
      const saved = rules.find((r) => r.id === draft.id);
      if (!saved) {
        // 规则在别处被删除：有改动就转为新规则保留，否则关闭
        if (dirty) {
          isNew = true;
          renderSaveState();
        } else {
          draft = null;
          fillEditor();
          updateHash();
        }
      } else {
        draft.enabled = saved.enabled;
        els.enabled.checked = saved.enabled;
        if (!dirty && saved.updatedAt !== draft.updatedAt) openDraft(saved, false);
      }
    }
    renderList();
    renderBanner();
  });

  // ---------- 启动 ----------

  (async function init() {
    const data = await chrome.storage.local.get(['rules', 'settings']);
    rules = (data.rules || []).map(ST.normalizeRule);
    settings = { enabled: true, ...(data.settings || {}) };
    els.global.checked = settings.enabled !== false;
    document.body.classList.toggle('paused', !els.global.checked);

    const params = new URLSearchParams(location.search);
    const wantedId = new URLSearchParams(location.hash.slice(1)).get('rule');
    const wanted = rules.find((r) => r.id === wantedId);
    if (params.has('new')) newRule(params.get('new'));
    else if (wanted) openDraft(wanted, false);
    else if (rules.length) openDraft(rules[0], false);
    else {
      fillEditor();
      renderList();
    }
    if (!params.has('new')) updateHash();
    refreshStatus();
  })();
})();
