/*
 * 代码小窗：在网页上浮出一个可拖动、可调大小的小窗，
 * 列出作用于当前页面的规则及其 CSS / JS，可以就地开关规则、复制代码、跳到管理页编辑。
 */
(function (root) {
  'use strict';
  const { version, h, mount, draggable, toaster } = root.SiteTweakerUI;
  const old = root.SiteTweakerViewer;
  if (old && old.version === version) return;
  if (old) {
    try {
      old.close();
    } catch {
      // 旧版本已失效
    }
  }
  const RUN_AT_LABEL = { document_start: '页面开始加载时', document_end: 'DOM 就绪时', document_idle: '页面加载完成后' };
  const WORLD_LABEL = { MAIN: '页面环境', USER_SCRIPT: '隔离环境' };

  const STYLES = `
    .panel {
      position: fixed; display: flex; flex-direction: column; width: 440px; height: 480px;
      min-width: 300px; min-height: 180px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px);
      border: 1px solid var(--border); border-radius: 12px; background: var(--bg); box-shadow: var(--shadow);
      overflow: hidden; resize: both; pointer-events: auto;
    }
    .head {
      display: flex; align-items: center; gap: 8px; padding: 9px 8px 9px 12px;
      border-bottom: 1px solid var(--border); cursor: move; user-select: none;
    }
    .logo {
      display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px;
      background: linear-gradient(135deg, #6b6bf2, #9b4fe8); color: #fff; font: 700 10px var(--mono);
    }
    .title { font-weight: 650; }
    .count {
      padding: 0 7px; border-radius: 999px; background: var(--accent-weak); color: var(--accent-text);
      font-size: 11px; font-weight: 600; line-height: 18px;
    }
    .spacer { flex: 1; }
    .close {
      width: 26px; height: 26px; border: none; border-radius: 6px; background: none;
      color: var(--muted); font-size: 14px; cursor: pointer;
    }
    .close:hover { background: var(--hover); color: var(--text); }
    .body { flex: 1; min-height: 0; overflow: auto; padding: 10px; }
    .notice {
      margin-bottom: 10px; padding: 7px 10px; border-radius: 8px;
      background: rgba(240, 180, 40, 0.14); color: var(--text); font-size: 12px;
    }
    .card { margin-bottom: 10px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    .card.off .name, .card.off .codes { opacity: 0.5; }
    .card-head { display: flex; align-items: center; gap: 7px; padding: 7px 8px 7px 10px; cursor: pointer; }
    .card-head:hover { background: var(--hover); }
    .chev { width: 10px; color: var(--muted); font-size: 10px; }
    .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .code-head {
      display: flex; align-items: center; gap: 8px; padding: 5px 8px 5px 10px;
      border-top: 1px solid var(--border); font-size: 11.5px; color: var(--muted);
    }
    pre {
      margin: 0; padding: 8px 10px; max-height: 240px; overflow: auto; border-top: 1px solid var(--border);
      background: var(--code-bg); color: var(--text); font: 12px/1.6 var(--mono); white-space: pre; tab-size: 2;
      user-select: text; cursor: text;
    }
    .empty { padding: 28px 12px; color: var(--muted); text-align: center; }
    .empty .actions { display: flex; justify-content: center; gap: 8px; margin-top: 12px; }
    .foot { padding: 6px 12px; border-top: 1px solid var(--border); color: var(--muted); font-size: 11.5px; }
    .toast { bottom: 24px; }
  `;

  function createViewer(onClose) {
    const { host, shadow } = mount('site-tweaker-viewer', STYLES);
    const count = h('span', { class: 'count' });
    const body = h('div', { class: 'body' });
    const head = h(
      'div',
      { class: 'head' },
      h('span', { class: 'logo', text: '</>' }),
      h('span', { class: 'title', text: '当前页面的定制' }),
      count,
      h('span', { class: 'spacer' }),
      h('button', { class: 'close', title: '关闭（Esc）', 'aria-label': '关闭', onclick: () => onClose() }, '✕'),
    );
    const toastEl = h('div', { class: 'toast' });
    const toast = toaster(toastEl);
    const panel = h(
      'div',
      { class: 'panel', role: 'dialog', 'aria-label': '当前页面的定制', tabindex: '-1' },
      head,
      body,
      h('div', { class: 'foot', text: 'CSS 改动即时生效 · JS 改动需刷新页面' }),
    );
    shadow.append(h('div', { class: 'st' }, panel, toastEl));
    draggable(head, panel);

    // 默认放在右下角；用 left/top 定位，拖右下角调大小时更直观
    const width = Math.min(440, innerWidth - 16);
    const height = Math.min(480, innerHeight - 16);
    Object.assign(panel.style, {
      width: width + 'px',
      height: height + 'px',
      left: Math.max(8, innerWidth - width - 16) + 'px',
      top: Math.max(8, innerHeight - height - 16) + 'px',
    });

    let rules = [];
    let enabled = true;
    const collapsed = new Set();

    function matchedRules() {
      return rules.filter((r) => root.SiteTweaker.ruleMatchesUrl(r, location.href));
    }

    async function save(mutate) {
      const { rules: stored = [] } = await chrome.storage.local.get('rules');
      const list = stored.map(root.SiteTweaker.normalizeRule);
      mutate(list);
      await chrome.storage.local.set({ rules: list });
    }

    function openOptions(query) {
      chrome.runtime.sendMessage({ type: 'openOptions', query }).catch(() => toast('扩展已更新，请刷新页面'));
    }

    async function copy(text) {
      try {
        await navigator.clipboard.writeText(text);
        toast('已复制');
      } catch {
        toast('复制失败，请手动选中代码复制');
      }
    }

    function codeBlock(kind, code, meta) {
      return [
        h(
          'div',
          { class: 'code-head' },
          h('span', { class: 'tag ' + kind.toLowerCase(), text: kind }),
          meta ? h('span', { text: meta }) : null,
          h('span', { class: 'spacer' }),
          h('button', { class: 'link', onclick: () => copy(code) }, '复制'),
        ),
        h('pre', { text: code.replace(/\s+$/, '') }),
      ];
    }

    function card(rule) {
      const isCollapsed = collapsed.has(rule.id);
      const toggle = h('input', { type: 'checkbox', class: 'switch', title: rule.enabled ? '点击停用' : '点击启用' });
      toggle.checked = rule.enabled;
      toggle.addEventListener('click', (e) => e.stopPropagation());
      toggle.addEventListener('change', () =>
        save((list) => {
          const target = list.find((r) => r.id === rule.id);
          if (target) target.enabled = toggle.checked;
        }).catch(() => toast('保存失败，请刷新页面后重试')),
      );

      const head = h(
        'div',
        {
          class: 'card-head',
          onclick: () => {
            if (collapsed.has(rule.id)) collapsed.delete(rule.id);
            else collapsed.add(rule.id);
            render();
          },
        },
        h('span', { class: 'chev', text: isCollapsed ? '▶' : '▼' }),
        h('span', { class: 'name', text: rule.name, title: rule.sites.join('\n') }),
        rule.css.trim() ? h('span', { class: 'tag css', text: 'CSS' }) : null,
        rule.js.trim() ? h('span', { class: 'tag js', text: 'JS' }) : null,
        h(
          'button',
          {
            class: 'link',
            onclick: (e) => {
              e.stopPropagation();
              openOptions('#rule=' + rule.id);
            },
          },
          '编辑',
        ),
        toggle,
      );

      const codes = [];
      if (!isCollapsed) {
        if (rule.css.trim()) codes.push(...codeBlock('CSS', rule.css));
        if (rule.js.trim()) codes.push(...codeBlock('JS', rule.js, `${RUN_AT_LABEL[rule.runAt]} · ${WORLD_LABEL[rule.world]}`));
        if (!codes.length) codes.push(h('div', { class: 'code-head', text: '这条规则还没有代码' }));
      }
      return h(
        'section',
        { class: 'card' + (rule.enabled && enabled ? '' : ' off'), 'data-rule': rule.id },
        head,
        h('div', { class: 'codes' }, codes),
      );
    }

    function render() {
      const matched = matchedRules();
      const active = enabled ? matched.filter((r) => r.enabled).length : 0;
      count.textContent = `${active}/${matched.length} 生效`;
      count.hidden = !matched.length;
      const scroll = body.scrollTop;
      if (!matched.length) {
        const site = root.SiteTweaker.siteFromUrl(location.href);
        body.replaceChildren(
          h(
            'div',
            { class: 'empty' },
            '还没有规则作用于此页面',
            h(
              'div',
              { class: 'actions' },
              h('button', { class: 'btn', onclick: () => root.SiteTweakerPicker && root.SiteTweakerPicker.start() }, '快捷消除'),
              h('button', { class: 'btn primary', onclick: () => openOptions('?new=' + encodeURIComponent(site)) }, '新建规则'),
            ),
          ),
        );
      } else {
        body.replaceChildren(
          enabled ? '' : h('div', { class: 'notice', text: '总开关已暂停，下面的规则目前都不生效。' }),
          ...matched.map(card),
        );
      }
      body.scrollTop = scroll;
    }

    async function load() {
      const data = await chrome.storage.local.get(['rules', 'settings']);
      rules = (data.rules || []).map(root.SiteTweaker.normalizeRule);
      enabled = !data.settings || data.settings.enabled !== false;
      render();
    }

    function onStorage(changes, area) {
      if (area !== 'local' || !(changes.rules || changes.settings)) return;
      load().catch(() => {});
    }

    function onKey(e) {
      if (e.key === 'Escape' && e.composedPath().includes(host)) {
        e.stopPropagation();
        onClose();
      }
    }

    chrome.storage.onChanged.addListener(onStorage);
    window.addEventListener('keydown', onKey, true);
    load().catch(() => toast('读取规则失败，请刷新页面'));
    panel.focus({ preventScroll: true });

    return {
      destroy() {
        try {
          chrome.storage.onChanged.removeListener(onStorage);
        } catch {
          // 扩展已重载
        }
        window.removeEventListener('keydown', onKey, true);
        host.remove();
      },
      /** 供测试读取状态（只在扩展的隔离环境里可见） */
      debug() {
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        };
        return {
          count: count.hidden ? '' : count.textContent,
          cards: [...body.querySelectorAll('.card')].map((c) => ({
            id: c.dataset.rule,
            name: c.querySelector('.name').textContent,
            off: c.classList.contains('off'),
            code: [...c.querySelectorAll('pre')].map((p) => p.textContent),
            switchAt: rect(c.querySelector('.switch')),
          })),
          empty: !!body.querySelector('.empty'),
        };
      },
    };
  }

  let viewer = null;

  root.SiteTweakerViewer = {
    version,
    open() {
      if (!viewer) viewer = createViewer(() => root.SiteTweakerViewer.close());
    },
    close() {
      if (viewer) viewer.destroy();
      viewer = null;
    },
    toggle() {
      if (viewer) this.close();
      else this.open();
    },
    get isOpen() {
      return !!viewer;
    },
    debug: () => (viewer ? viewer.debug() : null),
  };
})(self);
