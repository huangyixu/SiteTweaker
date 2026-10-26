/*
 * 账号同步：规则和设置的工作副本在 chrome.storage.local，后台把它和 chrome.storage.sync 双向合并。
 * 同步区每条规则单独一项（rule:<id>），设置是 settings 一项。
 * 本地另存一份“上次同步时的内容指纹”（syncBase），用来区分哪边改了、哪边删了。
 * 后台和管理页共用，挂在 self.SiteTweakerSync 上。
 */
(function (root) {
  'use strict';

  const ST = root.SiteTweaker;
  const RULE_PREFIX = 'rule:';
  const SETTINGS_KEY = 'settings';
  // chrome.storage.sync 的配额；浏览器的计算方式和 JSON.stringify 略有出入，留一点余量
  const PER_ITEM = 8192 - 32;
  const TOTAL = 102400 - 1024;
  const MAX_ITEMS = 512;

  const encoder = new TextEncoder();

  /** 一项在同步区占的字节数：键 + 值的 JSON（浏览器会把 < 和 U+2028/2029 转义成 \uXXXX） */
  function itemBytes(key, value) {
    const json = JSON.stringify(value);
    let extra = 0;
    for (const ch of json) {
      if (ch === '<') extra += 5;
      else if (ch === ' ' || ch === ' ') extra += 3;
    }
    return encoder.encode(key).length + encoder.encode(json).length + extra;
  }

  function ruleBytes(rule) {
    return itemBytes(RULE_PREFIX + rule.id, ST.normalizeRule(rule));
  }

  /** 内容指纹（cyrb53）。规则不计 updatedAt：只改了时间不算改动 */
  function hash(text) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
  }

  function ruleHash(rule) {
    return hash(JSON.stringify({ ...rule, updatedAt: 0 }));
  }

  function settingsHash(settings) {
    return hash(JSON.stringify(Object.keys(settings).sort().map((k) => [k, settings[k]])));
  }

  /**
   * 三方合并：本地、同步区、上次同步时的指纹。
   *   两边都没变或改成一样 → 不动；只有一边改了 → 用改了的那边；
   *   两边都改了 → 规则取 updatedAt 新的（相同时取同步区的），设置取同步区的；
   *   一边删除、另一边没改 → 删除；一边删除、另一边改了 → 保留改了的。
   * keepLocal(rule) 为真的规则只留在本地、不上传（比如没动过的示例规则）。
   * 返回 { rules, settings, set, remove, base, unsynced }：
   *   rules / settings 是要写回本地的新值（没变化为 null），set / remove 是要写入同步区的改动，
   *   base 是同步区写入成功后的新指纹，unsynced 是因为太大传不上去的规则 { id: 'tooLarge' | 'quota' }。
   */
  function merge({ rules: localRaw, settings: localSettings, remote, base: oldBase, keepLocal }) {
    const base = { ...(oldBase || {}) };
    const set = {};
    const remove = [];
    const unsynced = {};
    const uploads = [];

    const local = (localRaw || []).map(ST.normalizeRule);
    const remoteRules = new Map();
    for (const [key, value] of Object.entries(remote || {})) {
      if (!key.startsWith(RULE_PREFIX) || !value || typeof value !== 'object') continue;
      const id = key.slice(RULE_PREFIX.length);
      const rule = ST.normalizeRule({ ...value, id });
      if (rule.id === id) remoteRules.set(id, rule);
    }

    let rulesChanged = false;
    const result = [];
    const added = [];
    const seen = new Set();

    for (const L of local) {
      if (seen.has(L.id)) continue;
      seen.add(L.id);
      const key = RULE_PREFIX + L.id;
      const R = remoteRules.get(L.id);
      const B = base[key];
      const hL = ruleHash(L);
      if (R) {
        const hR = ruleHash(R);
        // 本地没改，或者两边都改了而同步区的更新
        const takeRemote = hL === B || (hR !== B && R.updatedAt >= L.updatedAt);
        if (hL === hR) {
          base[key] = hL;
          result.push(L);
        } else if (takeRemote) {
          base[key] = hR;
          result.push(R);
          rulesChanged = true;
        } else {
          result.push(L);
          uploads.push(L);
        }
      } else if (B !== undefined && hL === B) {
        // 别的设备删了这条规则
        delete base[key];
        rulesChanged = true;
      } else {
        result.push(L);
        if (!(keepLocal && keepLocal(L))) uploads.push(L);
      }
    }

    for (const [id, R] of remoteRules) {
      if (seen.has(id)) continue;
      const key = RULE_PREFIX + id;
      if (base[key] !== undefined && ruleHash(R) === base[key]) {
        // 本机删了这条规则
        remove.push(key);
        delete base[key];
      } else {
        base[key] = ruleHash(R);
        added.push(R);
        rulesChanged = true;
      }
    }

    // 只剩指纹、两边都没有的规则
    for (const key of Object.keys(base)) {
      if (key.startsWith(RULE_PREFIX) && !seen.has(key.slice(RULE_PREFIX.length)) && !remoteRules.has(key.slice(RULE_PREFIX.length))) {
        delete base[key];
      }
    }

    // 上传前检查配额：单项 8 KB、总共 100 KB、最多 512 项
    const sizes = new Map();
    for (const [key, value] of Object.entries(remote || {})) sizes.set(key, itemBytes(key, value));
    for (const key of remove) sizes.delete(key);
    for (const L of uploads) sizes.delete(RULE_PREFIX + L.id);
    let total = 0;
    for (const size of sizes.values()) total += size;
    let count = sizes.size;
    for (const L of uploads) {
      const key = RULE_PREFIX + L.id;
      const size = itemBytes(key, L);
      if (size > PER_ITEM) {
        unsynced[L.id] = 'tooLarge';
      } else if (total + size > TOTAL || count + 1 > MAX_ITEMS) {
        unsynced[L.id] = 'quota';
      } else {
        set[key] = L;
        base[key] = ruleHash(L);
        total += size;
        count++;
      }
    }

    // 设置
    let settings = null;
    const R = remote && remote[SETTINGS_KEY] && typeof remote[SETTINGS_KEY] === 'object' ? remote[SETTINGS_KEY] : null;
    const L = localSettings && typeof localSettings === 'object' ? localSettings : null;
    if (L || R) {
      const hL = L && settingsHash(L);
      const hR = R && settingsHash(R);
      const B = base[SETTINGS_KEY];
      if (hL === hR) {
        base[SETTINGS_KEY] = hL;
      } else if (L && (!R || hR === B)) {
        set[SETTINGS_KEY] = L;
        base[SETTINGS_KEY] = hL;
      } else {
        settings = R;
        base[SETTINGS_KEY] = hR;
      }
    }

    added.sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      rules: rulesChanged ? added.concat(result) : null,
      settings,
      set,
      remove,
      base,
      unsynced,
    };
  }

  root.SiteTweakerSync = { RULE_PREFIX, PER_ITEM, itemBytes, ruleBytes, merge };
})(typeof self !== 'undefined' ? self : globalThis);
