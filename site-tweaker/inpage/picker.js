/*
 * 快捷消除：鼠标指到哪个元素就高亮哪个；Tab 切到外层，Shift+Tab 回到内层；
 * 单击后把「选择器 { display: none !important; }」写进本网站专用的「快捷消除」规则。
 */
(function (root) {
  'use strict';
  const { version, h, mount, draggable, toaster } = root.SiteTweakerUI;
  const old = root.SiteTweakerPicker;
  if (old && old.version === version) return;
  if (old) {
    try {
      old.stop();
    } catch {
      // 旧版本已失效
    }
  }
  const HEADER = '/* 用「快捷消除」隐藏的元素，不需要的行直接删掉即可 */\n';

  const STYLES = `
    .box {
      position: fixed; top: 0; left: 0; pointer-events: none; border-radius: 3px;
      border: 2px solid #5b5bd6; background: rgba(91, 91, 214, 0.14);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.75), 0 0 0 200vmax rgba(10, 12, 20, 0.16);
      transition: transform 60ms ease-out, width 60ms ease-out, height 60ms ease-out;
    }
    .label {
      position: fixed; top: 0; left: 0; pointer-events: none; max-width: 80vw; padding: 3px 8px;
      border-radius: 6px; background: #1f2026; color: #fff; font: 12px/18px var(--mono);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .label .dim { color: #a5a9b4; }
    .bar {
      position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px;
      width: max-content; max-width: calc(100vw - 24px);
      padding: 8px 8px 8px 14px; border: 1px solid var(--border); border-radius: 12px;
      background: var(--bg); box-shadow: var(--shadow); pointer-events: auto; user-select: none;
    }
    .grip { display: flex; align-items: center; gap: 12px; cursor: move; }
    .title { display: flex; align-items: center; gap: 7px; font-weight: 650; white-space: nowrap; }
    .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1.6s infinite; }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(91, 91, 214, 0.55); }
      70%, 100% { box-shadow: 0 0 0 7px rgba(91, 91, 214, 0); }
    }
    .hint { color: var(--muted); font-size: 12px; white-space: nowrap; }
    .count { color: var(--accent-text); font-size: 12px; font-weight: 600; white-space: nowrap; }
    .actions { display: flex; gap: 6px; }
  `;

  // ---------- 生成选择器 ----------

  const STATE_CLASS = /^(is-|has-)?(hover|hovered|active|focus|focused|selected|open|opened|show|shown|visible|current|expanded|collapsed)$/i;

  /** 类名/ID 看起来稳定（不是构建工具生成的随机串、不是状态类），刷新后大概率还在 */
  function isStable(token) {
    if (!token || token.length > 48 || /^[\d:-]/.test(token) || /\d{4,}/.test(token)) return false;
    if (/^(css|sc|jsx|emotion|styled|svelte)-/i.test(token) || STATE_CLASS.test(token)) return false;
    return !token.split(/[-_]+/).some((part) => part.length >= 5 && /\d.*\d/.test(part) && /[a-z]/i.test(part));
  }

  function segment(el, withIndex) {
    const classes = [...el.classList].filter(isStable).slice(0, 3);
    let text = CSS.escape(el.localName) + classes.map((c) => '.' + CSS.escape(c)).join('');
    if (withIndex && el.parentElement) {
      const same = [...el.parentElement.children].filter((c) => c.localName === el.localName);
      if (same.length > 1) text += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return text;
  }

  function selectsOnly(parts, el) {
    try {
      const found = document.querySelectorAll(parts.join(' > '));
      return found.length === 1 && found[0] === el;
    } catch {
      return false;
    }
  }

  /** 从目标元素往外逐级加限定，直到能唯一选中它；优先用稳定的 ID 和类名，最后才用序号 */
  function selectorFor(el) {
    const parts = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      if (node.id && isStable(node.id)) {
        parts.unshift('#' + CSS.escape(node.id));
        if (selectsOnly(parts, el)) return parts.join(' > ');
        parts[0] = segment(node, true);
      } else {
        parts.unshift(segment(node, false));
        if (selectsOnly(parts, el)) return parts.join(' > ');
        parts[0] = segment(node, true);
      }
      if (selectsOnly(parts, el)) return parts.join(' > ');
    }
    return parts.join(' > ');
  }

  function describe(el) {
    let text = el.localName;
    if (el.id) text += '#' + el.id;
    const classes = [...el.classList].slice(0, 2);
    if (classes.length) text += '.' + classes.join('.');
    return text.length > 60 ? text.slice(0, 57) + '…' : text;
  }

  // ---------- 写入规则 ----------

  function zapSite(href) {
    const url = new URL(href);
    return url.protocol === 'file:' ? 'file://' + url.pathname : root.SiteTweaker.siteFromUrl(href);
  }

  /** 每个网站一条固定 id 的「快捷消除」规则 */
  function zapRuleId(site) {
    let hash = 5381;
    for (const ch of site) hash = (Math.imul(hash, 33) + ch.codePointAt(0)) >>> 0;
    return 'zap-' + hash.toString(36);
  }

  let queue = Promise.resolve();

  /** 串行地读-改-写规则，连续快速点击也不会丢失修改 */
  function editZapRule(mutate, create) {
    const task = queue.then(async () => {
      const ST = root.SiteTweaker;
      const site = zapSite(location.href);
      if (!site) throw new Error('此页面不支持');
      const id = zapRuleId(site);
      const { rules = [], settings = {} } = await chrome.storage.local.get(['rules', 'settings']);
      const list = rules.map(ST.normalizeRule);
      let rule = list.find((r) => r.id === id);
      if (!rule) {
        if (!create) return { paused: false };
        rule = ST.normalizeRule({ id, name: `快捷消除 · ${site}`, sites: [site], css: HEADER });
        list.unshift(rule);
      }
      mutate(rule);
      rule.updatedAt = Date.now();
      await chrome.storage.local.set({ rules: list });
      return { paused: settings.enabled === false };
    });
    queue = task.catch(() => {});
    return task;
  }

  // ---------- 选取界面 ----------

  function createPicker(onExit) {
    const { host, shadow } = mount('site-tweaker-picker', STYLES);
    const box = h('div', { class: 'box', hidden: true });
    const label = h('div', { class: 'label', hidden: true });
    const count = h('span', { class: 'count', hidden: true });
    const undoBtn = h('button', { class: 'btn', title: 'Ctrl+Z', disabled: true, onclick: () => undo() }, '撤销');
    const toastEl = h('div', { class: 'toast' });
    const toast = toaster(toastEl);
    const grip = h(
      'div',
      { class: 'grip', title: '按住可拖动' },
      h('span', { class: 'title' }, h('span', { class: 'pulse' }), '快捷消除'),
      h(
        'span',
        { class: 'hint' },
        '指向元素 · ', h('kbd', { text: 'Tab' }), ' 外层 · ', h('kbd', { text: 'Shift' }), '+', h('kbd', { text: 'Tab' }),
        ' 内层 · 单击隐藏 · ', h('kbd', { text: 'Esc' }), ' 退出',
      ),
    );
    const bar = h(
      'div',
      { class: 'bar' },
      grip,
      count,
      h(
        'div',
        { class: 'actions' },
        undoBtn,
        h('button', { class: 'btn', onclick: () => root.SiteTweakerViewer && root.SiteTweakerViewer.open() }, '代码小窗'),
        h('button', { class: 'btn primary', onclick: () => onExit() }, '完成'),
      ),
    );
    shadow.append(h('div', { class: 'st' }, box, label, bar, toastEl));
    draggable(grip, bar);

    let hoverBase = null; // 鼠标正下方的元素
    let current = null; // 当前高亮的元素（hoverBase 或它的某一层祖先）
    let inner = []; // 往外切换时走过的内层元素，Shift+Tab 依次退回
    let lastLabel = '';
    let pointer = null;
    const zapped = [];

    // 扩展自己的浮层（工具条、代码小窗）都以 site-tweaker- 开头
    const isToolHost = (el) => !!el && el.localName.startsWith('site-tweaker-');
    const selectable = (el) => !!el && el !== document.documentElement && el !== document.body && !isToolHost(el);

    function pickAt(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el || isToolHost(el) || el === hoverBase) return; // 指在工具条或小窗上时保持原来的高亮
      hoverBase = el;
      inner = [];
      current = selectable(el) ? el : null;
    }

    function goOuter() {
      if (!current) return;
      const parent = current.parentElement;
      if (!selectable(parent)) return toast('已经是最外层了');
      inner.push(current);
      current = parent;
    }

    function goInner() {
      if (inner.length) current = inner.pop();
    }

    function draw() {
      raf = requestAnimationFrame(draw);
      const rect = current && current.isConnected ? current.getBoundingClientRect() : null;
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        box.hidden = label.hidden = true;
        return;
      }
      box.hidden = label.hidden = false;
      box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
      box.style.width = rect.width + 'px';
      box.style.height = rect.height + 'px';

      const text = `${describe(current)}|${Math.round(rect.width)}×${Math.round(rect.height)}|${inner.length}`;
      if (text !== lastLabel) {
        lastLabel = text;
        label.replaceChildren(
          describe(current),
          h('span', { class: 'dim', text: `  ${Math.round(rect.width)}×${Math.round(rect.height)}` }),
          inner.length ? h('span', { class: 'dim', text: `  · 外层 +${inner.length}` }) : '',
        );
      }
      const top = rect.top >= 28 ? rect.top - 26 : Math.min(rect.bottom + 4, innerHeight - 26);
      const left = Math.min(Math.max(rect.left, 4), Math.max(4, innerWidth - label.offsetWidth - 4));
      label.style.transform = `translate(${left}px, ${Math.max(top, 4)}px)`;
    }
    let raf = requestAnimationFrame(draw);

    function renderCount() {
      count.hidden = !zapped.length;
      count.textContent = `已隐藏 ${zapped.length} 个`;
      undoBtn.disabled = !zapped.length;
    }

    async function zap(el) {
      const selector = selectorFor(el);
      const line = `${selector} { display: none !important; }`;
      try {
        const { paused } = await editZapRule((rule) => {
          if (!rule.css.includes(line)) {
            const base = rule.css.trimEnd();
            rule.css = (base ? base + '\n' : '') + line + '\n';
          }
          rule.enabled = true;
        }, true);
        zapped.push(line);
        renderCount();
        toast(paused ? '已保存，但总开关已暂停，规则暂不生效' : '已隐藏：' + selector);
      } catch (err) {
        toast('保存失败：' + ((err && err.message) || err));
        return;
      }
      hoverBase = current = null;
      inner = [];
      // 元素消失后，重新选中鼠标下面的新元素
      if (pointer) setTimeout(() => pointer && pickAt(pointer.x, pointer.y), 60);
    }

    async function undo() {
      const line = zapped.pop();
      if (!line) return;
      renderCount();
      try {
        await editZapRule((rule) => {
          const index = rule.css.lastIndexOf(line);
          if (index !== -1) rule.css = rule.css.slice(0, index) + rule.css.slice(index + line.length).replace(/^\n/, '');
        }, false);
        toast('已撤销');
      } catch (err) {
        toast('撤销失败：' + ((err && err.message) || err));
      }
    }

    // ---------- 事件 ----------

    const fromUi = (e) => e.composedPath().some((node) => node instanceof Element && isToolHost(node));

    function onMove(e) {
      pointer = { x: e.clientX, y: e.clientY };
      if (!fromUi(e)) pickAt(e.clientX, e.clientY);
    }

    /** 拦下网页上的点击，避免触发链接、按钮或菜单；单击即隐藏当前元素 */
    function onPointer(e) {
      if (fromUi(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'click' && e.button === 0 && current) zap(current);
    }

    function onKey(e) {
      if (e.isComposing) return;
      if (e.key === 'Escape') onExit();
      else if (e.key === 'Tab') (e.shiftKey ? goInner : goOuter)();
      else if (e.key === 'Enter' && !fromUi(e)) current && zap(current);
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') undo();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    const BLOCKED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick'];
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('keydown', onKey, true);
    for (const type of BLOCKED) window.addEventListener(type, onPointer, true);
    window.focus();

    return {
      destroy() {
        cancelAnimationFrame(raf);
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('keydown', onKey, true);
        for (const type of BLOCKED) window.removeEventListener(type, onPointer, true);
        host.remove();
      },
      /** 供测试读取状态（只在扩展的隔离环境里可见） */
      debug: () => ({
        current: current ? describe(current) : null,
        depth: inner.length,
        boxVisible: !box.hidden,
        zapped: zapped.slice(),
      }),
    };
  }

  let picker = null;

  root.SiteTweakerPicker = {
    version,
    selectorFor,
    start() {
      if (!picker) picker = createPicker(() => root.SiteTweakerPicker.stop());
    },
    stop() {
      if (picker) picker.destroy();
      picker = null;
    },
    get active() {
      return !!picker;
    },
    debug: () => (picker ? picker.debug() : null),
  };
})(self);
