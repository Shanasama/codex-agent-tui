import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
export const ROLES = [
  { id: 'explorer', name: '代码探索', model: 'gpt-6-luna' },
  { id: 'researcher', name: '资料研究', model: 'gpt-6-luna' },
  { id: 'worker', name: '执行工程师', model: 'gpt-6.1-sol' },
  { id: 'architect', name: '架构审查', model: 'gpt-6-astra' },
];
export function safeText(value, max = 4000) {
  return String(value ?? '').replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~-]+|(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*\S+)/gi, '[REDACTED]').slice(0, max);
}
export class StateStore extends EventEmitter {
  constructor() {
    super(); this.state = {
      mode: 'disconnected', connection: { status: 'disconnected', message: '等待连接独立 Codex app-server', authenticated: false, ready: false, models: [] },
      roles: ROLES.map(r => ({ ...r, available: null, status: 'idle' })), run: null, events: [],
    }; this.errorKeys = new Map(); this.seenFailures = new Set();
  }
  snapshot() { return structuredClone(this.state); }
  changed() { this.emit('change', this.snapshot()); }
  event(type, message, extras = {}) {
    const event = { id: randomUUID(), time: new Date().toISOString(), type, message: safeText(message), source: this.state.mode === 'demo' ? 'fixture' : 'app-server', ...extras };
    if (event.detail != null) event.detail = safeText(event.detail, 1200);
    this.state.events.push(event); this.state.events = this.state.events.slice(-300);
    this.emit('audit', event); this.changed(); return event;
  }
  newRun(goal, mode) {
    this.errorKeys.clear(); this.seenFailures.clear(); this.state.mode = mode;
    this.state.roles.forEach(r => r.status = 'idle');
    this.state.run = { id: randomUUID(), status: 'running', goal: safeText(goal), stage: 'exploration', threads: [], reviews: [
      { type: 'plan', status: 'pending', message: '执行前由 Astra 审查计划' },
      { type: 'repeated-error', status: 'watching', message: '相同失败达 2 次即暂停并升级审查' },
      { type: 'completion', status: 'pending', message: '交付前必须通过独立审查' },
    ], errorCount: 0, result: null };
    this.changed();
  }
  thread(id, props = {}) {
    if (!this.state.run) return null;
    let thread = this.state.run.threads.find(t => t.id === id);
    if (!thread) { thread = { id, status: 'idle', role: 'unknown', title: 'Codex 线程', origin: 'app-server', items: [], ...props }; this.state.run.threads.push(thread); }
    else Object.assign(thread, props);
    return thread;
  }
  review(type, status, message) {
    if (!this.state.run) return;
    const item = this.state.run.reviews.find(r => r.type === type);
    if (item) Object.assign(item, { status, message: safeText(message) });
    this.event('review', message, { detail: `${type}: ${status}` });
  }
  failItem(key, fingerprint) {
    if (this.seenFailures.has(key)) return;
    this.seenFailures.add(key);
    const run = this.state.run; if (!run) return;
    run.errorCount++;
    const count = (this.errorKeys.get(fingerprint) || 0) + 1; this.errorKeys.set(fingerprint, count);
    if (count >= 2 && run.status === 'running') {
      run.status = 'paused'; run.stage = 'repeated-error';
      this.review('repeated-error', 'blocked', '相同失败已发生 2 次，执行暂停，等待 Astra 审查。');
      this.emit('repeatFailure', { fingerprint, count });
    }
  }
  ingest({ method, params = {} }) {
    const run = this.state.run; if (!run) return;
    const threadId = params.threadId || params.thread?.id;
    const thread = threadId ? this.thread(threadId) : null;
    const base = { threadId, turnId: params.turnId || params.turn?.id, role: thread?.role };
    if (method === 'thread/started') {
      const parentId = params.thread?.parentThreadId || params.thread?.source?.subAgent?.thread_spawn?.parent_thread_id;
      if (parentId) this.thread(threadId, { origin: 'native-subagent', parentId });
      this.event('thread', '线程已创建', base);
    } else if (method === 'thread/status/changed') {
      if (thread) { thread.status = params.status?.type || 'unknown'; thread.activeFlags = params.status?.activeFlags || []; }
      this.event('thread', `线程状态：${thread?.status}`, base);
    } else if (method === 'turn/started') {
      if (thread) { thread.status = 'running'; thread.turnId = params.turn?.id; }
      this.event('turn', '回合开始', base);
    } else if (method === 'turn/completed') {
      const status = params.turn?.status || 'unknown';
      if (thread) { thread.status = status; thread.turnId = null; }
      this.event('turn', `回合${status === 'completed' ? '完成' : `结束：${status}`}`, base);
      if (status === 'failed') this.failItem(`turn:${base.turnId}`, `turn:${safeText(params.turn?.error?.message || 'failed', 200)}`);
    } else if (method === 'item/started' || method === 'item/completed') {
      const item = params.item || {}; const done = method === 'item/completed';
      if (item.type === 'reasoning') return; // Never surface private reasoning content.
      if (thread) {
        let output = thread.items.find(i => i.id === item.id);
        if (!output) { output = { id: item.id, type: item.type }; thread.items.push(output); }
        output.status = item.status || (done ? 'completed' : 'running');
        // Raw tool arguments, paths, output, account data, prompts are not exposed.
        if (item.type === 'agentMessage' && done) { output.text = safeText(item.text); thread.summary = output.text; }
        if (item.type === 'commandExecution') output.exitCode = item.exitCode;
        thread.items = thread.items.slice(-80);
      }
      if (item.type === 'collabAgentToolCall') {
        for (const id of item.receiverThreadIds || []) {
          const status = item.agentsStates?.[id]?.status || 'pendingInit';
          this.thread(id, { parentId: item.senderThreadId || threadId, model: safeText(item.model, 100), origin: 'native-subagent', status, title: '原生子代理', role: 'subagent' });
        }
        this.event('subagent', `原生子代理工具：${safeText(item.tool, 80)} · ${safeText(item.status, 80)}`, base);
      } else if (item.type === 'subAgentActivity') {
        this.thread(item.agentThreadId, { parentId: threadId, origin: 'native-subagent', title: '原生子代理', role: 'subagent', status: item.kind || 'active' });
        this.event('subagent', `子代理活动：${safeText(item.kind, 80)}`, base);
      } else this.event(item.type === 'agentMessage' ? 'message' : 'tool', `${safeText(item.type, 80)} · ${done ? (item.status || 'completed') : 'started'}`, { ...base, detail: item.type === 'agentMessage' && done ? safeText(item.text, 1200) : undefined });
      if (done && (item.status === 'failed' || (item.type === 'commandExecution' && item.exitCode != null && item.exitCode !== 0))) {
        this.failItem(`item:${item.id}`, `${item.type}:${safeText(item.command || item.tool || '', 200)}`);
      }
    } else if (method === 'turn/plan/updated') {
      this.event('plan', '代理更新了计划；这不等于审查通过', base);
    } else if (method === 'error') {
      this.event('error', safeText(params.error?.message || 'App-server error'), base);
    }
    this.changed();
  }
}
