---
name: playwright-direct
description: 用 Playwright 通过 CDP 直接控制用户当前已登录的 Chrome/Edge，不重开浏览器、不需重新登录。需要读网页全文、点击、填表、截图、执行 JS、抓取动态内容时使用。
---

# 用 Playwright 控制已登录的真实浏览器

`playwright-direct` 是一个 DSH 插件 + Chrome 扩展。它把用户**当前正在用的浏览器**（登录态完好）暴露成标准 CDP 端点，Playwright 用 `connectOverCDP` 直接接管。

**不要**用 `chromium.launch()` 新开浏览器，也**不要**用 `--remote-debugging-port` 重启 Chrome —— 前者丢失登录态，后者在 Chrome 136+ 的默认 profile 上被直接忽略。

## 什么时候用

| 场景 | 用不用 |
|---|---|
| 读需要登录的网页全文 | ✅ |
| 抓取 JS 动态渲染的内容 | ✅ |
| 点击按钮、填表单、上传文件 | ✅ |
| 截图（含全页、单元素） | ✅ |
| 在页面里执行任意 JS | ✅ |
| 用户明确说「用我现在的浏览器」 | ✅ |
| 只是抓一个公开静态网页 | 优先 `web_fetch`，更快 |

## 前置检查（每次先做）

```powershell
# 桥是否在跑（没输出就是没跑，见「排障」）
Get-NetTCPConnection -LocalPort 43187 -State Listen -EA SilentlyContinue
```

然后取 token：

```js
const token = JSON.parse(
  require('node:fs').readFileSync(
    process.env.USERPROFILE + '\\.dsh\\browser-tabs\\pairing.json', 'utf8'
  )
).token;
```

## 最小可用脚本（推荐写法）

**用 `/cdp/tab/<tabId>`，不要用 `/cdp/direct`**。保存为 `.mjs` 运行（需要 `playwright-core`，见「依赖」）：

```js
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const token = JSON.parse(
  readFileSync(process.env.USERPROFILE + '\\.dsh\\browser-tabs\\pairing.json', 'utf8')
).token;
const headers = { Authorization: `Bearer ${token}` };

// 1. 先查标签页，挑出目标
const r = await fetch('http://127.0.0.1:43187/tabs', { headers });
const { tabs } = await r.json();
const target = tabs.find(t => t.url.includes('chatgpt.com')) || tabs.find(t => t.active) || tabs[0];
if (!target) throw new Error('没有可用标签页');

// 2. 连到这个标签页
const browser = await chromium.connectOverCDP(
  `ws://127.0.0.1:43187/cdp/tab/${target.tabId}`,
  { headers, timeout: 20000 }
);

// 3. 用
const pages = browser.contexts()[0].pages();
if (!pages.length) throw new Error('连接成功但没拿到 page，见「排障 / pages: 0」');

const page = pages[0];
console.log('URL  :', page.url());
console.log('标题 :', await page.title());
console.log('全文 :', (await page.evaluate(() => document.body.innerText)).length, '字符');

await browser.close();
```

**实测输出**（本机 2026-10-26）：

```
连接 tabId: 1262515240
pages: 1
标题 : chatgpt chat专员 — DeepSeek Harness
全文 : 6913 字符
```

## 两个端点怎么选

| 端点 | 行为 | 可靠性 |
|---|---|---|
| `ws://127.0.0.1:43187/cdp/tab/<tabId>` | 连**指定标签页** | ✅ **首选** |
| `ws://127.0.0.1:43187/cdp/direct` | 连**当前活动标签页** | ⚠️ 实测有时返回 `pages: 0` |

**为什么 `/cdp/direct` 不可靠**：它跟着「当前活动页」走，用户切标签页就变；而且在同一机器上连续使用后，实测出现过 `pages: 0` 的情况（同一时刻用 `/cdp/tab/` 完全正常）。

**结论：永远显式指定 tabId。** 只有图省事、且愿意在 `pages: 0` 时重试的场合才用 `/cdp/direct`。

## 常用操作

```js
// 全文（用 DOM 的 innerText，比选择器稳）
const text = await page.evaluate(() => document.body.innerText);

// 图片/视频等非文本资源
const urls = await page.evaluate(() =>
  [...document.images].map(i => ({ src: i.src, alt: i.alt }))
);

// 等待元素出现
await page.waitForSelector('.result', { timeout: 15000 });

// 填表 + 点击
await page.fill('input[name="q"]', '关键词');
await page.click('button[type="submit"]');

// 上传文件
await page.setInputFiles('input[type=file]', 'D:\\path\\to\\file.pdf');

// 截图
await page.screenshot({ path: 'shot.png' });
await page.screenshot({ path: 'full.png', fullPage: true });
await page.locator('.card').screenshot({ path: 'card.png' });

// 导航
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });

// 滚动加载更多
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(1500);
```

## 取网页全文的正确姿势

**优先 `document.body.innerText`**，不要一上来就用结构化选择器。

原因：工具的结构化接口常有单次返回上限，容易让人误判「内容缺失」，其实内容全在 DOM 里。

```js
const text = await page.evaluate(() => document.body.innerText);
// 长度对不上预期时，先怀疑选择器，不要怀疑平台
```

拿不到时按序退化：

