/*
 * 规则工具：网址匹配、规则规范化、用户脚本包装。
 * 后台、内容脚本、弹窗和管理页共用，挂在 self.SiteTweaker 上。
 */
(function (root) {
  'use strict';

  const RUN_AT = ['document_start', 'document_end', 'document_idle'];
  const WORLDS = ['MAIN', 'USER_SCRIPT'];
  const SCHEMES = ['http', 'https', 'file', 'ftp'];

  function uid() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 浏览器的 URL 解析会把域名里的空格等字符转义而不报错，所以单独校验
  const HOST_RE = /^(\[[0-9a-f:.]+\]|[a-z0-9_-]+(\.[a-z0-9_-]+)*\.?)$/i;

  function isLocalHost(hostname) {
    return !hostname.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith('[');
  }

  /**
   * 把用户写的一行“网站”转换为 Chrome 匹配模式。
   * 返回 null（空行/注释）或 { exclude, patterns, error? }。
   *   github.com            -> *://*.github.com/*   （含所有子域名）
   *   example.com/blog      -> *://*.example.com/blog*
   *   localhost:3000        -> http://localhost:3000/* 和 https://localhost:3000/*
   *                            （Chrome 不允许通配协议 *:// 带端口）
   *   https://a.com/x/*     -> 原样（标准匹配模式）
   *   !gist.github.com      -> 排除
   *   * 或 <all_urls>        -> 所有网站
   */
  function parseSiteLine(line) {
    let text = String(line || '').trim();
    if (!text || text.startsWith('#')) return null;

    let exclude = false;
    if (text.startsWith('!')) {
      exclude = true;
      text = text.slice(1).trim();
    }
    const fail = (error) => ({ exclude, patterns: [], error });
    if (!text) return fail('“!” 后面缺少网址');
    if (text === '*' || text === '<all_urls>') return { exclude, patterns: ['<all_urls>'] };

    let patterns;
    if (/^[a-z*]+:\/\//i.test(text)) {
      // 完整匹配模式；没写路径时补上 /*
      const pattern = /^[a-z*]+:\/\/[^/]*$/i.test(text) ? text + '/*' : text;
      if (/^\*:\/\/[^/]*:\d+\//.test(pattern)) return fail('协议写 * 时不能指定端口，请分别写 http:// 和 https://');
      patterns = [pattern];
    } else {
      let rest = text;
      let wildcard = false;
      if (rest.startsWith('*.')) {
        wildcard = true;
        rest = rest.slice(2);
      }
      const slash = rest.indexOf('/');
      const hostPart = slash === -1 ? rest : rest.slice(0, slash);
      let path = slash === -1 ? '/*' : rest.slice(slash);
      if (!path.endsWith('*')) path += '*';

      if (hostPart === '*') {
        patterns = [`*://*${path}`];
      } else {
        let url;
        try {
          url = new URL('http://' + hostPart);
        } catch {
          return fail('域名格式不正确');
        }
        if (!HOST_RE.test(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
          return fail('域名格式不正确');
        }
        const host = wildcard || !isLocalHost(url.hostname) ? '*.' + url.hostname : url.hostname;
        // new URL 会把 http 默认的 80 端口省掉，这里从原文取端口
        const port = /:(\d+)$/.exec(hostPart);
        patterns = port
          ? [`http://${host}:${port[1]}${path}`, `https://${host}:${port[1]}${path}`]
          : [`*://${host}${path}`];
      }
    }

    if (!patterns.every(parsePattern)) return fail('不是有效的匹配模式');
    return { exclude, patterns };
  }

  /** 把多行网站规则编译成 { matches, excludeMatches, errors } */
  function compileSites(sites) {
    const lines = Array.isArray(sites) ? sites : String(sites || '').split(/\r?\n/);
    const matches = [];
    const excludeMatches = [];
    const errors = [];
    lines.forEach((line, index) => {
      const result = parseSiteLine(line);
      if (!result) return;
      if (result.error) {
        errors.push({ line: index + 1, text: String(line).trim(), message: result.error });
        return;
      }
      const list = result.exclude ? excludeMatches : matches;
      for (const pattern of result.patterns) if (!list.includes(pattern)) list.push(pattern);
    });
    return { matches, excludeMatches, errors };
  }

  function escapeRegExp(text) {
    return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }

  /** 解析 Chrome 匹配模式，无效时返回 null */
  function parsePattern(pattern) {
    if (pattern === '<all_urls>') return { all: true };
    const m = /^(\*|[a-z]+):\/\/([^/]*)(\/.*)$/i.exec(pattern);
    if (!m) return null;
    const scheme = m[1].toLowerCase();
    if (scheme !== '*' && !SCHEMES.includes(scheme)) return null;
    const path = m[3];
    const pathRe = new RegExp('^' + path.split('*').map(escapeRegExp).join('.*') + '$');

    if (scheme === 'file') {
      return m[2] ? null : { scheme, host: '', port: null, pathRe };
    }
    const hp = /^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::(\*|\d{1,5}))?$/i.exec(m[2]);
    if (!hp || (scheme === '*' && hp[2] && hp[2] !== '*')) return null; // 与 Chrome 一致：*:// 不能带具体端口
    const host = hp[1].toLowerCase();
    if (host !== '*' && !HOST_RE.test(host.startsWith('*.') ? host.slice(2) : host)) return null;
    return { scheme, host, port: hp[2] || null, pathRe };
  }

  const DEFAULT_PORTS = { http: '80', https: '443', ftp: '21' };

  function patternMatches(p, url) {
    const scheme = url.protocol.slice(0, -1);
    if (p.all) return SCHEMES.includes(scheme);
    if (p.scheme === '*' ? scheme !== 'http' && scheme !== 'https' : p.scheme !== scheme) return false;
    if (scheme !== 'file') {
      const host = url.hostname.toLowerCase();
      if (p.host !== '*') {
        if (p.host.startsWith('*.')) {
          const base = p.host.slice(2);
          if (host !== base && !host.endsWith('.' + base)) return false;
        } else if (host !== p.host) {
          return false;
        }
      }
      if (p.port && p.port !== '*' && (url.port || DEFAULT_PORTS[scheme]) !== p.port) return false;
    }
    return p.pathRe.test(url.pathname + url.search);
  }

  const compiledCache = new Map();

  function compiledFor(rule) {
    const key = (rule.sites || []).join('\n');
    let compiled = compiledCache.get(key);
    if (!compiled) {
      const { matches, excludeMatches } = compileSites(rule.sites);
      compiled = {
        include: matches.map(parsePattern).filter(Boolean),
        exclude: excludeMatches.map(parsePattern).filter(Boolean),
      };
      if (compiledCache.size > 500) compiledCache.clear();
      compiledCache.set(key, compiled);
    }
    return compiled;
  }

  /** 规则的网站设置是否命中该网址（不考虑启用状态） */
  function ruleMatchesUrl(rule, href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return false;
    }
    const { include, exclude } = compiledFor(rule);
    return include.some((p) => patternMatches(p, url)) && !exclude.some((p) => patternMatches(p, url));
  }

  function normalizeRule(raw) {
    const r = raw || {};
    const sites = Array.isArray(r.sites) ? r.sites : String(r.sites || '').split(/\r?\n/);
    return {
      id: typeof r.id === 'string' && /^[A-Za-z0-9][\w-]{0,63}$/.test(r.id) ? r.id : uid(),
      name: String(r.name || '').trim() || '未命名规则',
      enabled: r.enabled !== false,
      sites: sites.map((s) => String(s).trim()).filter(Boolean),
      css: String(r.css || ''),
      js: String(r.js || ''),
      runAt: RUN_AT.includes(r.runAt) ? r.runAt : 'document_idle',
      world: WORLDS.includes(r.world) ? r.world : 'MAIN',
      allFrames: !!r.allFrames,
      updatedAt: Number(r.updatedAt) || Date.now(),
    };
  }

  /** 用 async 函数包住用户脚本：可以直接写 await，出错时在控制台标明是哪条规则 */
  function wrapUserJs(rule) {
    const name = rule.name || rule.id;
    const file = String(name).replace(/[\s\\/:*?"<>|#%&]+/g, '_').slice(0, 60) || rule.id;
    return (
      '(async () => { try {\n' +
      rule.js +
      '\n} catch (error) { console.error(' + JSON.stringify(`[网页定制] 规则「${name}」运行出错：`) + ', error); } })();\n' +
      '//# sourceURL=site-tweaker/' + file + '.js\n'
    );
  }

  /** 根据网址给出“为此网站新建规则”时的默认写法 */
  function siteFromUrl(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return '';
    }
    if (url.protocol === 'file:') return 'file:///*';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const host = url.hostname.replace(/^www\./, '');
    return host + (url.port ? ':' + url.port : '');
  }

  function canInject(href) {
    return /^(https?|file|ftp):/.test(href || '') && !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(href);
  }

  root.SiteTweaker = {
    RUN_AT,
    WORLDS,
    uid,
    parseSiteLine,
    compileSites,
    parsePattern,
    ruleMatchesUrl,
    normalizeRule,
    wrapUserJs,
    siteFromUrl,
    canInject,
  };
})(typeof self !== 'undefined' ? self : globalThis);
