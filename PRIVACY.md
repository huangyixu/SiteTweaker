# 网页定制 隐私政策 / Privacy Policy

最后更新：2026-10-26

## 中文

「网页定制」（以下简称本扩展）是一个在浏览器本地运行的工具，用于为你指定的网站注入你自己编写的 CSS 和 JavaScript。

**本扩展的开发者不收集、不存储、不上传任何用户数据。** 本扩展没有自己的服务器，不包含统计、分析或广告代码。

### 规则与设置（随浏览器账号同步）

- 你创建的规则（适用网站、CSS、JS 代码）和扩展设置保存在浏览器里（`chrome.storage.local`），同时写入浏览器的扩展同步存储（`chrome.storage.sync`）。
- 如果你在浏览器中登录了账号并开启了扩展同步（例如 Edge 的 Microsoft 账号、Chrome 的 Google 账号），这些规则和设置会通过**浏览器厂商的同步服务**同步到你登录同一账号的其他设备。同步由浏览器完成，适用浏览器厂商的隐私政策；本扩展的开发者无法访问这些数据。
- 没有登录账号或关闭了扩展同步时，数据只保存在本设备。
- 超过同步容量上限（单条规则约 8 KB、总共约 100 KB）的规则只保存在本设备，管理页会标注「仅本机」。

### 只保存在本设备的数据

- AI 助手的接口设置（API 地址、API Key、模型名称）只保存在本地（`chrome.storage.local`），不会同步到其他设备，也不会随规则导出。

### AI 助手（可选功能）

AI 助手默认不启用。只有当你在「AI 设置」中自行填写了 API 地址和 API Key，并主动发起对话时，本扩展才会把以下内容发送到**你自己指定的接口地址**：

- 你输入的对话内容；
- 你选择的参考页面的结构片段（HTML 片段、元素文字、计算样式）；
- 当前规则的代码。

这些数据直接从你的浏览器发送到你配置的服务（例如 OpenAI、DeepSeek 或本地 Ollama），不经过开发者的任何服务器。该服务如何处理数据，适用其自身的隐私政策。

### 权限说明

- `<all_urls>` 主机权限、`scripting`、`userScripts`：用于在你设置了规则的网站上注入你编写的 CSS/JS，以及让快捷消除、代码小窗、AI 助手读取页面结构。
- `storage`：保存规则和设置，并通过浏览器账号同步规则和设置。

### 联系方式

如有疑问，请在 https://github.com/huangyixu/SiteTweaker/issues 提交问题。

## English

SiteTweaker ("the extension") runs entirely in your browser and injects CSS and JavaScript that you write into the websites you choose.

**The developer does not collect, store, or transmit any user data.** The extension has no backend server and contains no analytics, tracking, or advertising code.

- Your rules and settings are stored in `chrome.storage.local` and mirrored to `chrome.storage.sync`. If you are signed in to your browser with sync for extensions turned on (e.g. a Microsoft account in Edge or a Google account in Chrome), the browser syncs them to your other devices through the browser vendor's sync service, under that vendor's privacy policy. The developer has no access to this data. Rules larger than the sync quota (about 8 KB per rule, 100 KB in total) stay on the current device only.
- The AI assistant's API settings (endpoint, API key, model) are stored only in `chrome.storage.local`. They are never synced and never included in exports.
- The optional AI assistant is off until you enter your own API endpoint and key. When you start a conversation, your message, structural snippets of the reference page you selected, and the current rule's code are sent directly from your browser to the endpoint **you configured**. Nothing passes through any server operated by the developer. That provider's own privacy policy applies.
- Permissions (`<all_urls>`, `scripting`, `userScripts`, `storage`) are used only to apply your rules, to let the in-page tools read page structure, and to store and sync your rules and settings.

Contact: https://github.com/huangyixu/SiteTweaker/issues