1. `document.body.innerText`
2. `document.body.textContent`（innerText 会漏掉隐藏元素）
3. `await page.locator('body').innerText()`
4. `Ctrl+A` → `Ctrl+C` → 读系统剪贴板（用户手动配合）
5. 按 `h1/h2/h3` 分段抓取，拼完核对小标题数量与原页一致

**不许**用摘要或片段冒充全文。

## 依赖

`playwright-core`（不需要下载浏览器）：

```powershell
npm install playwright-core
```

**关键：Node 只在「脚本所在目录及其各级父目录」的 `node_modules` 里找模块。**

把脚本写到没有 `node_modules` 的地方（比如 `~/.dsh/skills/xxx/` 里）会直接报：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright-core'
```

**正确做法**：把脚本放在已经有 `playwright-core` 的目录下运行。

本机已知可用位置（`playwright-core` 已装在 `node_modules`）：

```
D:\BaiduSyncdisk\AI项目\小助手\
```

也可以自己建一个：

```powershell
mkdir D:\tmp\pwd-scripts; cd D:\tmp\pwd-scripts
npm init -y; npm install playwright-core
```

然后脚本就放在 `D:\tmp\pwd-scripts\` 下运行。

## 排障

### 43187 没在监听

插件没启动，或 DSH 没起来。

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\Lenovo\.dsh\launch-deepseek-harness.ps1"
```

### `socket hang up`

| 原因 | 处理 |
|---|---|
| Chrome 扩展没加载 | `chrome://extensions` 里确认扩展存在且**指向当前安装路径** |
| 扩展路径失效（插件改名或重装） | 移除旧扩展，重新「加载已解压的扩展程序」 |
| 没配对 | 打开 `http://127.0.0.1:43187/setup`，核对扩展弹出的四位码后批准 |

### `pages: 0`

Playwright 连上了但拿不到页面。

```powershell
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:43187/tabs
```

| 情况 | 处理 |
|---|---|
| 用的是 `/cdp/direct` | **换成 `/cdp/tab/<tabId>`** —— 实测 `/cdp/direct` 会出现 `pages: 0`，同时刻 `/cdp/tab/` 正常 |
| 目标是 `chrome://` 内部页 | 换成普通网页，受保护页面无法 attach |
| `/tabs` 返回空 | 扩展断开，重新配对 |

**注意**：`pages: 0` 时 `pages[0]` 是 `undefined`，直接访问会抛
`TypeError: Cannot read properties of undefined (reading 'url')`。
先判断 `pages.length`，再取元素。

### `page.title()` / `page.evaluate()` 一直不返回

**这是 targetId 不一致的典型症状**（2026-10-26 已修复，见仓库提交 `ac4946d`）。

如果复现，先确认装的是修复后的版本：

```powershell
$f = "C:\Users\Lenovo\.dsh\profiles\web\node_modules\playwright-direct\lib\host.js"
Select-String -Path $f -Pattern "targetInfo\?\.targetId" -Encoding utf8
```

没有输出 = 装的是旧版本，需要更新插件。

### `Target.attachToBrowserTarget: Not allowed`

**正常现象**，不用管。`chrome.debugger` 不支持浏览器级 target。只要不用 `newCDPSession` / `attachToBrowserTarget` 就行。

### 写超时保护，避免脚本卡死

```js
const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT: ' + label)), ms))
]);

await withTimeout(page.title(), 10000, 'title');
```

## 边界（必须知道的限制）

| 限制 | 说明 |
|---|---|
| **不能操作浏览器级 API** | `Target.attachToBrowserTarget`、`Browser.*` 多数不支持 |
| **不能操作 `chrome://` 页面** | 扩展商店、设置页等受保护页面 attach 会失败 |
| **一个连接一个标签页** | 多标签页就多连几次（见上） |
| **用户能看到操作** | 这是真实浏览器，不是无头。点击/滚动用户都看得见 |
| **标签页关掉连接就断** | 断开后重新 `connectOverCDP` |

## 安全约束

- 这是**用户真实的、已登录的浏览器**。只做用户要求的事。
- **不要**在用户不知情时提交订单、发送消息、删除数据。
- 涉及不可逆操作（付款、发帖、删文件）前，先向用户确认。
- 不要读取与任务无关的页面内容。

## 已验证的能力（2026-10-26 实机）

| 项目 | 结果 |
|---|---|
| `connectOverCDP` | ✅ |
| `page.url()` / `page.title()` | ✅ |
| `page.evaluate()` | ✅ 返回 42 |
| 全文读取 | ✅ 5527 字符 |
| DOM 查询 | ✅ 4292 节点 |
| `locator.count()` | ✅ 259 个 button |
| 截图 | ✅ 203 KB |
| 多标签页切换 | ✅ 连上 B 站并读到标题 |
| iframe 内操作 | ✅ |
| 刷新后上下文仍可用 | ✅ |
| 断开不关标签页 + 重连复用 | ✅ |

## 仓库

- 源码 / 安装：`https://github.com/wucong220/playwright-direct`
- 安装命令：`dsh plugin --profile web add github:wucong220/playwright-direct`
- 扩展目录：`C:\Users\Lenovo\.dsh\profiles\web\node_modules\playwright-direct\extension`
- 测试：`node --test tests/browser-model.test.mjs`（10 项）、`node tests/live-cdp.mjs --output-dir <dir>`（13 项）
