# 旧网页前端说明（可选）

当前默认入口已改为终端 TUI。此页面描述先前网页原型；启动网页请使用 npm run web。

# Codex Control Panel · 中文本地原型

独立中文网页仪表盘 + Node.js 后端 + 后端自行拥有的 Codex app-server（stdio）。不依赖 Codex 官方桌面 UI，也不接管已有 Codex 进程。

## 当前验证结果

在 **Linux 云端测试环境**构建并运行，Node.js v24.19.0，Codex CLI 0.159.2。

- 真正完成了隔离配置下的 CLI 版本检查、app-server 初始化握手、model/list 与 account/read。
- 模型目录包含 gpt-6-luna、gpt-6.1-sol、gpt-6-astra。目录命中 **不代表账户有权使用**。
- 独立运行环境没有登录：**没有进行真实模型推理，没有把演示当成真实执行**。
- 自动化测试覆盖协议传输、角色工作流、审查门禁、模型不匹配、审批拒绝、中断竞争和 HTTP 边界，详见 docs/test-report.md。
- **未在 Windows 上测试。** Linux 的通过结果不能等同于 Windows 验证。

## 运行

需要 Node.js 22+。运行时零第三方依赖，不必 npm install。

```sh
cd codex-control-panel
npm run web
```

在运行它的电脑浏览器打开 http://127.0.0.1:4317 。仅监听 127.0.0.1；不会公开部署。另一个电脑无法直接打开该地址。

- “体验演示”：不用登录或安装 Codex。三个合成场景分别验证成功、连续错误升级、权限拒绝暂停。
- “连接 Codex”：在专用 HOME/CODEX_HOME 下启动自己的 app-server，并显示真实连接、账户授权及模型目录状态。
- “启动任务”：默认禁用。需要独立环境中的既有授权、精确模型命中，以及操作者显式启用；见下文。
- Ctrl+C：关闭网页后端及其拥有的 app-server。不会结束其他 Codex 进程。

系统找不到 codex 时，可在启动 Node 前将 CONTROL_PANEL_CODEX_BIN 设为官方可执行文件的绝对路径。该路径只能由本机终端配置，网页不能更改。不会自动下载 CLI 或自动安装插件。

```sh
CONTROL_PANEL_CODEX_BIN=/absolute/path/to/codex npm run web
PORT=4318 npm run web
```

官方 CLI 说明：https://learn.chatgpt.com/docs/cli

## 真实工作流的范围

此版实现的是 **由后端编排的多个真实角色线程**，不是让模型自由递归创建代理：

1. Explorer / Researcher：gpt-6-luna，独立线程并行分析内置购物车夹具与测试边界。
2. Architect：gpt-6-astra，按 JSON Schema 给出计划审查结果。后端再次验证完整结构，只有 pass 才能继续。
3. Worker：gpt-6.1-sol，生成只读补丁建议和测试建议。
4. 两次已确认的 Worker 终态失败：暂停并交给 Astra 诊断；不自动恢复。
5. Architect：独立完成审查，pass 才标记完成。

这些真实线程路径已通过 **合成 stdio 服务端**测试，但未通过付费模型端到端推理验证。只返回建议，不改代码、不实际执行测试。推理努力值使用模型默认值；若 thread/start 返回该字段，则记录返回值，不宣称固定或验证了某个 effort。

原生子代理事件也实现了映射：collabAgentToolCall、receiverThreadIds、agentsStates、subAgentActivity、parentThreadId。当前真实角色流程关闭原生递归代理；演示中的原生子代理节点是**合成协议夹具**，不是原生代理实际跑过的证据。

examples/agents/ 提供当前独立 TOML 格式的四个角色示例。这些示例不会自动加载或写入全局配置。

## 安全边界与启用条件

**独立 HOME/CODEX_HOME、read-only 模式、关闭 shell 特性，不构成操作系统级文件读取隔离。提示词也不是安全边界。**

原型默认只做连接诊断。要运行真实推理，操作者须先提供一个真正隔离、只有无敏感资料夹具的容器/系统环境，并自行通过官方流程配置该环境的授权。此项目不会搜索、复制、导入、展示或替你登录宿主机的凭证，不提供网页登录/密钥输入接口。

