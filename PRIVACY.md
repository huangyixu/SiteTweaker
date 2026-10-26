# 网页定制 隐私政策 / Privacy Policy

最后更新：2026-10-26

## 中文

「网页定制」（以下简称本扩展）是一个在浏览器本地运行的工具，用于为你指定的网站注入你自己编写的 CSS 和 JavaScript。

**本扩展的开发者不收集、不存储、不上传任何用户数据。** 本扩展没有自己的服务器，不包含统计、分析或广告代码。

### 本地保存的数据

- 你创建的规则（适用网站、CSS、JS 代码）和扩展设置，保存在浏览器本地（`chrome.storage.local`），不会离开你的设备。
- AI 助手的接口设置（API 地址、API Key、模型名称）同样只保存在本地，不会随规则导出。

### AI 助手（可选功能）

AI 助手默认不启用。只有当你在「AI 设置」中自行填写了 API 地址和 API Key，并主动发起对话时，本扩展才会把以下内容发送到**你自己指定的接口地址**：

- 你输入的对话内容；
- 你选择的参考页面的结构片段（HTML 片段、元素文字、计算样式）；
- 当前规则的代码。

这些数据直接从你的浏览器发送到你配置的服务（例如 OpenAI、DeepSeek 或本地 Ollama），不经过开发者的任何服务器。该服务如何处理数据，适用其自身的隐私政策。

### 权限说明

- `<all_urls>` 主机权限、`scripting`、`userScripts`：用于在你设置了规则的网站上注入你编写的 CSS/JS，以及让快捷消除、代码小窗、AI 助手读取页面结构。
- `storage`：在本地保存规则和设置。

### 联系方式

如有疑问，请在 https://github.com/huangyixu/SiteTweaker/issues 提交问题。

## English

SiteTweaker ("the extension") runs entirely in your browser and injects CSS and JavaScript that you write into the websites you choose.

**The developer does not collect, store, or transmit any user data.** The extension has no backend server and contains no analytics, tracking, or advertising code.

- Your rules and settings are stored locally in `chrome.storage.local` and never leave your device.
- The optional AI assistant is off until you enter your own API endpoint and key. When you start a conversation, your message, structural snippets of the reference page you selected, and the current rule's code are sent directly from your browser to the endpoint **you configured**. Nothing passes through any server operated by the developer. That provider's own privacy policy applies.
- Permissions (`<all_urls>`, `scripting`, `userScripts`, `storage`) are used only to apply your rules, to let the in-page tools read page structure, and to store your data locally.

Contact: https://github.com/huangyixu/SiteTweaker/issues
