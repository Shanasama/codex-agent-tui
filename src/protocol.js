import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { isolatedEnv, WORKSPACE, CODEX_HOME, codexCommand, assertSafePath } from './runtime.js';

// Backend-only allowlist. There is no HTTP JSON-RPC proxy.
const ALLOWED = new Set(['initialize', 'model/list', 'account/read', 'thread/start', 'turn/start', 'turn/interrupt', 'command/exec']);
export class RpcClient extends EventEmitter {
  constructor({ command, args, cwd = WORKSPACE, env, timeoutMs = 20000, runtimeHome = CODEX_HOME, allowCommandExec = false } = {}) {
    super(); this.command = command; this.args = args; this.cwd = cwd;
    this.env = env; this.runtimeHome = runtimeHome; this.allowCommandExec = allowCommandExec; this.timeoutMs = timeoutMs; this.nextId = 1;
    this.pending = new Map(); this.buffer = ''; this.child = null;
  }
  async start() {
    if (this.child) throw new Error('App-server already running');
    await assertSafePath(this.cwd, true);
    await assertSafePath(this.runtimeHome, true);
    const command = this.command || await codexCommand();
    this.child = spawn(command, this.args || ['app-server', '--listen', 'stdio://'], {
      cwd: this.cwd, env: this.env || isolatedEnv(), stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true, shell: false,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', data => this.consume(data));
    // Do not forward stderr (may contain paths/account/provider details) to UI.
    this.child.stderr.on('data', () => this.emit('diagnostic', 'app-server emitted a diagnostic; raw content withheld'));
    this.child.stdin.on('error', () => this.fail(new Error('App-server stdin closed')));
    this.child.on('error', () => this.fail(new Error('Cannot start Codex app-server')));
    this.child.on('exit', (code, signal) => {
      this.fail(new Error(`App-server exited (${code ?? signal})`));
      this.child = null; this.emit('closed', { code, signal });
    });
    const info = await this.request('initialize', {
      clientInfo: { name: 'codex_control_panel_local', title: 'Codex Control Panel', version: '0.1.0' },
    });
    this.notify('initialized', {});
    return info;
  }
  consume(data) {
    this.buffer += data;
    if (this.buffer.length > 4 * 1024 * 1024) { this.fail(new Error('RPC frame too large')); this.stop(); return; }
    let boundary;
    while ((boundary = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, boundary); this.buffer = this.buffer.slice(boundary + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { this.emit('protocolWarning', 'Invalid JSON line ignored'); continue; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) { this.emit('protocolWarning', 'Invalid RPC envelope ignored'); continue; }
      if (msg.method && typeof msg.method !== 'string') { this.emit('protocolWarning', 'Invalid RPC method ignored'); continue; }
      if (msg.method && msg.id != null) { this.emit('serverRequest', msg); continue; }
      if (msg.method) { this.emit('notification', msg); continue; }
      const item = this.pending.get(msg.id);
      if (!item) continue;
      clearTimeout(item.timer); this.pending.delete(msg.id);
      if (msg.error) item.reject(new Error(`RPC ${item.method}: ${String(msg.error.message || 'failed').slice(0, 500)}`));
      else item.resolve(msg.result);
    }
  }
  write(message) {
    if (!this.child?.stdin.writable) throw new Error('App-server disconnected');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params = {}) {
    if (!ALLOWED.has(method) || (method === 'command/exec' && !this.allowCommandExec)) return Promise.reject(new Error(`RPC method not allowed: ${method}`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`RPC timed out: ${method}`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.write({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  notify(method, params) {
    if (method !== 'initialized') throw new Error('Notification method not allowed');
    this.write({ method, params });
  }
  rejectServerRequest(request) {
    const method = request.method;
    let result;
    if (method === 'execCommandApproval' || method === 'applyPatchApproval') result = { decision: { denied: { rejection: 'Local prototype denies interactive actions' } } };
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') result = { decision: 'decline' };
    else if (method === 'item/permissions/requestApproval') result = { permissions: {}, scope: 'turn' };
    else if (method === 'mcpServer/elicitation/request') result = { action: 'decline', content: null, _meta: null };
    if (result) this.write({ id: request.id, result });
    else this.write({ id: request.id, error: { code: -32601, message: 'Unsupported interactive request. Workflow paused; no action approved.' } });
  }
  fail(error) {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }
  async stop() {
    this.fail(new Error('App-server stopped'));
    const child = this.child;
    if (!child) return;
    if (child.exitCode !== null) return;
    await new Promise(resolve => {
      const term = setTimeout(() => { if (child.exitCode === null) child.kill('SIGTERM'); }, 250);
      const kill = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1000);
      const limit = setTimeout(resolve, 2000);
      child.once('exit', () => { clearTimeout(term); clearTimeout(kill); clearTimeout(limit); resolve(); });
      child.stdin.end();
    });
  }
}
