# Codex Mission Control · 终端 TUI

## 主入口：官方 Codex CLI 连续对话

日常使用直接在项目目录运行官方 `codex`，无需运行本项目启动脚本。Jev 插件已经安装到普通用户 Codex 配置；重开 CLI 会话后使用 `$jev-workflow 查看项目`，或通过 `/skills` 选择 `jev-workflow`。不要将尚未验证的 `/jev-workflow` 当成自定义命令。

- `/plugins`：打开原生插件目录，管理和启用插件。
- `/skills`：选择 `jev-workflow`；也可直接输入 `$jev-workflow 查看项目`。
- Jev 插件为新任务请求真实分流，后续执行使用当前 CLI 的工具与权限；普通追问沿用当前对话，不自动另开一次性执行器。
- 插件开始任务时自动打开 **TUI 风格独立小窗**（默认 840×740、可拖动缩放），不占用官方 CLI 的输入界面。窗口直接复用最初 demo 的字符渲染器：左侧 Astra 长栏、中央 Sol/Jev、横排三个角色、底部汇合和四行日志，保留原始配色与线框位置。Jev 决策和 CLI 上报的阶段会持续更新；角色名称保留参考布局含义，不代表已调用相应模型。关闭小窗不停止任务，后续状态更新不强制重开，新任务开始时才重新打开。
- 执行阶段由 CLI 报告，不冒充独立验收，也不推定调用过 Astra 或创建过其他代理。原生 CLI 负责审批；没有关闭沙箱或跳过确认。窗口是终端风格的原生显示窗，不是另一个 Codex 会话。
- 普通 `codex` 使用你已有的登录和配置。此次用户级安装仅新增 `jev-workflow@codex-tui-local` 及其本地来源，不改变原有模型、沙箱或其他插件设置。

```sh
codex
# 进入对话后输入：
$jev-workflow 查看项目
```

