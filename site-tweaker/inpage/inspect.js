/*
 * 页面检查：供管理页的 AI 助手读取网页结构、查询元素、按文字定位。
 * 只读取，不修改页面；返回值都是可序列化的普通对象，并控制长度。
 */
(function (root) {
  'use strict';
  const version = chrome.runtime.getManifest().version;
  if (root.SiteTweakerInspect && root.SiteTweakerInspect.version === version) return;

  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'head', 'base', 'title']);
  const OUTLINE_LIMIT = 14000;
  const MAX_DEPTH = 18;
  const DEFAULT_STYLES = [
    'display', 'position', 'width', 'height', 'margin', 'padding',
    'color', 'background-color', 'font-size', 'z-index',
  ];

  // 扩展自己的浮层（快捷消除、代码小窗）都以 site-tweaker- 开头
  const isToolHost = (el) => el.localName.startsWith('site-tweaker-');
  const clip = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
  const squash = (text) => String(text || '').replace(/\s+/g, ' ').trim();

  function selectorFor(el) {
    if (root.SiteTweakerPicker) return root.SiteTweakerPicker.selectorFor(el);
    return el.id ? '#' + CSS.escape(el.id) : el.localName;
  }

  function describe(el) {
    let text = el.localName;
    if (el.id) text += '#' + clip(el.id, 40);
    for (const c of [...el.classList].slice(0, 4)) text += '.' + clip(c, 40);
    return text;
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  }

  function isVisible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return false;
    if (cs.display === 'contents') return true;
    if (cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  /** 元素自身（不含子元素）的文字 */
  function ownText(el) {
    let text = '';
    for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.data;
    return squash(text);
  }

  function children(el) {
    return [...el.children].filter((c) => !SKIP.has(c.localName) && !isToolHost(c));
  }

  const signature = (el) => el.localName + [...el.classList].filter((c) => !/\d{3,}/.test(c)).map((c) => '.' + c).join('');

  // ---------- 页面概览 ----------

  function attrHints(el) {
    const hints = [];
    for (const name of ['role', 'aria-label', 'title', 'type', 'name', 'placeholder', 'alt', 'data-testid']) {
      const v = el.getAttribute(name);
      if (v) hints.push(`${name}="${clip(squash(v), 40)}"`);
    }
    if (el.localName === 'a' && el.getAttribute('href')) hints.push(`href="${clip(el.getAttribute('href'), 60)}"`);
    if ((el.localName === 'img' || el.localName === 'iframe') && el.getAttribute('src')) {
      hints.push(`src="${clip(el.getAttribute('src'), 60)}"`);
    }
    return hints;
  }

  function overview() {
    const lines = [];
    let size = 0;
    let truncated = false;

    function push(line) {
      if (truncated) return;
      if (size + line.length > OUTLINE_LIMIT) {
        truncated = true;
        lines.push('…（结构太长，已截断。可以用 query_elements 或 find_by_text 查看具体区域）');
        return;
      }
      lines.push(line);
      size += line.length + 1;
    }

    function line(el, depth) {
      // 只有一个子元素、自身没有文字的包装层合并到一行：div.a > div.b > main
      const chain = [el];
      let last = el;
      while (chain.length < 5 && !ownText(last) && isVisible(last)) {
        const kids = children(last);
        if (kids.length !== 1) break;
        last = kids[0];
        chain.push(last);
      }
      const visible = isVisible(last);
      const cs = getComputedStyle(last);
      let text = '  '.repeat(depth) + chain.map(describe).join(' > ');
      const hints = attrHints(last);
      if (hints.length) text += ' [' + hints.join(' ') + ']';
      if (!visible) text += ' (隐藏)';
      else {
        const r = last.getBoundingClientRect();
        text += ` (${Math.round(r.width)}×${Math.round(r.height)}`;
        if (cs.position === 'fixed' || cs.position === 'sticky') text += ' ' + cs.position;
        text += ')';
      }
      const own = ownText(last);
      if (own) text += ` "${clip(own, 60)}"`;
      push(text);
      if (visible && depth < MAX_DEPTH && last.localName !== 'svg' && last.localName !== 'select') walk(last, depth + 1);
    }

    function walk(el, depth) {
      const kids = children(el);
      let i = 0;
      while (i < kids.length && !truncated) {
        // 连续多个结构相同的兄弟元素（列表项、卡片）只展示前两个
        const sig = signature(kids[i]);
        let j = i + 1;
        while (j < kids.length && signature(kids[j]) === sig) j++;
        const run = j - i;
        const shown = run > 3 ? 2 : run;
        for (let k = i; k < i + shown; k++) line(kids[k], depth);
        if (run > shown) push('  '.repeat(depth) + `…另有 ${run - shown} 个相同的 ${sig}`);
        i = j;
      }
    }

    if (document.body) walk(document.body, 0);
    return {
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      pageHeight: document.documentElement.scrollHeight,
      outline: lines.join('\n'),
      truncated,
    };
  }

  // ---------- 查询元素 ----------

  function queryAll(selector) {
    try {
      return { list: [...document.querySelectorAll(selector)].filter((el) => !isToolHost(el)) };
    } catch (err) {
      return { error: '选择器无效：' + ((err && err.message) || err) };
    }
  }

  function openingTag(el) {
    const html = el.outerHTML;
    const end = html.indexOf('>');
    return clip(end === -1 ? html : html.slice(0, end + 1), 300);
  }

  function query(selector, options) {
    const { limit = 10, styles } = options || {};
    const { list, error } = queryAll(selector);
    if (error) return { error };
    const props = Array.isArray(styles) && styles.length ? styles.slice(0, 30).map(String) : DEFAULT_STYLES;
    return {
      count: list.length,
      elements: list.slice(0, Math.min(Math.max(Number(limit) || 10, 1), 30)).map((el) => {
        const cs = getComputedStyle(el);
        return {
          selector: selectorFor(el),
          element: describe(el),
          tag: openingTag(el),
          visible: isVisible(el),
          rect: rectOf(el),
          children: el.childElementCount,
          text: clip(squash(el.innerText || el.textContent), 160),
          styles: Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])),
        };
      }),
    };
  }

  /** 去掉脚本、样式、SVG 内部和超长属性后的 outerHTML */
  function html(selector, maxChars) {
    const { list, error } = queryAll(selector);
    if (error) return { error };
    if (!list.length) return { error: '没有找到匹配的元素' };
    const max = Math.min(Math.max(Number(maxChars) || 6000, 500), 20000);
    const clone = list[0].cloneNode(true);
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
    const drop = [];
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      if (node.nodeType === Node.COMMENT_NODE || (node !== clone && (SKIP.has(node.localName) || isToolHost(node)))) {
        drop.push(node);
        continue;
      }
      if (node.localName === 'svg') node.replaceChildren();
      for (const attr of [...node.attributes]) {
        if (attr.value.length > 120) node.setAttribute(attr.name, attr.value.slice(0, 100) + '…');
      }
    }
    drop.forEach((node) => node.remove());
    const text = clone.outerHTML.replace(/>\s+</g, '> <');
    return {
      count: list.length,
      selector: selectorFor(list[0]),
      html: text.length > max ? text.slice(0, max) + `…（已截断，共 ${text.length} 字符）` : text,
    };
  }

  // ---------- 按文字查找 ----------

  function findText(text, limit) {
    const needle = squash(text).toLowerCase();
    if (!needle) return { error: '请提供要查找的文字' };
    const max = Math.min(Math.max(Number(limit) || 8, 1), 20);
    const found = [];
    const seen = new Set();
    const add = (el) => {
      if (!el || seen.has(el) || isToolHost(el)) return;
      seen.add(el);
      found.push(el);
    };
    const has = (el) => squash(el.textContent).toLowerCase().includes(needle);

    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        SKIP.has(node.parentElement && node.parentElement.localName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let node = walker.nextNode(); node && found.length < max; node = walker.nextNode()) {
      if (squash(node.data).toLowerCase().includes(needle)) add(node.parentElement);
    }
    // 文字被拆在多个节点里（取包含它的最内层元素），或者写在 aria-label / title / placeholder 里
    if (!found.length) {
      for (const el of document.querySelectorAll('body *')) {
        if (found.length >= max) break;
        if (SKIP.has(el.localName) || isToolHost(el)) continue;
        const label = ['aria-label', 'title', 'placeholder', 'alt'].map((a) => el.getAttribute(a) || '').join(' ');
        if (label.toLowerCase().includes(needle) || (has(el) && ![...el.children].some(has))) add(el);
      }
    }

    return {
      count: found.length,
      matches: found.map((el) => {
        const ancestors = [];
        for (let p = el.parentElement; p && p !== document.body && ancestors.length < 5; p = p.parentElement) {
          const r = p.getBoundingClientRect();
          ancestors.push({ selector: selectorFor(p), element: describe(p), size: `${Math.round(r.width)}×${Math.round(r.height)}` });
        }
        return {
          selector: selectorFor(el),
          element: describe(el),
          visible: isVisible(el),
          rect: rectOf(el),
          text: clip(squash(el.innerText || el.textContent), 160),
          ancestors,
        };
      }),
    };
  }

  root.SiteTweakerInspect = { version, overview, query, html, findText };
})(self);
