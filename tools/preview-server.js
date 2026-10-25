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
  window.chrome = {
    storage: { local: area, session, onChanged: { addListener: (fn) => listeners.push(fn) } },
    runtime: {
      id: 'mockextensionid',
      getURL: (p) => '/' + p,
      openOptionsPage: () => window.open('/options/options.html'),
      sendMessage: async (msg) => {
        (window.__messages = window.__messages || []).push(msg);
        return msg.type === 'getStatus' ? { userScripts: params.get('us') === '1', chromeVersion: 140, syncErrors: {} } : {};
      },
    },
    tabs: {
      query: async () => [{ id: 1, url: params.get('url') || 'https://www.zhihu.com/question/123' }],
      create: ({ url }) => window.open(url),
      reload: () => {},
    },
  };
})();
`;

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
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
