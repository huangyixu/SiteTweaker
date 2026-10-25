/* 在标签页里打开页面内工具（快捷消除、代码小窗）。弹窗和后台共用 */
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

  root.SiteTweakerTools = { openTool };
})(self);
