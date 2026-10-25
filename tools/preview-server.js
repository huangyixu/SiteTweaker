// 界面预览服务器：在普通网页里用模拟的 chrome API 打开管理页和弹窗。
// node tools/preview-server.js  然后访问 http://localhost:5178/options/options.html
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'site-tweaker');
const PORT = Number(process.env.PORT) || 5178;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

const MOCK = `
(() => {
  const KEY = '__mockStorage';
  const load = () => JSON.parse(localStorage.getItem(KEY) || 'null');
  if (!load()) {
    localStorage.setItem(KEY, JSON.stringify({
      settings: { enabled: true },
      rules: [
        { id: 'rdemo1', name: '示例：example.com 暗色主题', enabled: true, sites: ['example.com'], css: 'body {\\n  background: #17181c !important;\\n  color: #d8dae0 !important;\\n}\\n', js: "// 示例脚本\\nconst tip = document.createElement('p');\\ndocument.querySelector('h1')?.after(tip);\\n", runAt: 'document_idle', world: 'MAIN', allFrames: false, updatedAt: Date.now() - 3600e3 },
        { id: 'rdemo2', name: '知乎宽屏阅读', enabled: true, sites: ['zhihu.com', '!zhuanlan.zhihu.com/write'], css: '.Topstory-container { width: 1200px !important; }\\n', js: '', runAt: 'document_idle', world: 'MAIN', allFrames: false, updatedAt: Date.now() - 86400e3 * 3 },
        { id: 'rdemo3', name: 'B 站去广告', enabled: false, sites: ['bilibili.com'], css: '', js: "document.querySelectorAll('.ad-report').forEach(el => el.remove());\\n", runAt: 'document_end', world: 'MAIN', allFrames: false, updatedAt: Date.now() - 86400e3 * 10 },
      ],
    }));
  }
  const listeners = [];
  const area = {
    async get(keys) {
      const all = load();
      const list = keys == null ? Object.keys(all) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in all).map((k) => [k, structuredClone(all[k])]));
    },
    async set(items) {
      const all = load();
      const changes = {};
      for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: all[k], newValue: structuredClone(v) }; all[k] = structuredClone(v); }
      localStorage.setItem(KEY, JSON.stringify(all));
      setTimeout(() => listeners.forEach((fn) => fn(changes, 'local')));
    },
  };
  const session = { async get() { return {}; }, async set() {}, async remove() {} };
  const params = new URLSearchParams(location.search);
  const noop = { addListener() {}, removeListener() {} };
  const loaded = new Set();
  const loadScript = (src) => loaded.has(src) ? null : new Promise((resolve, reject) => {
    loaded.add(src);
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
  window.chrome = {
    storage: { local: area, session, onChanged: { addListener: (fn) => listeners.push(fn) } },
    // 「参考页面」就是预览页本身：注入的脚本和检查函数直接在当前页面运行
    scripting: {
      executeScript: async ({ files, func, args }) => {
        if (files) {
          for (const f of files) await loadScript('/' + f);
          return [];
        }
        return [{ result: await func(...(args || [])) }];
      },
    },
    runtime: {
      id: 'mockextensionid',
      getManifest: () => ({ version: '0.0.0-preview' }),
      onConnect: { addListener: (fn) => (window.__onConnect = fn) },
      getURL: (p) => '/' + p,
      openOptionsPage: () => window.open('/options/options.html'),
      sendMessage: async (msg) => {
        (window.__messages = window.__messages || []).push(msg);
        return msg.type === 'getStatus' ? { userScripts: params.get('us') === '1', chromeVersion: 140, syncErrors: {} } : {};
      },
    },
    tabs: {
      query: async () => [{ id: 1, title: '知乎 - 有问题，就会有答案', url: params.get('url') || 'https://www.zhihu.com/question/123' }],
      create: ({ url }) => window.open(url),
      reload: async () => {},
      onRemoved: noop,
      onUpdated: noop,
      connect: () => ({
        postMessage: (msg) => (window.__preview = msg),
        disconnect() {},
        onDisconnect: noop,
      }),
    },
  };
})();
`;

