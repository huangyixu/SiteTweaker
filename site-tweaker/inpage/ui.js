/*
 * 页面内浮层（快捷消除、代码小窗）共用：
 * 用 Shadow DOM 隔离网页样式，提供建元素的小工具和统一的配色。
 */
(function (root) {
  'use strict';
  // 同一版本只定义一次；扩展更新后页面里可能还留着旧版本，需要替换
  const VERSION = chrome.runtime.getManifest().version;
  if (root.SiteTweakerUI && root.SiteTweakerUI.version === VERSION) return;

  const BASE_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .st {
      --bg: #ffffff;
      --bg-2: #f2f3f6;
      --hover: #eceef2;
      --text: #1c2027;
      --muted: #687080;
      --border: #e2e5ea;
      --border-strong: #cfd4dc;
      --accent: #5b5bd6;
      --accent-hover: #4c4cc4;
      --accent-weak: #ececfd;
      --accent-text: #4343b8;
      --danger: #d13c3c;
      --code-bg: #f7f8fa;
      --shadow: 0 2px 6px rgba(16, 24, 40, 0.08), 0 16px 40px rgba(16, 24, 40, 0.18);
      --mono: "Cascadia Code", "JetBrains Mono", Consolas, "SFMono-Regular", Menlo, monospace;
      font: 13px/1.5 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--text);
      letter-spacing: normal;
      text-align: left;
      -webkit-font-smoothing: antialiased;
    }
    @media (prefers-color-scheme: dark) {
      .st {
        --bg: #1c1d22;
        --bg-2: #25272d;
        --hover: #2c2e35;
        --text: #e6e7ea;
        --muted: #9ba1ac;
        --border: #30323a;
        --border-strong: #41444d;
        --accent: #7b7bf0;
        --accent-hover: #8c8cf5;
        --accent-weak: #2a2a4a;
        --accent-text: #a9a9ff;
        --danger: #f06a6a;
        --code-bg: #16171b;
        --shadow: 0 2px 6px rgba(0, 0, 0, 0.35), 0 16px 40px rgba(0, 0, 0, 0.45);
      }
    }
    button { font: inherit; color: inherit; margin: 0; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      height: 28px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: 7px;
      background: var(--bg); cursor: pointer; white-space: nowrap; font-size: 12.5px;
    }
    .btn:hover { background: var(--hover); }
    .btn:disabled { opacity: 0.45; cursor: default; }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn.primary:hover { background: var(--accent-hover); }
    .link {
      padding: 2px 6px; border: none; border-radius: 5px; background: none;
      color: var(--accent-text); font-size: 12px; cursor: pointer;
    }
    .link:hover { background: var(--accent-weak); }
    kbd {
      display: inline-block; padding: 0 5px; border: 1px solid var(--border-strong); border-bottom-width: 2px;
      border-radius: 4px; background: var(--bg-2); font: 11px/16px var(--mono); color: var(--text);
    }
    .switch {
      appearance: none; position: relative; flex: none; width: 30px; height: 18px; margin: 0;
      border-radius: 999px; background: var(--border-strong); cursor: pointer; transition: background 0.15s;
    }
    .switch::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25); transition: transform 0.15s;
    }
    .switch:checked { background: var(--accent); }
    .switch:checked::after { transform: translateX(12px); }
    .tag { display: inline-block; padding: 0 5px; border-radius: 4px; font: 600 10px/16px var(--mono); }
    .tag.css { background: #e3effd; color: #1f5fae; }
    .tag.js { background: #fdf3d6; color: #8a6100; }
    @media (prefers-color-scheme: dark) {
      .tag.css { background: #1d3149; color: #8cc0ff; }
      .tag.js { background: #3a3017; color: #f2cf73; }
    }
    .toast {
      position: fixed; left: 50%; bottom: 84px; max-width: min(560px, 90vw); padding: 7px 14px;
      border-radius: 8px; background: #23252b; color: #fff; font-size: 12.5px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); pointer-events: none;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      opacity: 0; transform: translate(-50%, 6px); transition: opacity 0.18s, transform 0.18s;
    }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
  `;

  /** h('div', { class, text, onclick, ... }, ...children) */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child != null && child !== false) el.append(child);
    }
    return el;
  }

  /** 在页面上挂一个与网页样式隔离的浮层，返回 { host, shadow } */
  function mount(tag, css) {
    const host = document.createElement(tag);
    host.setAttribute(
      'style',
      'all: initial !important; display: block !important; position: fixed !important; top: 0 !important; ' +
        'left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important;',
    );
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.append(h('style', { text: BASE_CSS + css }));
    // 挂在 <html> 上而不是 <body>：用户规则把 body 里的东西隐藏掉也不影响工具本身
    document.documentElement.append(host);
    return { host, shadow };
  }

  /** 用指针捕获实现拖动，拖动期间的事件都落在浮层内部，不会被页面或选取逻辑拦截 */
  function draggable(handle, target) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, input')) return;
      e.preventDefault();
      const rect = target.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const x = Math.min(Math.max(ev.clientX - dx, 0), innerWidth - 40);
        const y = Math.min(Math.max(ev.clientY - dy, 0), innerHeight - 30);
        Object.assign(target.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto', transform: 'none' });
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  function toaster(el) {
    let timer = 0;
    return (message) => {
      el.textContent = message;
      el.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('show'), 2400);
    };
  }

  root.SiteTweakerUI = { version: VERSION, h, mount, draggable, toaster };
})(self);
