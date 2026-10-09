# 验证报告 · Terminal TUI v0.3

日期：2026-10-09。测试环境：自己的 Linux 云端执行环境与可见云桌面终端，不是用户电脑，也不是 Windows。

## 本次已通过

| 项目 | 结果 | 证据 |
|---|---|---|
| Node 自动化 | 33/33 通过 | test-console.txt |
| TUI 专项 | 10/10，包含在总数33中 | test/tui.test.js |
| JS 语法 | 14 文件通过 | check-console.txt |
| Linux 实际 PTY | alternate screen、光标、按键、resize、退出和termios恢复通过 | tui-pty-result.json |
| 可见桌面终端 | 已实际全屏运行，布局和DEMO标识可见 | 本次可见云桌面人工检查 |

TUI 专项覆盖：CSI/OSC52/控制字符/双向控制符过滤；CJK和组合符列宽；120×40画面边界与DEMO标志；窄屏提示；错误与审批暂停状态；非TTY清晰退出；极小/零尺寸不越界。

PTY检查使用真实终端输入：1/2/3/R/L/V、方向键、窗口由120×40缩为60×20再恢复、同一输入块rq仍识别退出；确认退出码0并恢复ICANON/ECHO、光标及alternate screen。另经独立检查，单Q、Ctrl+C、SIGTERM退出的termios恢复通过。

## 运行真实性

- TUI不启动HTTP，不连接app-server，不启动Codex进程，不读取凭据。
- 即使环境中两个旧live开关均为1，TUI仍保持demo-only。
- 状态来自Controller合成事件；显示的节点、审查与工具结果不是模型/测试真实运行记录。
- 装饰动画、合成事件、本地经过时间均明确标注；不展示伪造的token/CPU/费用遥测。
- npm start现在启动TUI；旧网页仅通过npm run web启动。

## 未完成与限制

- TUI实时CLI/app-server推理接入：未实现，当前只做演示。
- 真实模型推理、自动写代码/执行测试、Sol自主多模型调度：未验证/未完成。
- Windows/macOS终端：未测试。Linux ANSI/PTY结果不能代替Windows实机验证。
- 强制SIGKILL、终端崩溃或程序运行环境被销毁时不能保证清理。
- TypeScript/ESLint：未采用，不声称类型检查或lint通过。

## 历史连接诊断（2026-10-08）

先前网页原型曾在隔离配置下验证Codex CLI 0.159.2、initialize/initialized、model/list和account/read。8个模型目录包含Luna、6.1 Sol及Astra，账户未登录，因此没有真实推理。见probe-result.json。此历史结果不代表当前TUI已经接上CLI。

## 参考视频视觉升级

已实际查看0秒和5秒关键帧，复刻代理树拓扑与柔和配色，新增Astra侧栏触发高亮、Sol主节点、Jev视觉示意、三代理、回Sol审查及4行日志。测试覆盖80×40、90×46、120×40、168×40、200×70尺寸；宽屏居中、Unicode/ASCII等列宽、24位背景色、动画不修改Controller状态。Jev示例条形图不代表真实路由；Sol主控标为示意；所有遥测真实性边界保持不变。
