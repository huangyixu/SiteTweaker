// 账号同步合并逻辑的单元测试：node --test tools/test-sync.js
const test = require('node:test');
const assert = require('node:assert/strict');
require('../site-tweaker/lib/rules.js');
require('../site-tweaker/lib/sync.js');

const ST = globalThis.SiteTweaker;
const SYNC = globalThis.SiteTweakerSync;

function rule(id, css, updatedAt = 1000, extra = {}) {
  return ST.normalizeRule({ id, name: id, sites: ['example.com'], css, updatedAt, ...extra });
}

/** 模拟两台设备共用一个同步区，按后台的顺序跑一轮合并 */
function device(rules = [], settings = { enabled: true }) {
  return { rules, settings, base: {} };
}
function round(dev, remote, keepLocal) {
  const plan = SYNC.merge({ rules: dev.rules, settings: dev.settings, remote, base: dev.base, keepLocal });
  if (plan.rules) dev.rules = plan.rules;
  if (plan.settings) dev.settings = plan.settings;
  Object.assign(remote, structuredClone(plan.set));
  for (const key of plan.remove) delete remote[key];
  dev.base = plan.base;
  return plan;
}
const ids = (dev) => dev.rules.map((r) => r.id);

test('本地规则和设置上传到空的同步区', () => {
  const remote = {};
  const a = device([rule('a', 'x'), rule('b', 'y')]);
  round(a, remote);
  assert.deepEqual(Object.keys(remote).sort(), ['rule:a', 'rule:b', 'settings']);
  // 再跑一轮没有任何改动
  const plan = round(a, remote);
  assert.equal(plan.rules, null);
  assert.deepEqual(plan.set, {});
  assert.deepEqual(plan.remove, []);
});

test('新设备拉取规则，同步区的设置优先', () => {
  const remote = {};
  const a = device([rule('a', 'x')], { enabled: false });
  round(a, remote);
  const b = device([], { enabled: true });
  round(b, remote);
  assert.deepEqual(ids(b), ['a']);
  assert.deepEqual(b.settings, { enabled: false });
});

test('一边修改，另一边拿到新内容', () => {
  const remote = {};
  const a = device([rule('a', 'x')]);
  round(a, remote);
  const b = device([]);
  round(b, remote);
  a.rules = [rule('a', 'changed', 2000)];
  round(a, remote);
  round(b, remote);
  assert.equal(b.rules[0].css, 'changed');
  // 开关不改 updatedAt 也要同步
  b.rules = [{ ...b.rules[0], enabled: false }];
  round(b, remote);
  round(a, remote);
  assert.equal(a.rules[0].enabled, false);
});

test('删除会同步，删除对方改过的规则时保留修改', () => {
  const remote = {};
  const a = device([rule('a', 'x'), rule('b', 'y')]);
  round(a, remote);
  const b = device([]);
  round(b, remote);

  a.rules = a.rules.filter((r) => r.id !== 'a');
  round(a, remote);
  assert.ok(!('rule:a' in remote));
  round(b, remote);
  assert.deepEqual(ids(b), ['b']);

  // a 删了 b 规则，同时 b 设备改了它：改动胜出
  a.rules = [];
  b.rules = [rule('b', 'edited', 3000)];
  round(a, remote);
  round(b, remote);
  round(a, remote);
  assert.deepEqual(ids(a), ['b']);
  assert.equal(a.rules[0].css, 'edited');
});

test('两边都改了同一条规则时取更新的', () => {
  const remote = {};
  const a = device([rule('a', 'x')]);
  round(a, remote);
  const b = device([]);
  round(b, remote);
  a.rules = [rule('a', 'from-a', 2000)];
  b.rules = [rule('a', 'from-b', 3000)];
  round(a, remote);
  round(b, remote);
  round(a, remote);
  assert.equal(a.rules[0].css, 'from-b');
  assert.equal(b.rules[0].css, 'from-b');
});

test('超过单条上限的规则只留在本地，并且不影响其他规则', () => {
  const remote = {};
  const big = rule('big', 'a'.repeat(9000));
  const a = device([big, rule('small', 'x')]);
  const plan = round(a, remote);
  assert.deepEqual(plan.unsynced, { big: 'tooLarge' });
  assert.ok('rule:small' in remote);
  assert.ok(!('rule:big' in remote));
  // 下一轮仍然留在本地，不会被当成别处删除
  round(a, remote);
  assert.deepEqual(ids(a), ['big', 'small']);
});

test('“<” 按浏览器的转义方式计入大小', () => {
  const plain = SYNC.ruleBytes(rule('a', 'a'.repeat(1000)));
  const lt = SYNC.ruleBytes(rule('a', '<'.repeat(1000)));
  assert.equal(lt - plain, 5000);
  assert.ok(SYNC.ruleBytes(rule('a', '中'.repeat(100))) - SYNC.ruleBytes(rule('a', 'a'.repeat(100))) === 200);
});

test('同步区总量满了时，放不下的规则标为 quota', () => {
  const remote = {};
  const list = Array.from({ length: 16 }, (_, i) => rule('r' + i, 'a'.repeat(7000)));
  const plan = round(device(list), remote);
  const quota = Object.values(plan.unsynced).filter((v) => v === 'quota').length;
  assert.ok(quota > 0 && quota < 16);
  let total = 0;
  for (const [key, value] of Object.entries(remote)) total += SYNC.itemBytes(key, value);
  assert.ok(total <= 102400);
});

test('keepLocal 的规则不上传', () => {
  const remote = {};
  const a = device([rule('example', 'x'), rule('mine', 'y')]);
  round(a, remote, (r) => r.id === 'example');
  assert.ok(!('rule:example' in remote));
  assert.ok('rule:mine' in remote);
});

test('拉取到的新规则排在前面，按更新时间倒序', () => {
  const remote = {};
  round(device([rule('old', 'x', 1000), rule('new', 'y', 5000)]), remote);
  const b = device([rule('local', 'z', 9000)]);
  round(b, remote);
  assert.deepEqual(ids(b), ['new', 'old', 'local']);
});
