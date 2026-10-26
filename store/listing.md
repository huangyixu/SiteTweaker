# Edge 加载项商店提交资料

- 安装包：`dist/site-tweaker-1.2.0.zip`（在 `site-tweaker/` 目录内打包，manifest.json 位于 zip 根目录）
- 商店徽标：`store/logo300.png`（300×300）
- 类别：开发人员工具（Developer tools）
- 隐私政策：`PRIVACY.md`

## 名称

网页定制 - 自定义 CSS / JS

## 简短说明（取自 manifest）

为指定网站注入你自己的 CSS 样式和 JavaScript 脚本，让网页按你喜欢的样子运行。

## 说明（Description）

网页定制让你为任意网站添加自己的 CSS 样式和 JavaScript 脚本，把网页调成你喜欢的样子：隐藏广告和推荐栏、加宽正文、换成暗色主题、调整字体，或者用脚本自动完成重复操作。

主要功能：
• 按网站管理规则：每条规则可以填写多个适用网站，支持域名、路径前缀、端口、标准匹配模式和排除写法，管理页实时显示匹配结果，还能粘贴网址测试是否生效。
• CSS 即时生效：保存后已打开的页面立刻更新，无需刷新。
• JS 自动运行：可选择页面开始加载时、DOM 就绪时或加载完成后运行，可选页面环境或隔离环境，支持直接使用 await。开启浏览器的「允许用户脚本」后，脚本不受网站安全策略（CSP）限制。
• 快捷消除（Alt+Shift+X）：鼠标点选即可隐藏网页上的任意元素，支持撤销，结果自动保存为规则。
• 代码小窗（Alt+Shift+C）：在当前页面浮出小窗，查看、开关、复制作用于本页的所有规则。
• 工具栏弹窗：显示当前网站生效的规则，可逐条开关、一键新建，图标角标显示规则数量。
• AI 助手（可选）：填写你自己的 OpenAI 兼容接口（OpenAI、DeepSeek、通义千问、Moonshot、本地 Ollama 等）后，用一句话描述需求，AI 会读取页面结构并替你写好 CSS / JS，改动可预览、可撤销。
• 账号同步：登录浏览器账号并开启扩展同步后，规则和设置自动同步到你的其他设备。
• 导入 / 导出：规则可以导出为文件备份或分享。

隐私：规则和设置保存在浏览器里，并通过浏览器自带的账号同步（chrome.storage.sync）同步到你的其他设备；AI 接口设置和 API Key 只保存在本机。扩展没有自己的服务器，不收集任何数据。AI 助手只有在你配置接口并主动使用时，才会把对话内容和页面结构片段直接发送到你指定的接口。

## 搜索词（最多 7 个）

自定义CSS, 用户脚本, userscript, 网页美化, 去广告, 暗色模式, stylus

## 认证说明（Notes for certification）

This extension lets users inject their own CSS and JavaScript into websites they choose (similar to Stylus / Tampermonkey). No remote code is downloaded or executed: every script that runs is code the user typed into the extension's own options page and stored in chrome.storage.local (mirrored to chrome.storage.sync so the browser can sync the user's own rules across their devices).

How to test:
1. Install the extension. The options page opens automatically with a sample rule for example.com.
2. Open https://example.com — the sample CSS rule changes the page style.
3. Click the toolbar icon → "快捷消除" (element picker), click any element on a page to hide it; the result is saved as a rule.
4. Optional: enable "Allow User Scripts" in the extension details page so user JS runs through the chrome.userScripts API (not blocked by page CSP). Without it, CSS works and JS runs in a compatibility mode.

Permissions:
- userScripts / scripting: run the user's own CSS/JS on matching sites.
- host_permissions <all_urls>: rules can target any site the user specifies.
- storage: save rules and settings, and sync them across the user's devices via chrome.storage.sync.

AI assistant (optional, off by default): only after the user enters their own OpenAI-compatible API URL and key, page structure snippets and the rule code are sent to that user-chosen endpoint. No test account is required; the feature can be skipped during review. The developer operates no server and collects no data.