本地插件源位于 `plugins/jev-workflow`，安装时生成机器路径配置到 `runtime/cli-marketplace`，再使用官方 `codex plugin marketplace add` 与 `codex plugin add` 安装。首次安装或搬动此项目目录后运行一次 `npm run plugin:install`；本机已安装，不需要每次运行。原生插件说明：[插件管理](https://learn.chatgpt.com/docs/plugins)、[技能调用](https://learn.chatgpt.com/docs/build-skills)。

0.2.1 修复了 Windows 下分离启动 PowerShell 会直接退出的问题。窗口使用正常隐藏控制台启动，并等待带本次启动标识的“可见且已渲染”确认；启动失败会返回 `window_error`，具体记录在对应状态文件旁的 `.launch-error.json` 和 `.launch.stderr.log`。已运行的旧 CLI 需退出重开以加载修复。

`启动真实任务.cmd` / `npm start` 仅保留为可选的独立配置启动器，使用旧测试配置 `runtime/live-home`；它不是插件在普通 CLI 中运行的前提。`npm run cli:install` 仅安装到这套独立配置。

## 单次工作流原型与 Jev（保留）

`npm run live` 进入原来的单次真实任务原型；`npm run demo` 运行合成事件演示。下列验收门禁、只读文件截取和角色固定编排说明仅针对单次原型：

**Jev 分流 → Sol 修改任务副本 → 程序运行验收测试 → Astra 只读审查 → 保存结果。**

真实入口默认在当前终端显示 TUI 可视化工作流，不再打开独立图形窗口。任务输入、日志和工作流都保留在终端内。

Jev 条形图来自实际返回概率，Sol/Astra 来自实际线程及审查状态；Explorer/Researcher 明确标记未启用。V 切换图和日志，Q 返回报告；终端图至少 80×38，小于此尺寸时显示日志和放大提示。`node scripts/live.js --result "任务结果/result.json"` 在终端查看已保存结果，不登录、不重新调用模型，并明确标记为历史结果。

- Jev 使用 TypeSafe 官方 `GET /v1/models`、`POST /v1/systemone`，默认 `jev-latest`，返回实际选项、概率、置信度及 token 用量。
- Jev 判断 `execute` / `plan_review` / `clarify`；置信度低于 0.8 转前置计划审查。0.8 是第一版策略阈值，尚未经过本项目业务校准。它不批准命令、不替代测试、不替代最终审查。
- 仅把任务描述、工作区类型和固定角色说明发送给 TypeSafe；不会上传项目源代码、差异或命令输出。请不要在任务描述中放密钥。
- Codex 使用单独的 `runtime/live-home`，通过官方登录流程授权；不复制桌面应用的凭据，不更改全局配置。
- 修改只落在 `runtime/runs/<任务号>/workspace`。真实项目要求干净 Git 根目录，从当前 HEAD 创建独立 worktree，原目录未提交内容不会被带入或覆盖。
- 成功需要实际修改、指定测试退出码为 0、独立审查结构有效且通过。任务产物保存为 `result.json`、`changes.diff` 和工作副本；未跟踪的新文件保留在副本内。
- 当前支持中断、保存结果，不支持断点续跑、自动合入、自动安装项目依赖、无限返工或多执行者并行写入。

首次使用依次双击 `配置Jev密钥.cmd`、`登录真实任务.cmd`、`启动真实任务.cmd`。也可以在交互终端执行：

```sh
npm run jev:setup       # Windows 隐藏输入 TypeSafe API key，以当前用户 DPAPI 加密保存
npm run jev:check       # 只查 TypeSafe 模型目录
npm run live:login      # 官方 Codex 登录到此项目的独立环境
npm run live:check      # 只查 Codex 授权及模型目录
npm run live           # 项目目录直接回车，运行购物车真实验收任务
```

输入项目目录后可选择 **1 只读查看（默认）** 或 **2 修改代码**。只读查看支持普通目录、汇总目录和带未提交修改的项目，读取当前文件，不要求 Git 或测试命令，报告保存在本工具的 `runtime/runs/<任务号>/report.txt`。路径两侧粘贴的引号会自动去掉。只有修改代码模式才要求干净 Git 根目录与验收命令。

只读概览由本地程序读取目录清单和文本材料后交给 Codex 分析，分析回合关闭 shell 工具。读取范围最多 4 层、1200 个目录条目、30 个文件、80000 字符，优先 README、AGENTS、依赖清单和说明文档；跳过隐藏目录、依赖、构建产物及符号链接。`result.json` 记录提供给模型的文件列表和截断情况。它不是全仓库审计，也不声称运行过测试；返回 blocked 或没有已提供文件引用时不能标记完成。

TypeSafe key 在 [TypeSafe 控制台](https://console.typesafe.ai/home) 管理。非 Windows 系统可使用当前进程的 `TYPESAFE_API_KEY` 环境变量；密钥不传给 Codex 子进程。接口依据：[TypeSafe OpenAPI](https://api.typesafe.ai/openapi.json)。

真实项目可在提示中输入 Git 根目录、任务和验收命令参数，也可使用参数：

```sh
node scripts/live.js --mode edit --project "C:\path\to\repo" --goal "修复指定问题" --test-args '["node","--test"]'
node scripts/live.js --mode inspect --project "C:\path\to\project" --goal "查看项目"
```

可通过 `--worker-model`、`--reviewer-model` 显式指定模型。默认执行 `gpt-6.1-sol`、审查 `gpt-6-astra`；目录缺失或实际返回模型不符时停止，不静默替换。审批显示服务端请求完整内容，输入 y 只批准本次操作，其他输入拒绝；Q 中断任务。

**验证边界：**原型回归测试使用模拟 Jev / Codex 响应，但真实创建 Git 副本、修改夹具、运行 Node 测试。此前已完成一轮真实 Jev 分流与只读文档分析，不能据此声称真实代码修改链路通过。下文 DEMO ONLY 限制仅指 `npm run demo`，旧网页入口仍保持只读。

在 CMD / PowerShell / Windows Terminal / Linux 终端内运行的动态全屏界面。零运行时依赖，用 Node.js ANSI 绘制，**不需要浏览器或 HTTP 服务**。

当前版为 **DEMO ONLY**：界面和日志读取 Controller 的合成工作流事件，未连接真实 Codex 推理。没有伪造 token、CPU、速度或费用；旋转指示只是装饰动画，本地经过时间会明确标注。

## 立即运行

需要 Node.js 22+，无需 npm install。

```sh
cd codex-control-panel
npm run demo
```

等价命令：

```sh
node scripts/tui.js
```

默认视觉参考原视频的竖向代理树：左侧 Astra 长栏，右侧 Sol → Jev 示意层 → 三代理 → 回到 Sol 审查；连接线带装饰光点。

建议终端为 **120 列 × 40 行**；可用全屏或缩小字体。参考布局需要至少 80×40；更宽终端将约120列图居中。80×32 至39行自动用紧凑布局，过小会提示放大。非交互式终端（重定向/管道）会清晰提示并退出，不输出满屏转义序列。

## 按键

| 按键 | 操作 |
|---|---|
| 1 | 成功协作演示 |
| 2 | 连续错误，升级 Astra 审查并暂停 |
| 3 | 审批请求拒绝，暂停执行 |
| R | 重播当前场景 |
| L | 开启/关闭循环播放 |
| V | 切换参考代理树/紧凑布局 |
| ↑ / ↓ 或 K / J | 滚动事件日志 |
| Q / Ctrl+C / Ctrl+D | 退出并恢复终端 |

默认自动播放成功场景，一次约 20–25 秒。默认不循环；L 开启后，场景结束会稍停再重播。切换场景会先中断并收尾旧演示，不混入新场景。

## 界面内容

- 原视频结构的青/蓝/绿/紫代理树、柔和24位色、加粗标题、Unicode单线框和动态光点
- Jev 框明确标为 VISUAL DEMO / NOT CONNECTED；条形图只是固定示意，不是置信度或fork遥测
- Sol 主节点是 REFERENCE SCHEMATIC；不表示已实现真实自主主控
- Explorer / Researcher：Luna，gpt-6-luna
- Worker：Sol，gpt-6.1-sol
- Architect：Astra，gpt-6-astra
- 任务树、执行状态、计划/连续错误/完成审查关卡
- 实时滚动的合成协议事件日志
- 明显的 DEMO、NO AUTH、NO MODEL CALLS 标识

角色与模型是演示预设，不证明它们真的进行了推理。“通过”来自合成夹具，不是真实代码测试证据。

## 安全与明确范围

TUI 入口硬禁用真实 connect/startRun，关闭磁盘审计，不启动 Codex 子进程、HTTP 服务或网络请求，也不读取账号凭据。即使设置了旧网页的 live 环境变量，此终端入口仍然只运行演示。

TUI 只复用 Controller 的状态和事件层，**当前未完成真实 CLI / app-server 接入**。它还不能真正自动编辑代码、执行测试、创建 PR 或让 Sol 自主调度其他模型。下一步接入这些能力需要另外实现和授权，不能通过去掉 DEMO 标记冒充已实现。

输出会过滤来自状态文本的 CSI/OSC/控制字符，并按终端列宽处理 CJK。Q、Ctrl+C、SIGTERM 等退出路径恢复光标、alternate screen 与原始终端模式。程序无法对 SIGKILL、终端崩溃或被强制关闭后的状态做清理保证。

## Windows 使用说明

在已经装好 Node.js 的 CMD、PowerShell 或 Windows Terminal 中运行相同命令。现代 Windows Terminal 通常能显示 ANSI 配色；默认使用Unicode边框/光点，如果终端显示错位可运行 node scripts/tui.js --ascii 改用ASCII图形。旧版 CMD 的 ANSI 支持、字体和宽字符显示可能不同。

**本次没有在 Windows 实机测试。** 已验证的是我们自己的 Linux 云端终端和 Linux PTY。Windows 按键、颜色、退出恢复仍需实测，不能将 Linux 结果当成 Windows 验证。

## 测试

```sh
npm test                 # 33 项 Node 测试，合成协议与 TUI 渲染
npm run test:tui          # 10 项 TUI 专项测试
npm run check            # 14 个 JS 文件语法检查
python3 scripts/test-tui-pty.py  # Linux PTY：按键、resize、退出、终端模式恢复
```

测试均没有进行真实模型推理。PTY 脚本仅适用于支持 pty/termios 的系统，Windows 不应直接运行该测试。

结果：33/33 自动化测试通过；14 文件语法检查通过；Linux PTY 键盘/resize/清理检查通过。已在可见云桌面终端实际全屏启动并检查布局。详见 docs/test-report.md 和 docs/tui-pty-result.json。

## 保留的可选网页前端

先前网页原型保留为可选工具，**不再是默认入口**：

```sh
npm run web
```

其说明在 docs/web-prototype.md。旧的 npm run probe 只用于隔离 CLI 版本/握手/模型目录检查，和当前 TUI 演示无关。2026-10-08 的历史探测结果在 docs/probe-result.json：握手成功但独立环境未登录，没有真实推理。

## 项目结构

- scripts/tui.js：默认终端入口与按键、循环、退出处理
- src/tui-render.js：无 I/O 的 ANSI 全屏渲染器
- src/controller.js / src/state.js：工作流夹具及状态事件
- test/tui.test.js：TUI 渲染、宽度、安全与非 TTY 回归
- scripts/test-tui-pty.py：Linux 真实伪终端冒烟测试
- public/ / src/server.js：可选旧网页前端
- examples/agents/：独立角色 TOML 示例，不自动加载
- runtime/：运行期文件，不随源码包交付

参考协议：https://learn.chatgpt.com/docs/app-server

参考角色配置：https://learn.chatgpt.com/docs/agent-configuration/subagents

## 视觉参考

布局经实际查看原视频关键帧后实现：https://x.com/thedelost/status/2105398038026195279 。没有复制视频中的价格、token数或fork数量当作真实数据；原视频素材不包含在源码包内。
