# Protocol and security review

Reviewed on 2026-10-08 against the project's generated Codex 0.159.2 `runtime/protocol` schemas and the official [App Server](https://learn.chatgpt.com/docs/app-server) and [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) documentation. The generated types are the version-specific authority; online examples can describe newer or experimental fields. No host Codex state, sessions, credentials, or secrets were inspected. This is a schema/design review, not a completed implementation audit or penetration test.

## Transport and state

- Own one pinned `codex app-server` child over stdio. The wire is newline-delimited JSON with request IDs, without a required `jsonrpc` member. Complete `initialize`, send `initialized`, then issue requests. Keep reading both notifications and server-initiated requests. [Official transport/lifecycle reference](https://learn.chatgpt.com/docs/app-server#protocol).
- Distinguish response (`id` and result/error), server request (`id` and method), and notification (method, no id). IDs are strings or numbers; retain the exact ID and distinguish `7` from `"7"`.
- `v2/ThreadStatus.ts` is a tagged object: `{type:"notLoaded"}`, `{type:"idle"}`, `{type:"systemError"}`, or `{type:"active",activeFlags:[...]}`. Flags are `waitingOnApproval` and `waitingOnUserInput`. Neither `idle` nor `notLoaded` means a successful task result.
- `thread/status/changed` carries `{threadId,status}`. `turn/completed` establishes a turn's terminal status: `completed`, `interrupted`, or `failed`. A running turn is `inProgress`.
- `item/started` and `item/completed` carry `item`, `threadId`, `turnId`, and respectively `startedAtMs` or `completedAtMs`. Upsert by thread/turn/item identity; completed snapshots should replace partial state. Thread timestamps use seconds, item lifecycle timestamps use milliseconds.
- `Thread.turns` is normally empty in list/start/events; only resume/fork/read-with-includeTurns hydrates it. An empty array does not establish no history. `thread/list` defaults to interactive sources; explicitly include supported `subAgent` source kinds for a complete hierarchy and handle pagination.

## Subagents and collaboration

The following fields are established directly by `v2/ThreadItem.ts`:

```ts
type CollabItem = {
  type: "collabAgentToolCall";
  id: string;
  tool: "spawnAgent" | "sendInput" | "resumeAgent" | "wait" | "closeAgent"
      | "sendMessage" | "followupTask" | "interruptAgent" | "listAgents";
  status: "inProgress" | "completed" | "failed" | "interrupted";
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt: string | null;
  model: string | null;
  reasoningEffort: string | null;
  agentsStates: Record<string, {
    status: "pendingInit" | "running" | "interrupted" | "completed"
          | "errored" | "shutdown" | "notFound";
    message: string | null;
  } | undefined>;
};
type ActivityItem = {
  type: "subAgentActivity";
  id: string;
  kind: "started" | "interacted" | "interrupted" | "completed";
  agentThreadId: string;
  agentPath: string;
};
```

`reasoningEffort` above is abbreviated; use the generated enum rather than this illustrative string. The call status and each target agent's status are different concepts: a completed spawn call does not mean its worker has finished.

`v2/Thread.ts` supplies `sessionId`, `parentThreadId`, `forkedFromId`, `agentNickname`, and `agentRole`. Prefer explicit `parentThreadId` for hierarchy; a fork is not necessarily a child agent. The alternate v2 source shape is `{subAgent:{thread_spawn:{parent_thread_id,depth,agent_path,agent_nickname,agent_role}}}`. The legacy root `SessionSource.ts` instead spells its key `subagent`; do not use that spelling to parse v2 `Thread.source`. Treat relationships inferred from collaboration events as provisional until thread metadata confirms them. Unknown types should remain visible as safe fallback records.

Subagents inherit runtime sandbox/approval overrides. Custom agent files may influence model and effort. Therefore a nickname or role is not a security boundary, and child requests need the same handling as parent requests. [Official subagent controls](https://learn.chatgpt.com/docs/agent-configuration/subagents#approvals-and-sandbox-controls).

## Fail-closed server requests

Respond on stdio using the original server request ID, never through arbitrary browser-provided RPC. The installed schemas specify these denial bodies:

| Server request | Result payload |
|---|---|
| `item/commandExecution/requestApproval` | `{ "decision": "decline" }` |
| `item/fileChange/requestApproval` | `{ "decision": "decline" }` |
| `item/permissions/requestApproval` | `{ "permissions": {}, "scope": "turn" }` |
| `mcpServer/elicitation/request` | `{ "action": "decline", "content": null, "_meta": null }` |
| Legacy `execCommandApproval` / `applyPatchApproval` | `{ "decision": { "denied": { "rejection": "Approvals are disabled in this dashboard." } } }` |

For `item/tool/call`, return a typed failure (`success:false`, empty `contentItems`) when dynamic tools are unsupported. `item/tool/requestUserInput` uses an `answers` map; an empty answer map is a skip, not an approval denial. Never translate it into an automatic Accept. Unsupported authentication refresh, attestation, and unknown methods should receive a structured JSON-RPC error rather than a fabricated result. Do not opt into attestation or extended capabilities the client cannot implement.

`serverRequest/resolved` carries `{threadId,requestId}` and clears pending UI state. Clean up pending requests on child exit, turn termination, and reconnect without replaying approvals.

## Security recommendations

These are review recommendations, not claims that the implementation already enforces them.

1. Bind only `127.0.0.1` (or explicitly controlled loopback). Validate Host and Origin, reject cross-site requests including inappropriate Fetch Metadata, and require a per-process unguessable session/CSRF token for mutations. Protect event/history reads too. Loopback alone does not protect against a malicious website or another local user. Do not enable permissive CORS or serve this through a public proxy.
2. Keep a fixed method/route allowlist. Build RPC params on the server from validated minimal inputs, rather than forwarding browser objects. No generic RPC, shell, process, arbitrary path, filesystem, configuration, plugin, credential, login, or approval-grant endpoints. The official documentation specifically warns that `thread/shellCommand` executes outside the thread sandbox. [Source](https://learn.chatgpt.com/docs/app-server#run-a-thread-shell-command).
3. Use a pinned executable, argv array, `shell:false`, fixed realpath-checked cwd, and a minimal child environment. Never blindly inherit `process.env`: credentials can appear in environment variables even with a new HOME. Keep isolated HOME/CODEX_HOME directories private, out of static serving, and excluded from version control and deliverable archives.
4. Isolated HOME/CODEX_HOME prevents reuse of ordinary user configuration and sessions; it does not confine filesystem reads. `read-only` constrains writes, not visibility. For a strong isolation claim, run in an OS/container boundary that exposes only an approved fixture/workspace and required binaries. Do not mount host homes, credentials, unrelated repositories, or sensitive sockets. Check symlinks, config discovery from ancestor directories, and inherited environment.
5. Pin read-only/no-network policy server-side at thread creation and every turn; do not permit model, client, or resume data to supply sandbox/cwd/config overrides. `approvalPolicy:"never"` suppresses fresh approvals; it does not prohibit sandbox-permitted tool execution. For the installed turn schema use `{type:"readOnly",networkAccess:false}`.
6. Authorize thread IDs against this process's owned roots and verified descendants, not mere possession of an ID. Never inspect or import other Codex session stores. Keep runtime state, logs, SSE streams, and HTTP errors free of credentials and unneeded absolute paths. A process-scoped event stream must not become a feed for other unrelated threads.
7. Treat all model text, tool output, filenames, URLs, and Markdown as untrusted. Render text safely; no `innerHTML`, executable markup, automatic URL fetch, unsafe link protocols, or raw reasoning output. Prefer user-facing agent text and status summaries.
8. Bound HTTP bodies, prompt length, JSONL line buffers, event/history retention, concurrent requests, subprocess stderr, and SSE clients. Honor backpressure; timeout pending RPCs and reject them on child exit. Avoid automatic mutation retries after uncertain delivery. Track a process generation so old callbacks cannot update a replacement server.
9. Graceful stop should close stdin/interrupt known work, then use a bounded termination fallback for this owned child tree. Do not kill arbitrary PIDs supplied by the browser. Never show a disconnected or exited child as healthy.

## Suggested targeted tests

- v2/legacy source casing, multi-target collaboration, provisional hierarchy, and unrelated forks.
- Active waiting flags, interrupted/failed turns, unloaded threads, and item completion after streamed deltas.
- Every known denial shape, unknown server requests, ID zero/string IDs, and no approval replay.
- Cross-origin and hostile Host rejection; missing/bad mutation token; unowned thread IDs; oversized inputs.
- No raw RPC/process/shell/config routes, fixed security parameters, environment allowlist, bounded output, and child exit cleanup.
- Explicitly label fixture/demo data; an authenticated live turn is a separate check from local protocol and fixture tests.
