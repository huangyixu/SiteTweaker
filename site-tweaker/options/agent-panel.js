/* 规则管理页的 AI 助手：接口设置、对话面板、读取参考页面、在参考页面实时预览 CSS */
(() => {
  'use strict';

  const ST = self.SiteTweaker;
  const Agent = self.SiteTweakerAgent;
  const Editor = self.SiteTweakerEditor;
  const $ = (id) => document.getElementById(id);

  const els = {
    layout: document.querySelector('.layout'),
    toggle: $('agentToggle'),
    panel: $('agentPanel'),
    model: $('agentModel'),
    tab: $('agentTab'),
    targetNote: $('agentTargetNote'),
    log: $('agentLog'),
    pending: $('agentPending'),
    form: $('agentForm'),
    input: $('agentInput'),
    send: $('agentSend'),
    stop: $('agentStop'),
    dialog: $('agentDialog'),
    cfgForm: $('agentConfigForm'),
    cfgUrl: $('cfgUrl'),
    cfgKey: $('cfgKey'),
    cfgModel: $('cfgModel'),
    cfgExtra: $('cfgExtra'),
    cfgResult: $('cfgResult'),
    cfgTest: $('cfgTest'),
  };

  // 常用任务：按钮上显示 label，发给 AI 的是更完整的 prompt
  const QUICK_TASKS = [
    {
      label: '去广告',
      prompt:
        '去掉这个网页上的广告：找出广告位、推广和赞助内容、悬浮广告和 iframe 广告，用 CSS 隐藏它们，注意不要误伤正文。广告是动态插入、选择器不稳定时，再用 JS 配合 MutationObserver 处理。',
    },
    {
      label: '暗色主题',
      prompt:
        '给这个网页加一个暗色主题：背景、文字、链接、边框、输入框、代码块的颜色要协调，对比度舒适，图片和视频保持原样。网页自带暗色模式时，优先想办法启用它。',
    },
    {
      label: '宽屏阅读',
      prompt: '让正文更适合阅读：加宽主内容区域，隐藏两侧与正文无关的侧栏，适当调整正文的字号和行距。',
    },
    {
      label: '精简页面',
      prompt:
        '隐藏页面上分散注意力的内容，例如推荐列表、热门榜单、分享按钮、登录或下载 App 的弹窗和横幅，只保留主要内容。动手前先列出你找到的区域，让我选择要隐藏哪些。',
    },
    {
      label: '优化字体',
      prompt: '优化页面的字体：正文换成更易读的系统字体（中文优先苹方、微软雅黑），适当调大正文字号和行距，代码使用等宽字体。',
    },
    {
      label: '回到顶部',
      prompt: '在页面右下角加一个「回到顶部」悬浮按钮：滚动超过一屏后出现，点击后平滑滚动到顶部，样式简洁，不遮挡页面内容。',
    },
    {
      label: '解除复制限制',
      prompt: '解除这个网页对选中和复制文字的限制（例如禁止选择、禁止右键、复制时自动追加版权信息），让我可以正常选中和复制。',
    },
  ];
  const OPEN_KEY = 'siteTweaker.agentOpen';
  const TOOL_LABEL = {
    get_page_overview: '查看页面结构',
    find_by_text: '查找文字',
    query_elements: '查询元素',
    get_element_html: '读取 HTML',
    update_rule: '修改规则代码',
  };

  let config = Agent.normalizeConfig();
  let tabs = [];
  let targetId = null;
  let ruleId = null;
  let port = null;
  let history = [];
  let controller = null; // 正在进行的对话
  let bubble = null; // 正在流式输出的回复
  let pendingAsk = null; // AI 正在等用户回答的问题：{ answer(text) }
  let conversation = 0; // 每次清空对话（含切换规则）加一
  const toolLines = new Map(); // 工具调用 id -> 界面上的那一行
  const undoSnapshots = new Map(); // update_rule 调用 id -> 修改前的代码

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  const clip = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
  const target = () => tabs.find((t) => t.id === targetId) || null;
  const isOpen = () => !els.panel.hidden;

  function hostOf(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'file:' ? decodeURIComponent(u.pathname.split('/').pop() || '本地文件') : u.host;
    } catch {
      return url;
    }
  }

  // ---------- 接口设置 ----------

  async function loadConfig() {
    const { agent } = await chrome.storage.local.get('agent');
    config = Agent.normalizeConfig(agent);
    renderConfigState();
  }

  function renderConfigState() {
    els.model.textContent = config.model;
    els.model.title = config.apiUrl;
    if (!history.length && !controller) renderIntro();
  }

  function readConfigForm() {
    return Agent.normalizeConfig({
      apiUrl: els.cfgUrl.value,
      apiKey: els.cfgKey.value,
      model: els.cfgModel.value,
      extra: els.cfgExtra.value,
    });
  }

  /** 返回错误提示，没有问题时返回空字符串 */
  function validateConfig(c) {
    if (!/^https?:\/\/[^/\s]+/i.test(c.apiUrl)) return '请填写以 http:// 或 https:// 开头的 API 地址';
    if (!c.apiKey) return '请填写 API Key';
    if (!c.model) return '请填写模型名称';
    if (c.extra) {
      try {
        const value = JSON.parse(c.extra);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return '额外请求参数必须是 JSON 对象';
      } catch {
        return '额外请求参数不是有效的 JSON';
      }
    }
    return '';
  }

  function setCfgResult(text, kind) {
    els.cfgResult.textContent = text;
    els.cfgResult.className = 'cfg-result' + (kind ? ' ' + kind : '');
  }

  function openConfig() {
    els.cfgUrl.value = config.apiUrl;
    els.cfgKey.value = config.apiKey;
    els.cfgKey.type = 'password';
    $('cfgKeyShow').textContent = '显示';
    els.cfgModel.value = config.model;
    els.cfgExtra.value = config.extra;
    els.cfgExtra.closest('details').open = !!config.extra;
    setCfgResult('');
    els.dialog.showModal();
    (config.apiUrl ? els.cfgModel : els.cfgUrl).focus();
  }

  async function testConfig() {
    const c = readConfigForm();
    const error = validateConfig(c);
    if (error) return setCfgResult(error, 'error');
    els.cfgTest.disabled = true;
    setCfgResult('正在连接…');
    try {
      const reply = await Agent.ping(c, AbortSignal.timeout(30000));
      setCfgResult('✓ 连接成功' + (reply ? '：' + clip(reply, 40) : ''), 'ok');
    } catch (err) {
      setCfgResult(err && err.name === 'TimeoutError' ? '连接超时' : String((err && err.message) || err), 'error');
    } finally {
      els.cfgTest.disabled = false;
    }
  }

  els.cfgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = readConfigForm();
    const error = validateConfig(c);
    if (error) return setCfgResult(error, 'error');
    await chrome.storage.local.set({ agent: c });
    config = c;
    renderConfigState();
    els.dialog.close();
    Editor.toast('AI 设置已保存');
    if (Editor.getDraft() && !isOpen()) setOpen(true);
  });
  els.cfgTest.addEventListener('click', testConfig);
  $('cfgCancel').addEventListener('click', () => els.dialog.close());
  $('cfgKeyShow').addEventListener('click', (e) => {
    const show = els.cfgKey.type === 'password';
    els.cfgKey.type = show ? 'text' : 'password';
    e.target.textContent = show ? '隐藏' : '显示';
  });
  $('agentSettingsBtn').addEventListener('click', openConfig);
  $('agentConfigBtn').addEventListener('click', openConfig);

  // ---------- 面板开关 ----------

  function setOpen(on) {
    on = on && !!Editor.getDraft();
    if (on === isOpen()) return;
    els.panel.hidden = !on;
    els.layout.classList.toggle('agent-open', on);
    els.toggle.setAttribute('aria-pressed', String(on));
    els.toggle.classList.toggle('active', on);
    if (on) {
      refreshTabs();
      renderPending();
      els.input.focus();
    } else {
      stopRun();
      disconnectPreview();
    }
  }

  /** 记住面板开关，下次打开管理页时恢复 */
  function remember(on) {
    try {
      localStorage.setItem(OPEN_KEY, on ? '1' : '');
    } catch {
      // 存不了就不记住
    }
  }

  let restoreOpen = false;
  try {
    restoreOpen = localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    // 忽略
  }

  els.toggle.addEventListener('click', () => {
    setOpen(!isOpen());
    remember(isOpen());
  });
  $('agentClose').addEventListener('click', () => {
    setOpen(false);
    remember(false);
  });

  // ---------- 参考页面 ----------

  async function refreshTabs() {
    const draft = Editor.getDraft();
    let list = [];
    try {
      list = (await chrome.tabs.query({})).filter((t) => t.id >= 0 && ST.canInject(t.url));
    } catch {
      list = [];
    }
    const matches = (t) => !!draft && ST.ruleMatchesUrl(draft, t.url);
    list.sort((a, b) => matches(b) - matches(a) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
    tabs = list;

    const keep = tabs.some((t) => t.id === targetId);
    const prev = targetId;
    if (!keep) targetId = tabs.length ? tabs[0].id : null;

    els.tab.replaceChildren(
      ...(tabs.length
        ? tabs.map((t) => {
            const option = el('option', null, `${clip(t.title || hostOf(t.url), 40)} — ${hostOf(t.url)}`);
            option.value = String(t.id);
            option.title = t.url;
            return option;
          })
        : [el('option', null, '没有可用的网页标签页')]),
    );
    els.tab.disabled = !tabs.length;
    if (targetId != null) els.tab.value = String(targetId);
    renderTargetNote();
    if (targetId !== prev || !port) connectPreview();
  }

  function renderTargetNote() {
    const draft = Editor.getDraft();
    const tab = target();
    let text = '';
    let warn = false;
    if (!tab) {
      text = '先在浏览器里打开要定制的网页，再点 ↻ 刷新。';
      warn = true;
    } else if (draft && !draft.sites.length) {
      text = `规则还没有适用网站，发送时会自动填入 ${ST.siteFromUrl(tab.url) || '此网址'}。`;
    } else if (draft && !ST.ruleMatchesUrl(draft, tab.url)) {
      text = '注意：本规则的「适用网站」不包含此页面，保存后不会在这里生效。';
      warn = true;
    } else {
      text = 'CSS 改动会实时预览在此页面上。';
    }
    els.targetNote.textContent = text;
    els.targetNote.classList.toggle('warn', warn);
  }

  els.tab.addEventListener('change', () => {
    targetId = Number(els.tab.value);
    renderTargetNote();
    connectPreview();
  });
  $('agentTabRefresh').addEventListener('click', refreshTabs);
  window.addEventListener('focus', () => isOpen() && refreshTabs());
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (isOpen() && tabs.some((t) => t.id === tabId)) refreshTabs();
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    // 参考页面刷新或跳转后，预览连接会断开，refreshTabs 会重新连接
    if (isOpen() && tabId === targetId && (info.status === 'complete' || info.url || info.title)) refreshTabs();
  });

  // ---------- CSS 实时预览 ----------

  function disconnectPreview() {
    if (port) {
      try {
        port.disconnect();
      } catch {
        // 已断开
      }
    }
    port = null;
  }

  async function connectPreview() {
    disconnectPreview();
    const tab = target();
    if (!tab || !isOpen()) return;
    try {
      // 扩展安装前就打开的页面里可能还没有内容脚本
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/rules.js', 'content.js'] });
    } catch {
      return;
    }
    if (tab.id !== targetId || port || !isOpen()) return;
    const p = chrome.tabs.connect(tab.id, { name: 'site-tweaker-preview', frameId: 0 });
    p.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port === p) port = null;
    });
    port = p;
    sendPreview();
  }

  let previewTimer = 0;
  function sendPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const draft = Editor.getDraft();
      if (!port || !draft) return;
      try {
        port.postMessage({ id: draft.id, css: draft.css });
      } catch {
        port = null;
      }
    }, 120);
  }

  // ---------- 对话记录 ----------

  /** 回复里的简单 Markdown：代码块、行内代码、粗体 */
  function renderMarkdown(text) {
    const frag = document.createDocumentFragment();
    const parts = String(text).split(/```[^\n`]*\n?([\s\S]*?)(?:```|$)/);
    parts.forEach((part, i) => {
      if (i % 2) {
        if (part.trim()) frag.append(el('pre', 'md-code', part.replace(/\n$/, '')));
        return;
      }
      const clean = part.replace(/^#{1,6}\s+/gm, '').replace(/^\n+|\n+$/g, '');
      if (!clean) return;
      const p = el('div', 'md-text');
      for (const piece of clean.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/)) {
        if (/^`[^`]+`$/.test(piece)) p.append(el('code', null, piece.slice(1, -1)));
        else if (/^\*\*[^*]+\*\*$/.test(piece)) p.append(el('strong', null, piece.slice(2, -2)));
        else if (piece) p.append(piece);
      }
      frag.append(p);
    });
    return frag;
  }

  function scrollLog() {
    const log = els.log;
    if (log.scrollHeight - log.scrollTop - log.clientHeight < 120) log.scrollTop = log.scrollHeight;
  }

  function addToLog(node) {
    els.log.querySelector('.agent-intro')?.remove();
    els.log.append(node);
    // 运行状态行始终留在对话最下面
    if (activity.isConnected) els.log.append(activity);
    els.log.scrollTop = els.log.scrollHeight;
    return node;
  }

  // ---------- 运行状态 ----------
  // 对话最下面一行 + 输入框下方的状态，显示 AI 此刻在做什么和已用时间，避免看起来像卡住了

  const activity = el('div', 'agent-activity');
  const activityText = el('span');
  const activityTime = el('span', 'agent-activity-time');
  activity.append(el('span', 'agent-spinner'), activityText, activityTime);
  let runStartedAt = 0;
  let phaseStartedAt = 0;
  let phaseText = '';
  let statusTimer = 0;

  function formatElapsed(ms) {
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`;
  }

  function renderStatus() {
    const now = Date.now();
    const phaseMs = now - phaseStartedAt;
    activityText.textContent = phaseText;
    // 同一阶段超过 3 秒才显示计时，说明仍在进行
    activityTime.textContent = phaseMs >= 3000 ? formatElapsed(phaseMs) : '';
    $('agentStatusText').textContent = `${pendingAsk ? '等待你的回答' : '运行中'} · ${formatElapsed(now - runStartedAt)}`;
  }

  /** 设置当前阶段；waiting 表示在等用户（不显示状态行，问题卡片本身就是提示） */
  function setPhase(text, waiting) {
    if (text !== phaseText) {
      phaseText = text;
      phaseStartedAt = Date.now();
    }
    if (waiting) activity.remove();
    else if (!activity.isConnected) addToLog(activity);
    renderStatus();
  }

  function startStatus() {
    runStartedAt = Date.now();
    phaseText = '';
    $('agentHint').hidden = true;
    $('agentStatus').hidden = false;
    clearInterval(statusTimer);
    statusTimer = setInterval(renderStatus, 1000);
    setPhase('正在思考…');
  }

  function stopStatus() {
    clearInterval(statusTimer);
    activity.remove();
    $('agentHint').hidden = false;
    $('agentStatus').hidden = true;
  }

  function toolPhase(name, chars) {
    if (name === 'update_rule') return chars ? `正在编写代码 · 已生成 ${chars.toLocaleString()} 字符` : '正在编写代码…';
    if (name === 'ask_user') return '正在准备问题…';
    if (TOOL_LABEL[name]) return `正在${TOOL_LABEL[name]}…`;
    return '正在思考…';
  }

  function renderIntro() {
    els.log.replaceChildren();
    const intro = el('div', 'agent-intro');
    if (!Agent.isConfigured(config)) {
      const btn = el('button', 'btn primary small', '设置 AI 接口');
      btn.addEventListener('click', openConfig);
      intro.append(
        el('p', null, '先设置一个兼容 OpenAI 接口的模型服务（API 地址、API Key、模型），AI 助手就能读取参考页面、帮你写 CSS 和 JS。'),
        btn,
      );
    } else {
      intro.append(
        el('p', null, '描述你想把这个网页改成什么样，AI 会先查看参考页面的结构，再写出这条规则的 CSS / JS。'),
        el('p', null, '也可以直接点下方的常用任务。'),
      );
    }
    els.log.append(intro);
  }

  function renderQuickTasks() {
    const box = $('agentQuick');
    box.replaceChildren(
      ...QUICK_TASKS.map((task) => {
        const chip = el('button', 'agent-quick-task', task.label);
        chip.type = 'button';
        chip.title = task.prompt;
        chip.addEventListener('click', () => {
          if (!controller) send(task.prompt, task.label);
        });
        return chip;
      }),
    );
  }

  function addNote(text, kind) {
    return addToLog(el('div', 'agent-note' + (kind ? ' ' + kind : ''), text));
  }

  function toolTitle(name, args) {
    const label = TOOL_LABEL[name] || name;
    return name === 'find_by_text' && args.text ? `${label}「${clip(String(args.text), 30)}」` : label;
  }

  function addToolLine(call, args) {
    const name = call.function.name;
    const line = el('div', 'agent-tool running');
    line.append(el('span', 'agent-tool-dot'), el('span', 'agent-tool-name', toolTitle(name, args)));
    if ((name === 'query_elements' || name === 'get_element_html') && args.selector) {
      line.append(el('code', 'agent-tool-arg', clip(String(args.selector), 60)));
    }
    line.append(el('span', 'agent-tool-result'));
    toolLines.set(call.id, line);
    addToLog(line);
  }

  function lineDiff(before, after) {
    const a = before ? before.split('\n') : [];
    const b = after ? after.split('\n') : [];
    const count = new Map();
    for (const l of a) count.set(l, (count.get(l) || 0) + 1);
    let kept = 0;
    for (const l of b) {
      if (count.get(l)) {
        count.set(l, count.get(l) - 1);
        kept++;
      }
    }
    return `+${b.length - kept} −${a.length - kept}`;
  }

  function finishToolLine(call, args, result) {
    const line = toolLines.get(call.id);
    if (!line) return;
    const name = call.function.name;
    const out = line.querySelector('.agent-tool-result');
    line.classList.remove('running');
    if (result && result.error) {
      line.classList.add('failed');
      out.textContent = clip(String(result.error), 80);
      out.title = String(result.error);
      return;
    }
    if (name === 'find_by_text' || name === 'query_elements') out.textContent = `找到 ${result.count} 个`;
    else if (name === 'get_page_overview') out.textContent = clip(result.title || hostOf(result.url || ''), 40);
    else if (name === 'update_rule') {
      const before = undoSnapshots.get(call.id);
      const after = Editor.getDraft();
      const parts = [];
      if (typeof args.css === 'string') parts.push('CSS ' + lineDiff(before.css, args.css));
      if (typeof args.js === 'string') parts.push('JS ' + lineDiff(before.js, args.js));
      if (args.run_at && args.run_at !== before.runAt) parts.push('运行时机');
      if (args.world && args.world !== before.world) parts.push('运行环境');
      out.textContent = parts.join(' · ');
      line.classList.add('change');
      if (after) {
        const undo = el('button', 'btn ghost small', '撤销');
        undo.title = '恢复到这次修改之前的代码';
        undo.addEventListener('click', () => {
          const draft = Editor.getDraft();
          if (!draft || draft.id !== before.id) return;
          Editor.applyChanges(before);
          undo.replaceWith(el('span', 'agent-tool-undone', '已撤销'));
          sendPreview();
        });
        line.append(undo);
      }
    }
  }

  // ---------- 工具执行 ----------

  function pageContext() {
    const draft = Editor.getDraft();
    const tab = target();
    const lines = ['', '## 当前规则（编辑区里的最新内容，可能尚未保存）'];
    if (draft) {
      lines.push(
        `名称：${draft.name.trim() || '（未命名）'}`,
        `适用网站：${draft.sites.length ? draft.sites.join('，') : '（未填写）'}`,
        `JS 运行时机：${draft.runAt}；运行环境：${draft.world}`,
        'CSS：',
        draft.css.trim() ? '```css\n' + draft.css + '\n```' : '（空）',
        'JS：',
        draft.js.trim() ? '```js\n' + draft.js + '\n```' : '（空）',
      );
    }
    lines.push('', '## 参考页面');
    lines.push(tab ? `标题：${tab.title || ''}\n网址：${tab.url}` : '（没有参考页面，读取页面的工具不可用）');
    return Agent.SYSTEM_PROMPT + '\n' + lines.join('\n');
  }

  async function inspect(method, params) {
    const tab = target();
    if (!tab) throw new Error('没有参考页面，请用户先在浏览器里打开要定制的网页');
    try {
      return await self.SiteTweakerTools.inspect(tab.id, method, params);
    } catch (err) {
      throw new Error('无法读取参考页面：' + ((err && err.message) || err));
    }
  }

  function addUserBubble(text, label) {
    const user = el('div', 'agent-msg user');
    if (label) {
      user.append(el('div', 'agent-msg-label', label));
      user.append(el('div', 'md-text agent-msg-sub', text));
    } else {
      user.append(el('div', 'md-text', text));
    }
    return addToLog(user);
  }

  /** ask_user：显示问题和选项，等用户点选或在输入框里输入其他回答 */
  function askUser(args, signal) {
    const question = String(args.question || '').trim();
    const options = (Array.isArray(args.options) ? args.options : [])
      .map((o) => String(o).trim())
      .filter(Boolean)
      .slice(0, 8);
    if (!question) return { error: '请提供要问的问题' };
    const multiple = !!args.multiple && options.length > 1;

    return new Promise((resolve, reject) => {
      const card = el('div', 'agent-ask');
      const list = el('div', 'agent-ask-options');
      const chosen = new Set();
      const buttons = options.map((option) => {
        const btn = el('button', 'agent-ask-option', option);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          if (!multiple) return done(option, [option]);
          if (chosen.has(option)) chosen.delete(option);
          else chosen.add(option);
          btn.classList.toggle('selected', chosen.has(option));
          confirmBtn.disabled = !chosen.size;
        });
        return btn;
      });
      list.append(...buttons);
      const confirmBtn = el('button', 'btn small primary', '确定');
      confirmBtn.type = 'button';
      confirmBtn.disabled = true;
      confirmBtn.addEventListener('click', () => {
        const picked = options.filter((o) => chosen.has(o));
        done(picked.join('、'), picked);
      });
      const foot = el('div', 'agent-ask-foot');
      foot.append(el('span', 'muted', options.length ? '也可以在下方输入其他回答' : '请在下方输入回答'));
      if (multiple) foot.append(el('span', 'spacer'), confirmBtn);
      card.append(el('div', 'agent-ask-question', question), list, foot);
      addToLog(card);

      const onAbort = () => {
        close();
        reject(new DOMException('已停止', 'AbortError'));
      };
      function close() {
        signal.removeEventListener('abort', onAbort);
        pendingAsk = null;
        card.classList.add('answered');
        for (const b of [...buttons, confirmBtn]) b.disabled = true;
        foot.remove();
        setRunning(true);
      }
      function done(answer, picked) {
        close();
        for (const b of buttons) b.classList.toggle('selected', picked.includes(b.textContent));
        addUserBubble(answer);
        resolve(picked.length ? { answer, chosen: picked } : { answer, note: '用户没有选择选项，而是自己输入了回答' });
      }

      signal.addEventListener('abort', onAbort, { once: true });
      pendingAsk = { answer: (text) => done(text, []) };
      setRunning(true);
      els.input.focus();
    });
  }

  async function execute(name, args, call) {
    switch (name) {
      case 'ask_user':
        return askUser(args, controller.signal);
      case 'get_page_overview':
        return inspect('overview', []);
      case 'find_by_text':
        return inspect('findText', [String(args.text || ''), args.limit]);
      case 'query_elements':
        return inspect('query', [String(args.selector || ''), { limit: args.limit, styles: args.styles }]);
      case 'get_element_html':
        return inspect('html', [String(args.selector || ''), args.max_chars]);
      case 'update_rule': {
        const draft = Editor.getDraft();
        if (!draft) return { error: '当前没有打开的规则' };
        const patch = {};
        if (typeof args.css === 'string') patch.css = args.css;
        if (typeof args.js === 'string') patch.js = args.js;
        if (ST.RUN_AT.includes(args.run_at)) patch.runAt = args.run_at;
        if (ST.WORLDS.includes(args.world)) patch.world = args.world;
        if (!Object.keys(patch).length) return { error: '请至少提供 css、js、run_at、world 中的一项' };
        undoSnapshots.set(call.id, { id: draft.id, css: draft.css, js: draft.js, runAt: draft.runAt, world: draft.world });
        Editor.applyChanges(patch);
        sendPreview();
        const notes = [];
        if ('css' in patch) notes.push(port ? 'CSS 已在参考页面上实时预览，可以用 query_elements 验证效果' : 'CSS 已写入（参考页面暂时无法预览）');
        if ('js' in patch || 'runAt' in patch || 'world' in patch) notes.push('JS 已写入，用户保存规则并刷新页面后才会运行');
        notes.push('规则尚未保存，用户确认后会自行保存');
        return { ok: true, note: notes.join('；') };
      }
      default:
        return { error: '未知的工具：' + name };
    }
  }

  // ---------- 发送与停止 ----------

  const PLACEHOLDER = els.input.placeholder;

  /** 运行中只显示「停止」；AI 在等用户回答问题时，输入框和「回答」按钮可用 */
  function setRunning(on) {
    const asking = on && !!pendingAsk;
    els.send.hidden = on && !asking;
    els.send.textContent = asking ? '回答' : '发送';
    els.stop.hidden = !on;
    els.input.placeholder = asking ? '输入其他回答…' : PLACEHOLDER;
    els.panel.classList.toggle('running', on);
    els.panel.classList.toggle('asking', asking);
  }

  function stopRun() {
    if (controller) controller.abort();
  }

  /** label：从常用任务发起时，对话里显示的任务名 */
  async function send(text, label) {
    if (controller) return;
    if (!Agent.isConfigured(config)) return openConfig();
    const draft = Editor.getDraft();
    if (!draft) return;
    const tab = target();
    if (!tab) {
      Editor.toast('先在浏览器里打开要定制的网页，作为参考页面', true);
      return;
    }
    if (!draft.sites.length) {
      const site = ST.siteFromUrl(tab.url);
      if (site) {
        Editor.applyChanges({ sites: [site] });
        renderTargetNote();
      }
    }

    if (!label) els.input.value = '';
    addUserBubble(text, label);
    history.push({ role: 'user', content: text });

    // 换了规则或开了新对话后，这次运行的输出不再写进对话
    const ownConversation = conversation;
    const isCurrent = () => conversation === ownConversation;
    const ctrl = (controller = new AbortController());
    setRunning(true);
    startStatus();
    let streamed = '';
    let retryNote = null; // 同一次请求的多次重试共用一条提示
    let retries = 0;

    try {
      await Agent.run({
        config,
        history,
        system: pageContext,
        tools: Agent.TOOLS,
        execute,
        signal: ctrl.signal,
        onEvent(event) {
          if (!isCurrent()) return;
          if (retryNote && event.type !== 'retry') {
            // 重试成功：提示收成一行
            retryNote.className = 'agent-note';
            retryNote.textContent = `接口出错，自动重试 ${retries} 次后已恢复`;
            retryNote = null;
          }
          if (event.type === 'text') {
            if (!bubble) {
              bubble = addToLog(el('div', 'agent-msg assistant'));
              streamed = '';
            }
            streamed += event.text;
            bubble.textContent = streamed;
            setPhase('正在回复…');
            scrollLog();
          } else if (event.type === 'reasoning') {
            setPhase('正在深度思考…');
          } else if (event.type === 'toolProgress') {
            const last = event.calls[event.calls.length - 1];
            setPhase(last ? toolPhase(last.name, last.chars) : '正在思考…');
          } else if (event.type === 'assistant') {
            const content = String(event.message.content || '').trim();
            if (content) {
              if (!bubble) bubble = addToLog(el('div', 'agent-msg assistant'));
              bubble.replaceChildren(renderMarkdown(content));
            } else if (bubble) {
              bubble.remove();
            }
            bubble = null;
          } else if (event.type === 'retry') {
            // 重试时丢掉已显示的半截回复，重试成功后会重新输出
            if (bubble) bubble.remove();
            bubble = null;
            streamed = '';
            const seconds = Math.max(1, Math.round(event.delay / 1000));
            const text = `接口请求失败：${clip(event.error, 100)}\n${seconds} 秒后自动重试（${event.attempt}/${event.max}）`;
            retries = event.attempt;
            if (retryNote) {
              retryNote.textContent = text;
              addToLog(retryNote);
            } else {
              retryNote = addNote(text, 'retry');
            }
            setPhase(`等待重试（${event.attempt}/${event.max}）…`);
          } else if (event.type === 'tool') {
            const name = event.call.function.name;
            if (name === 'ask_user') {
              setPhase('等待你的回答', true);
            } else {
              addToolLine(event.call, event.args);
              setPhase(name === 'update_rule' ? '正在写入规则代码…' : toolPhase(name));
            }
          } else if (event.type === 'toolResult') {
            finishToolLine(event.call, event.args, event.result);
            setPhase('正在思考…');
            scrollLog();
          }
        },
      });
    } catch (err) {
      // 最终的错误信息里已经写明重试次数
      if (retryNote) retryNote.remove();
      if (isCurrent()) {
        if (ctrl.signal.aborted) addNote('已停止');
        else addNote(String((err && err.message) || err), 'error');
      }
    } finally {
      stopStatus();
      if (bubble && isCurrent()) bubble.textContent = streamed;
      bubble = null;
      if (controller === ctrl) controller = null;
      setRunning(false);
      renderPending();
    }
  }

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text) return;
    if (pendingAsk) {
      els.input.value = '';
      pendingAsk.answer(text);
    } else {
      send(text);
    }
  });
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });
  els.stop.addEventListener('click', stopRun);

  function resetConversation() {
    conversation++;
    stopRun();
    history = [];
    toolLines.clear();
    undoSnapshots.clear();
    bubble = null;
    renderIntro();
  }
  $('agentReset').addEventListener('click', resetConversation);

  // ---------- 保存 ----------

  function renderPending() {
    els.pending.hidden = !isOpen() || !Editor.isUnsaved();
  }

  $('agentSave').addEventListener('click', () => Editor.save());
  $('agentSaveReload').addEventListener('click', async () => {
    const tab = target();
    if (!(await Editor.save())) return;
    if (tab) {
      chrome.tabs.reload(tab.id).catch(() => {});
      Editor.toast('已保存，正在刷新参考页面');
    }
  });

  // ---------- 与编辑区联动 ----------

  Editor.onDraft((kind, id) => {
    if (kind === 'open' && id !== ruleId) {
      ruleId = id;
      resetConversation();
      if (!id) setOpen(false);
      else if (isOpen()) {
        // 断开后重新连接，参考页面上上一条规则的预览随之撤掉
        disconnectPreview();
        refreshTabs();
      } else if (restoreOpen) setOpen(true);
      restoreOpen = false;
    }
    if (kind === 'edit') {
      sendPreview();
      renderTargetNote();
    }
    renderPending();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.agent) {
      config = Agent.normalizeConfig(changes.agent.newValue);
      renderConfigState();
    }
  });

  // ---------- 启动 ----------

  // 管理页可能已经打开了某条规则（取决于加载顺序），否则等 onDraft 通知
  renderQuickTasks();
  const initial = Editor.getDraft();
  if (initial) {
    ruleId = initial.id;
    if (restoreOpen) setOpen(true);
    restoreOpen = false;
  }
  loadConfig();
})();