// 模拟的 OpenAI 兼容接口，用来预览 AI 助手：API 地址填 http://localhost:5178/__mock-llm/v1，
// 任意模型名；API Key 填 bad 时返回 401。按本轮已有的工具结果数量依次：看结构 → 查找/查询 → 改 CSS → 总结。
// 消息里含「暗色」：先用 ask_user 单选提问；含「让我选择」：多选提问；
// 含「重试」：每次请求先失败两次（503 + 500）再成功；含「一直失败」：始终返回 500。
const attempts = new Map();

function mockLlm(req, res) {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.headers.authorization === 'Bearer bad') {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
    }
    const body = JSON.parse(raw || '{}');
    const messages = body.messages || [];
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }));
    }
    const lastUser = messages.map((m) => m.role).lastIndexOf('user');
    const userText = lastUser === -1 ? '' : String(messages[lastUser].content);
    const done = messages.slice(lastUser + 1).filter((m) => m.role === 'tool').length;
    const call = (index, id, name, args) => ({ index, id, type: 'function', function: { name, arguments: args } });

    const key = messages.length + '|' + userText;
    const tries = (attempts.get(key) || 0) + 1;
    attempts.set(key, tries);
    if (userText.includes('一直失败') || (userText.includes('重试') && tries <= 2)) {
      const status = tries === 1 ? 503 : 500;
      res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '1' });
      return res.end(JSON.stringify({ error: { message: `mock server error #${tries}` } }));
    }

    let chunks;
    const asking = userText.includes('暗色') ? 'single' : userText.includes('让我选择') ? 'multiple' : '';
    if (asking && done === 0) {
      const args =
        asking === 'single'
          ? { question: '暗色主题想要哪种风格？', options: ['纯黑（OLED 省电）', '深灰（柔和护眼）', '跟随系统设置自动切换'] }
          : { question: '要隐藏哪些区域？', options: ['右侧推荐栏', '顶部横幅', '底部下载 App 提示'], multiple: true };
      chunks = [{ content: '先确认一下细节。' }, { tool_calls: [call(0, 'ask1', 'ask_user', JSON.stringify(args))] }];
    } else if (asking) {
      const answer = messages[messages.length - 1].content;
      chunks = [{ content: '收到你的选择：' + answer }];
    } else if (done === 0) {
      chunks = [{ content: '我先看看' }, { content: '页面结构。' }, { tool_calls: [call(0, 'c1', 'get_page_overview', '')] }];
    } else if (done === 1) {
      chunks = [
        { tool_calls: [call(0, 'c2', 'find_by_text', '{"text":')] },
        { tool_calls: [{ index: 0, function: { arguments: '"规则"}' } }] },
        { tool_calls: [call(1, 'c3', 'query_elements', JSON.stringify({ selector: '.sidebar', styles: ['width'] }))] },
      ];
    } else if (done === 3) {
      const css = '/* 侧栏加宽 */\n.sidebar {\n  background: #fdf6e3 !important;\n}\n';
      chunks = [{ tool_calls: [call(0, 'c4', 'update_rule', JSON.stringify({ css }))] }];
    } else {
      chunks = [{ content: '已完成：给 `.sidebar` 加了**米色背景**。\n\n```css\n.sidebar { background: #fdf6e3 !important; }\n```\n确认无误后点保存。' }];
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    let i = 0;
    const tick = () => {
      if (i < chunks.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: chunks[i++] }] })}\n\n`);
        setTimeout(tick, 150);
      } else {
        res.end('data: [DONE]\n\n');
      }
    };
    tick();
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__mock-llm/v1/chat/completions' && req.method === 'POST') return mockLlm(req, res);
    if (url.pathname === '/__mock-chrome.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(MOCK);
    }
    if (url.pathname.startsWith('/__test/')) {
      // 模拟内容脚本在 document_start 时运行：放在网页自身样式之前
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html><head>
<script src="/__mock-chrome.js"></script><script src="/lib/rules.js"></script><script src="/content.js"></script>
<style>body { background: rgb(255, 255, 255); color: rgb(0, 0, 0); }</style>
</head><body><h1>content script test</h1></body></html>`);
    }
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    let body = fs.readFileSync(file);
    const ext = path.extname(file);
    if (ext === '.html') {
      body = body.toString().replace('<script', '<script src="/__mock-chrome.js"></script>\n    <script');
    }
    res.writeHead(200, { 'content-type': (TYPES[ext] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(body);
  })
  .listen(PORT, () => console.log(`preview: http://localhost:${PORT}/options/options.html`));
