# Chrome 应用商店提交资料

Chrome 应用商店的开发者后台（https://chrome.google.com/webstore/devconsole）不允许任何扩展或自动化浏览器操作，需要在普通浏览器里手动提交。下面按后台的标签页顺序列出每一项要填的内容，可以直接复制。

## 提交前

- 开发者账号需要先注册（一次性支付 5 美元注册费），并在 Google 账号上开启两步验证；「账号」页里的联系邮箱要验证过才能发布。
- 安装包与 Edge 相同：`dist/site-tweaker-1.3.0.zip`（在 `site-tweaker/` 目录内打包，manifest.json 位于 zip 根目录）。
- Chrome 和 Edge 的商店版本扩展 ID 不同，各自的账号同步互不相通。

## 1. 新建内容（New item）

点「新建内容」，上传 `dist/site-tweaker-1.3.0.zip`。名称、简短说明、图标、版本号取自 manifest。

## 2. 商品详情（Store listing）

- **说明（Description）**：

```
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

---

SiteTweaker lets you inject your own CSS and JavaScript into any website you choose: hide ads and sidebars, widen content, apply a dark theme, change fonts, or automate repetitive tasks.

• Per-site rules with domain, path, port, match-pattern and exclusion syntax, plus a live URL tester.
• CSS applies instantly to open pages; JS runs at document start, DOM ready or page load, in the page or an isolated world, via the userScripts API (not blocked by page CSP).
• Element picker (Alt+Shift+X): click to hide any element, with undo; saved as a rule.
• Code viewer (Alt+Shift+C): floating panel listing every rule on the current page.
• Optional AI assistant: bring your own OpenAI-compatible API to have rules written for you.
• Account sync: sign in to your browser with extension sync on, and your rules and settings follow you to your other devices.
• Import / export rules.

Privacy: rules and settings are stored in your browser and synced to your other devices by the browser's own account sync (chrome.storage.sync); AI API settings and keys stay on this device only. The extension has no server and collects no data.
```

- **类别**：开发者工具（Developer Tools）
- **语言**：中文（简体）
- **商店图标**（128×128）：`site-tweaker/icons/icon128.png`
- **屏幕截图**（1280×800）：`store/screenshot1.png`、`store/screenshot2.png`
- **小型宣传图块**（440×280）：`store/promo440.png`（由 `store/promo-tile.html` 生成，重新生成的命令写在该文件开头）
- **官方网址 / 支持网址**：https://github.com/huangyixu/SiteTweaker （支持网址可填 https://github.com/huangyixu/SiteTweaker/issues）

## 3. 隐私权（Privacy practices）

与 Edge 商店审核通过的说明一致。

- **单一用途说明**：

```
让用户为自己指定的网站注入自己编写的 CSS 样式和 JavaScript 脚本，以自定义网页的外观和行为（类似 Stylus / Tampermonkey）。快捷消除、代码小窗和可选的 AI 助手都只是帮助用户编写和管理这些规则的辅助工具。
```

- **storage 理由**：

```
保存用户创建的规则（适用网站、CSS、JS）和扩展设置：存放在 chrome.storage.local，并写入 chrome.storage.sync，由浏览器的账号同步功能同步到用户登录同一账号的其他设备。可选 AI 助手的接口配置（含 API Key）只保存在 chrome.storage.local，不会同步。数据不会上传到开发者的任何服务器。
```

- **scripting 理由**：

```
在用户未开启「允许用户脚本」时，以兼容模式在匹配的页面中运行用户自己编写的 JS；并在用户点击工具栏按钮或快捷键时，把扩展包内自带的页面工具（快捷消除、代码小窗、只读页面结构检查）注入当前标签页。
```

- **userScripts 理由**：

```
这是本扩展的核心功能：把用户在扩展管理页中亲手编写的 JavaScript 规则注册为用户脚本，在用户指定的网站上运行。使用 userScripts API 可让用户代码运行在独立的用户脚本环境中，不受网站 CSP 限制。所有脚本都来自用户本人输入，扩展不会下载或运行任何远程代码。
```

- **主机权限理由**：

```
用户可以为任意网站编写规则，扩展无法预先知道用户会选择哪些网站，因此需要 <all_urls>。内容脚本只在页面中读取本地规则，并且只对与用户规则「适用网站」匹配的页面插入 CSS / 运行 JS；不匹配的页面不做任何修改，也不收集任何页面数据。
```

- **是否使用远程代码**：否（No, I am not using remote code）
- **数据使用**：只勾选「网站内容」（Website content），与 Edge 一致；勾选全部三项合规声明。
- **隐私权政策网址**：https://github.com/huangyixu/SiteTweaker/blob/main/PRIVACY.md

## 4. 分发（Distribution）

- 付款：免费
- 公开范围：公开
- 地区：所有地区

## 5. 测试说明（Test instructions，可选）

不需要测试账号。可在「其他说明」里粘贴：

```
This extension lets users inject their own CSS and JavaScript into websites they choose (similar to Stylus / Tampermonkey). No remote code is downloaded or executed: every script that runs is code the user typed into the extension's own options page and stored in chrome.storage.local (mirrored to chrome.storage.sync so the browser can sync the user's own rules across their devices).

What's new in 1.3.0: rules and settings sync across the user's own devices through the browser's account sync (chrome.storage.sync). Rules over the sync quota stay local, and the AI assistant's API settings/key are never synced.

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
```

## 6. 提交审核

点「提交以供审核」。可以勾选「审核通过后自动发布」，或者审核通过后再手动发布。
