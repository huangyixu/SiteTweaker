// 规则匹配逻辑的单元测试：node --test tools/
const test = require('node:test');
const assert = require('node:assert/strict');
require('../site-tweaker/lib/rules.js');

const ST = globalThis.SiteTweaker;

function matches(sites, url) {
  return ST.ruleMatchesUrl(ST.normalizeRule({ sites }), url);
}

test('简写域名转换为匹配模式', () => {
  const cases = {
    'github.com': '*://*.github.com/*',
    'GitHub.com': '*://*.github.com/*',
    '*.github.com': '*://*.github.com/*',
    'example.com/blog': '*://*.example.com/blog*',
    'example.com/blog/*': '*://*.example.com/blog/*',
    // Chrome 不接受 *:// 带具体端口（userScripts.register 报 Invalid port），所以拆成两条
    'localhost:3000': ['http://localhost:3000/*', 'https://localhost:3000/*'],
    localhost: '*://localhost/*',
    '127.0.0.1:8080/app': ['http://127.0.0.1:8080/app*', 'https://127.0.0.1:8080/app*'],
    'example.com:80': ['http://*.example.com:80/*', 'https://*.example.com:80/*'],
    '[::1]:3000': ['http://[::1]:3000/*', 'https://[::1]:3000/*'],
    '例子.中国': '*://*.xn--fsqu00a.xn--fiqs8s/*',
    '*': '<all_urls>',
    '<all_urls>': '<all_urls>',
    'https://github.com': 'https://github.com/*',
    'https://*.example.com/news/*': 'https://*.example.com/news/*',
    'http://localhost:3000/*': 'http://localhost:3000/*',
    '*://localhost:*/*': '*://localhost:*/*',
  };
  for (const [input, expected] of Object.entries(cases)) {
    const patterns = Array.isArray(expected) ? expected : [expected];
    assert.deepEqual(ST.parseSiteLine(input), { exclude: false, patterns }, input);
  }
});

test('排除行、注释和空行', () => {
  assert.deepEqual(ST.parseSiteLine('!gist.github.com'), { exclude: true, patterns: ['*://*.gist.github.com/*'] });
  assert.equal(ST.parseSiteLine('# 备注'), null);
  assert.equal(ST.parseSiteLine('   '), null);
  const compiled = ST.compileSites(['github.com', '!gist.github.com', 'github.com', '# x']);
  assert.deepEqual(compiled.matches, ['*://*.github.com/*']);
  assert.deepEqual(compiled.excludeMatches, ['*://*.gist.github.com/*']);
  assert.equal(compiled.errors.length, 0);
});

test('无效写法会报错', () => {
  assert.ok(!ST.parseSiteLine('a_b.example.com').error);
  for (const bad of [
    'http://',
    'chrome://settings/*',
    'https://a*b.com/*',
    'exa mple.com',
    'bad%20host.com',
    'https://bad host.com/*',
    'https://bad%20host.com/*',
    '!',
    'user@example.com',
    'https://*foo.com/*',
    '*://localhost:3000/*',
  ]) {
    const r = ST.parseSiteLine(bad);
    assert.ok(r && r.error, `应报错：${bad}`);
  }
  assert.equal(ST.compileSites(['github.com', 'exa mple.com']).errors[0].text, 'exa mple.com');
});

test('网址匹配', () => {
  assert.ok(matches(['github.com'], 'https://github.com/'));
  assert.ok(matches(['github.com'], 'https://gist.github.com/abc?x=1'));
  assert.ok(matches(['github.com'], 'http://github.com:8080/a'));
  assert.ok(!matches(['github.com'], 'https://notgithub.com/'));
  assert.ok(!matches(['github.com'], 'https://github.com.evil.com/'));
  assert.ok(!matches(['github.com'], 'chrome://extensions/'));

  assert.ok(matches(['github.com', '!gist.github.com'], 'https://github.com/x'));
  assert.ok(!matches(['github.com', '!gist.github.com'], 'https://gist.github.com/x'));

  assert.ok(matches(['example.com/blog'], 'https://www.example.com/blog/post-1'));
  assert.ok(!matches(['example.com/blog'], 'https://example.com/about'));

  assert.ok(matches(['https://example.com/'], 'https://example.com/'));
  assert.ok(!matches(['https://example.com/'], 'https://example.com/page'));
  assert.ok(!matches(['https://example.com/*'], 'http://example.com/page'));
  assert.ok(matches(['*://example.com/*?tab=*'], 'https://example.com/list?tab=2'));

  assert.ok(matches(['localhost:3000'], 'http://localhost:3000/app'));
  assert.ok(!matches(['localhost:3000'], 'http://localhost:4000/app'));
  assert.ok(matches(['localhost'], 'http://localhost:4000/app'));
  assert.ok(matches(['https://example.com:443/*'], 'https://example.com/'));

  assert.ok(matches(['*'], 'https://any.site/'));
  assert.ok(matches(['*'], 'file:///C:/a.html'));
  assert.ok(matches(['file:///*'], 'file:///C:/a.html'));
  assert.ok(!matches(['*://*/*'], 'file:///C:/a.html'));
  assert.ok(matches(['例子.中国'], 'https://www.例子.中国/'));
  assert.ok(!matches([], 'https://github.com/'));
});

test('规则规范化', () => {
  const r = ST.normalizeRule({ id: '_bad id', sites: 'a.com\n\n b.com ', runAt: 'nope', world: 'x' });
  assert.match(r.id, /^r[a-z0-9]+$/);
  assert.deepEqual(r.sites, ['a.com', 'b.com']);
  assert.equal(r.runAt, 'document_idle');
  assert.equal(r.world, 'MAIN');
  assert.equal(r.enabled, true);
  assert.equal(r.name, '未命名规则');
  assert.equal(ST.normalizeRule({ id: 'keep-me_1' }).id, 'keep-me_1');
});

test('脚本包装：可用 await、出错时带规则名、行号偏移 1 行', async () => {
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    globalThis.__out = [];
    const ok = ST.wrapUserJs({ id: 'r1', name: '测试', js: 'await Promise.resolve();\n__out.push(1) // 末尾注释' });
    await eval(ok);
    assert.deepEqual(globalThis.__out, [1]);
    await eval(ST.wrapUserJs({ id: 'r2', name: '会出错"的规则', js: 'throw new Error("boom")' }));
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /会出错"的规则/);
    assert.equal(ok.split('\n')[1], 'await Promise.resolve();');
  } finally {
    console.error = origError;
    delete globalThis.__out;
  }
});

test('为当前网站生成默认写法', () => {
  assert.equal(ST.siteFromUrl('https://www.zhihu.com/question/1'), 'zhihu.com');
  assert.equal(ST.siteFromUrl('http://localhost:5173/'), 'localhost:5173');
  assert.equal(ST.siteFromUrl('chrome://extensions'), '');
  assert.ok(ST.canInject('https://a.com'));
  assert.ok(!ST.canInject('chrome://settings'));
  assert.ok(!ST.canInject('https://chromewebstore.google.com/detail/x'));
});
