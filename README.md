# Codex Mission Control · 终端 TUI

在 CMD / PowerShell / Windows Terminal / Linux 终端内运行的动态全屏界面。零运行时依赖，用 Node.js ANSI 绘制，**不需要浏览器或 HTTP 服务**。

当前版为 **DEMO ONLY**：界面和日志读取 Controller 的合成工作流事件，未连接真实 Codex 推理。没有伪造 token、CPU、速度或费用；旋转指示只是装饰动画，本地经过时间会明确标注。

## 立即运行

需要 Node.js 22+，无需 npm install。

```sh
cd codex-control-panel
npm start
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
