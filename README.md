# ShareCraft · 网页推荐语生成插件

> 一键把当前网页变成可直接转发的推荐语。

每次想分享一个网页给朋友、群里或者社群，是不是都遇到过这种情况——直接甩链接没人点，自己写一段又干巴巴？ShareCraft 在浏览器里加一个按钮，自动读取当前网页内容，调用你自己的大模型 Key 生成 3 种风格的推荐语，点一下复制就能粘到微信、飞书、Slack 里发出去。

## 功能

- **自动提取页面内容**：抓取标题、摘要、正文、来源站点，作为生成素材。
- **3 种风格一次给齐**：
  - 朋友安利：一句话，像跟朋友私聊一样自然。
  - 金句安利：≤ 200 字的钩子型一句话，带记忆点。
  - 详细安利：≤ 200 字的简介式安利，告诉别人"为什么值得看"。
- **输出语言可选**：简体中文 / 繁體中文 / English / 日本語 / 한국어 / Español / Français / Deutsch，始终按你设定的语言输出。
- **一键复制**：复制 = 推荐语 + 换行 + 链接，直接粘出去就能发。
- **重新生成**：同一个页面再来一遍，得到不同表达。
- **自带 Key**：在设置页填入你自己的 OpenAI 或 Anthropic API Key，插件直接走你的 Key 调用，不经过任何第三方服务器。

## 截图速览

```
┌────────────────────────────────┐
│ ✦ ShareCraft               ⚙ │
├────────────────────────────────┤
│ 当前网页标题…                  │
│ https://example.com/article    │
├────────────────────────────────┤
│ [ 生成推荐语 ]  [ 重新生成 ]   │
├────────────────────────────────┤
│ 朋友安利              [复制]   │
│ 这篇讲 X 的文章我看完想到了你… │
├────────────────────────────────┤
│ 金句安利              [复制]   │
│ "……"                         │
├────────────────────────────────┤
│ 详细安利              [复制]   │
│ ……                            │
└────────────────────────────────┘
```

## 安装与使用

### 1. 加载插件

1. 打开 `chrome://extensions`（Edge 是 `edge://extensions`，Arc / Brave 同理）。
2. 打开右上角的"开发者模式"。
3. 点击"加载已解压的扩展程序"，选择本仓库根目录（包含 `manifest.json` 的那一级）。

### 2. 配置 API Key

第一次使用前，点击工具栏上的 ShareCraft 图标 → 右上角 ⚙ 进入设置页：

- **服务商**：选 `OpenAI` 或 `Anthropic`。
- **API Key**：粘贴你自己的 Key。OpenAI 在 [platform.openai.com](https://platform.openai.com) 创建，Anthropic 在 [console.anthropic.com](https://console.anthropic.com) 创建。
- **模型**：默认 `gpt-4o-mini` 或 `claude-3-5-haiku-latest`，可改成账号下任意聊天模型。
- **输出语言**：选你常用的语言。
- 保存即可。

### 3. 开始用

1. 打开任意你想分享的网页。
2. 点击工具栏的 ShareCraft 图标。
3. 点"生成推荐语"，等几秒。
4. 选一条最喜欢的，点旁边的"复制"，去聊天框里粘贴发送。
5. 不满意？点"重新生成"。

## 目录结构

```
sharecraft/
├── manifest.json           # MV3 配置
├── icons/                  # 16/32/48/128 图标
├── scripts/
│   └── make_icons.py       # 重新生成图标的脚本（依赖 Pillow）
└── src/
    ├── background.js       # service worker，处理生成请求
    ├── extractor.js        # 注入到页面，抓取标题/正文/来源
    ├── llm.js              # OpenAI / Anthropic 调用 + 提示词
    ├── storage.js          # chrome.storage 封装
    ├── popup.html / .js / .css      # 工具栏弹窗
    └── options.html / .js / .css    # 设置页
```

## 工作流程

```
用户点图标
   ↓
popup.js 调 chrome.scripting 注入 extractor.js
   ↓
extractor.js 抓取标题、og 数据、正文（最多 4000 字）
   ↓
popup.js → background.js 发 "generate" 消息
   ↓
background.js 读 storage 拿到 provider / key / model / language
   ↓
llm.js 按设置调用 OpenAI 或 Anthropic
   ↓
返回 { friend, quote, detailed } JSON
   ↓
popup.js 渲染 3 张卡片，点"复制"拼接 URL 写入剪贴板
```

## 隐私说明

- API Key 存在 `chrome.storage.sync`，仅随 Chrome 账号在你自己的设备间同步，不会上传到任何第三方服务器。
- 生成请求由插件直接通过 HTTPS 发往 `api.openai.com` 或 `api.anthropic.com`，没有中间层。
- 调用产生的费用由你的 Key 账号自己承担。
- 如果你不想让 Key 跨设备同步，可以把 `src/storage.js` 里的 `chrome.storage.sync` 改成 `chrome.storage.local`。

## 常见问题

**Q：为什么打开 `chrome://`、扩展页或新标签页时，插件提示无法读取？**
A：浏览器的内部页面禁止脚本注入，这是 Chrome 的安全限制。换一个普通网页即可。

**Q：生成失败提示 401 / 403？**
A：八成是 API Key 写错了，或者 Key 没有该模型的调用权限。回设置页确认。

**Q：能换其他模型吗？**
A：可以。设置页的"模型"是文本框，填你 Key 账号下任意可用的聊天模型 ID 都行（比如 `gpt-4o`、`claude-sonnet-4-5`）。

**Q：能加别的 LLM 服务商（DeepSeek、Gemini、Moonshot 等）吗？**
A：暂时只内置了 OpenAI 和 Anthropic。要加新的，在 `src/llm.js` 里仿照 `callOpenAI` / `callAnthropic` 加一个函数，然后在 `manifest.json` 的 `host_permissions` 里加上对应域名即可。

## 开发笔记

重新生成图标（改了风格之后）：

```bash
pip install Pillow
python3 scripts/make_icons.py
```

本地修改后只要在 `chrome://extensions` 里点一下插件卡片上的"刷新"图标就能生效，不用重新加载。

## License

MIT