确认上述条件后，终端才能同时设置 CONTROL_PANEL_ISOLATED_ENV=1 与 CONTROL_PANEL_ENABLE_LIVE=1。两者是操作者声明，面板不能证明外部隔离正确。未认证、缺少指定模型、有效模型/工作目录/沙箱不符，都会拒绝推理；不静默降级或替换模型。此开关没有在本次真实推理测试中开启。

其他约束：

- 仅固定 HTTP 路由；不提供任意 RPC、shell、process/spawn、文件浏览、配置写入或任意 cwd/model 参数。
- localhost Host 校验、同源校验、跨站请求拒绝、每次后端启动生成的 HttpOnly/SameSite 会话 cookie、POST 自定义头、请求体大小上限、静态文件白名单和 CSP。
- 子进程环境采用白名单；不继承宿主 OPENAI_API_KEY、令牌、代理凭证或 NODE_OPTIONS。
- 固定 project-local runtime/home、runtime/codex-home、runtime/tmp 与 fixture-workspace；拒绝其路径上的符号链接。运行状态目录限制当前用户访问。
- 所有命令、文件、权限和 MCP 交互审批请求拒绝并暂停。未知交互请求失败关闭。没有网页“自动同意”开关。
- 只接受本进程拥有的角色线程和已验证子线程通知；处理请求超时、中断、迟到响应及旧运行竞争。不确定是否开始的推理不会自动重试。
- 浏览器接收精简事件，不接收原始命令参数/输出、凭证、账户资料或私人推理。字符串转义使用 textContent；常见凭证形态做额外脱敏，但不能代替隔离。
- 审计记录 runtime/audit.jsonl 包含精简公开事件；UI 保留最近 300 条。审计文件目前无防篡改签名、无轮换，生产使用前应补充保留策略。
- 这不是经过生产安全审计的远程控制服务。不要绑定 0.0.0.0、公开转发端口或部署到公网。

## 验证命令

```sh
npm test          # Node 内建测试；包含合成 stdio 服务端，不调用模型
npm run check    # JS 语法检查；不是 ESLint 或 TypeScript 编译
npm run probe    # 真正的版本/握手/目录/授权状态检查；不启动推理
npm run test:ui  # 可选 Playwright + 本机 Chromium；需要自行安装测试依赖
```

浏览器自动化脚本需要 Playwright 及 Chromium。应用运行本身不需要它们。可以按 Playwright 官方方式在项目本地配置测试依赖，或使用已安装环境；不要把测试所需的浏览器开关当成生产安全设置。UI 脚本默认假定同机 4317 上已启动面板，可通过 CONTROL_PANEL_URL 和 CHROMIUM_PATH 配置。

## Windows 注意事项

- 所有应用入口用 Node、path 和 spawn(shell:false)，没有 bash 启动脚本或 UNIX socket 传输依赖；app-server 通过标准输入输出通信。
- PowerShell：$env:CONTROL_PANEL_CODEX_BIN='C:\\path\\to\\codex.exe'; npm run web。
- 请指定官方 codex.exe 或在 WSL 中运行。不通过 cmd.exe 执行 .cmd/.bat 包装器；本原型未实现包装器解析。
- Windows ACL、进程关闭、路径行为、官方沙箱和浏览器均需本机验证，不能用这里的 POSIX chmod 结果证明 Windows 隔离。
- 图形浏览器测试脚本的 Chromium 默认路径是 Linux 路径；Windows 需要显式 CHROMIUM_PATH。

## 目录

- src/：HTTP 服务、stdio JSON-RPC、工作流、状态投影、安全运行环境
- public/：响应式中文前端，无构建依赖
- fixture-workspace/：无秘密的内置示例
- test/：协议夹具与回归测试
- scripts/：语法、连接与可选浏览器验证
- examples/agents/：独立角色 TOML 示例，不自动启用
- docs/：测试说明、真实探测结果、协议依据
- runtime/：运行期文件，不应提交、分享或打包

## 参考

- 官方 App Server：https://learn.chatgpt.com/docs/app-server
- 官方 Subagents：https://learn.chatgpt.com/docs/agent-configuration/subagents
- 协议字段同时核对本机 0.159.2 的 codex app-server generate-ts 输出。生成内容留在 runtime/，不随源码交付。
