/* 在标签页里打开页面内工具（快捷消除、代码小窗）、读取页面结构。弹窗、后台和管理页共用 */
(function (root) {
  'use strict';

  // content.js 已在页面里时会自动跳过；补注入是为了扩展安装前就打开的页面
  const FILES = ['lib/rules.js', 'content.js', 'inpage/ui.js', 'inpage/viewer.js', 'inpage/picker.js'];

  /** tool: 'picker' 开始快捷消除；'viewer' 打开/关闭代码小窗 */
  async function openTool(tabId, tool) {
    await chrome.scripting.executeScript({ target: { tabId }, files: FILES });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (name) => {
        if (name === 'picker') self.SiteTweakerPicker.start();
        else self.SiteTweakerViewer.toggle();
      },
      args: [tool],
    });
  }

  /** 在标签页的主框架里调用 inpage/inspect.js 的方法，供 AI 助手读取页面（只读） */
  async function inspect(tabId, method, args) {
    await chrome.scripting.executeScript({ target: { tabId }, files: [...FILES, 'inpage/inspect.js'] });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name, params) => self.SiteTweakerInspect[name](...params),
      args: [method, args || []],
    });
    return res && res.result;
  }

  root.SiteTweakerTools = { openTool, inspect };
})(self);
