import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeFile, readFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createTaskWorkspace } from '../src/live-workspace.js';
import { LiveController } from '../src/live-controller.js';
import { JevClient, parseJevDecision } from '../src/jev.js';
import { renderLiveFrame } from '../src/live-render.js';
import { cleanText, visibleWidth } from '../src/tui-render.js';
import { RpcClient } from '../src/protocol.js';
import { readTaskInput } from '../src/live-input.js';
import { RUNTIME } from '../src/runtime.js';
import { parseInspection } from '../src/inspection.js';

const decision = (choice = 'execute', confidence = 0.95) => ({ model: 'jev-test', answers: { route: { type: 'choice', choice, confidence, probabilities: { execute: choice === 'execute' ? 0.9 : 0.05, plan_review: choice === 'plan_review' ? 0.9 : 0.05, clarify: choice === 'clarify' ? 0.9 : 0.05 } } }, usage: { input_tokens: 20, output_tokens: 3 } });
const jev = (choice, confidence) => ({ route: async () => parseJevDecision(decision(choice, confidence)), cancel() {} });
const fixedCart = `export function cartTotal(items) {
  if (!Array.isArray(items)) throw new TypeError('array required');
  return items.reduce((sum, item) => {
    if (!item || !Number.isFinite(item.price) || item.price < 0 || !Number.isFinite(item.quantity) || item.quantity < 0) throw new TypeError('invalid input');
    return sum + item.price * item.quantity;
  }, 0);
}\n`;
class SyntheticRpc extends EventEmitter {
  constructor(scenario = 'success') { super(); this.scenario = scenario; this.threads = new Map(); this.calls = []; this.stopped = false; this.replies = []; }
  async start() { return {}; }
  async stop() { this.stopped = true; }
  write(value) { this.replies.push(value); }
  rejectServerRequest(req) { this.replies.push({ id: req.id, result: { decision: 'decline' } }); }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: this.scenario === 'no-auth' ? null : { type: 'test-only' } };
    if (method === 'model/list') return { data: ['gpt-6.1-sol', 'gpt-6-astra'].map(model => ({ model })) };
    if (method === 'thread/start') {
      const id = `synthetic-${this.threads.size}`; this.threads.set(id, params);
      return { thread: { id }, model: this.scenario === 'wrong-model' ? 'wrong' : params.model, cwd: params.cwd, sandbox: { type: params.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite', networkAccess: false, writableRoots: [] } };
    }
    if (method === 'turn/start') {
      const t = this.threads.get(params.threadId), id = `turn-${params.threadId}`;
      if (this.scenario === 'lost-start') throw new Error('RPC timed out: turn/start');
      if (t.sandbox === 'workspace-write' && !['no-edit', 'bad-review'].includes(this.scenario)) await writeFile(path.join(t.cwd, 'cart.js'), fixedCart);
      if (this.scenario === 'bad-review' && t.sandbox === 'workspace-write') await writeFile(path.join(t.cwd, 'cart.js'), fixedCart);
      const text = params.outputSchema?.properties?.filesReviewed ? JSON.stringify({ status: 'completed', report: 'Synthetic file analysis; no model called.', filesReviewed: ['notes.txt'] }) : params.outputSchema ? (this.scenario === 'bad-review' ? '{"verdict":"pass"}' : JSON.stringify({ verdict: 'pass', summary: 'Synthetic reviewer; no model called', concerns: [] })) : 'Synthetic worker; local fixture file edited by test code.';
      queueMicrotask(() => this.emit('notification', { method: 'turn/completed', params: { threadId: params.threadId, turn: { id, status: 'completed', items: [{ type: 'agentMessage', text }] } } }));
      return { turn: { id } };
    }
    if (method === 'command/exec') {
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(params.command[0], params.command.slice(1), { cwd: params.cwd, env, encoding: 'utf8', windowsHide: true });
      return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
    }
    if (method === 'turn/interrupt') return {};
    throw new Error(`Unexpected method ${method}`);
  }
}
async function runScenario(scenario, routing = jev()) {
  const task = await createTaskWorkspace();
  const rpc = new SyntheticRpc(scenario);
  const controller = new LiveController({ rpcFactory: () => rpc, jev: routing });
  controller.state.evidenceSource = 'synthetic-app-server-with-real-local-tests';
  await controller.connect();
  try { return { task, rpc, result: await controller.run(task, '修复购物车金额并校验输入') }; }
  finally { await controller.close(); }
}
test('Jev uses documented endpoint/schema and does not persist bearer key', async () => {
  const calls = [];
  const client = new JevClient({ apiKey: 'test-secret-never-log', fetchImpl: async (url, init) => {
    calls.push({ url, init }); return { ok: true, json: async () => url.endsWith('/models') ? { models: [{ name: 'jev-latest' }] } : decision() };
  } });
  await client.check(); const result = await client.route({ goal: 'fix cart', fixture: true });
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/models');
  assert.equal(calls[1].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(JSON.parse(calls[1].init.body).questions.route.type, 'choice');
  assert.equal(result.effectiveRoute, 'execute');
  assert.doesNotMatch(JSON.stringify(result) + JSON.stringify(client), /test-secret-never-log/);
});
test('Jev low confidence escalates; invalid probabilities and usage fail closed', () => {
  assert.equal(parseJevDecision(decision('execute', 0.4)).effectiveRoute, 'plan_review');
  for (const mutate of [d => d.answers.route.confidence = NaN, d => d.answers.route.choice = 'approve_all', d => d.answers.route.probabilities.execute = 5, d => d.usage.input_tokens = -1]) {
    const data = decision(); mutate(data); assert.throws(() => parseJevDecision(data));
  }
});
test('Jev HTTP errors do not expose response body or retry inference', async () => {
  let calls = 0; const client = new JevClient({ apiKey: 'test-secret', fetchImpl: async () => { calls++; return { ok: false, status: 401, json: async () => ({ secret: 'never-print' }) }; } });
  await assert.rejects(client.route({ goal: 'test' }), /HTTP 401/); assert.equal(calls, 1);
});
test('live success requires actual file diff, real test exit 0 and independent review', async () => {
  const { result, task, rpc } = await runScenario('success');
  assert.equal(result.status, 'completed'); assert.equal(result.baseline.exitCode, 1); assert.equal(result.tests.exitCode, 0);
  assert.match(result.changes.diff, /item.price \* item.quantity/); assert.equal(result.review.verdict, 'pass');
  assert.equal(rpc.calls.filter(c => c.method === 'thread/start').length, 2);
  assert.equal(JSON.parse(await readFile(path.join(task.directory, 'result.json'), 'utf8')).evidenceSource, 'synthetic-app-server-with-real-local-tests');
});
test('worker narrative without actual repair cannot pass failed tests or reach reviewer', async () => {
  const { result, rpc } = await runScenario('no-edit');
  assert.equal(result.status, 'failed'); assert.equal(result.tests.exitCode, 1);
  assert.equal(rpc.calls.filter(c => c.method === 'thread/start').length, 1);
});
test('malformed reviewer pass cannot mark task complete', async () => {
  const { result } = await runScenario('bad-review'); assert.equal(result.status, 'failed'); assert.match(result.error, /审查结构/);
});
test('wrong effective model stops before any inference', async () => {
  const { result, rpc } = await runScenario('wrong-model'); assert.equal(result.status, 'failed');
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 0);
});
test('uncertain turn delivery stops app-server and is never retried', async () => {
  const { result, rpc } = await runScenario('lost-start'); assert.equal(result.status, 'failed'); assert.equal(rpc.stopped, true);
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
});
test('Jev clarify prevents file edits and model calls', async () => {
  const { result, rpc } = await runScenario('success', jev('clarify'));
  assert.equal(result.status, 'blocked'); assert.equal(result.stage, 'needs-input');
  assert.equal(rpc.calls.filter(c => c.method === 'thread/start').length, 0);
});
test('low-confidence Jev route triggers a real pre-review stage before worker', async () => {
  const { result, rpc } = await runScenario('success', jev('execute', 0.3));
  assert.equal(result.status, 'completed');
  assert.deepEqual(rpc.calls.filter(c => c.method === 'thread/start').map(c => c.params.sandbox), ['read-only', 'workspace-write', 'read-only']);
});
test('missing auth cannot start live task and closes owned process', async () => {
  const rpc = new SyntheticRpc('no-auth'); const c = new LiveController({ rpcFactory: () => rpc });
  await assert.rejects(c.connect(), /尚未登录/); assert.equal(rpc.stopped, true);
});
test('approvals require explicit true; reviewer escalation and foreign requests are denied', async () => {
  const rpc = new SyntheticRpc(); let asked = 0, shown;
  const c = new LiveController({ rpcFactory: () => rpc, approve: async request => { asked++; shown = request; return true; } });
  await c.connect(); c.owned.add('worker'); c.owned.add('reviewer');
  c.state.threads.push({ id: 'worker', role: 'worker' }, { id: 'reviewer', role: 'reviewer' });
  c.notification({ method: 'item/started', params: { threadId: 'worker', item: { id: 'patch', type: 'fileChange', changes: [{ path: 'cart.js', diff: 'visible proposed diff' }] } } });
  for (const threadId of ['foreign', 'reviewer', 'worker']) await c.serverRequest({ id: threadId, method: 'item/fileChange/requestApproval', params: { threadId, itemId: 'patch' } }, rpc);
  assert.equal(asked, 1); assert.deepEqual(rpc.replies.map(r => r.result.decision), ['decline', 'decline', 'accept']);
  assert.equal(shown.proposedItem.changes[0].diff, 'visible proposed diff');
  await c.close();
});
test('legacy transport does not gain command execution capability', async () => {
  await assert.rejects(new RpcClient().request('command/exec', { command: ['whoami'] }), /not allowed/);
});
test('live renderer preserves Jev identity without fake probabilities or demo claims', () => {
  const c = new LiveController();
  for (const [columns, rows] of [[40, 12], [120, 40]]) {
    const frame = renderLiveFrame(c.snapshot(), { columns, rows });
    assert.match(frame, /Jev/); assert.doesNotMatch(frame, /SYNTHETIC|NO MODEL CALLS|confidence 0/);
    for (const line of frame.split(/\x1b\[\d+;1H/)) assert.ok(visibleWidth(cleanText(line)) <= columns - 1);
  }
});

test('quoted project path and inspect input never request test arguments', async () => {
  const questions = [], replies = ['"C:\\projects\\example"', '', '查看项目'];
  const input = await readTaskInput({}, async text => { questions.push(text); return replies.shift(); });
  assert.equal(input.project, 'C:\\projects\\example'); assert.equal(input.mode, 'inspect');
  assert.equal(input.goal, '查看项目'); assert.equal(input.testArgv, undefined);
  assert.equal(questions.length, 3); assert.ok(questions.every(q => !q.includes('验收命令')));
});
test('edit mode still requires the user test command', async () => {
  const input = await readTaskInput({ project: 'C:\\projects\\example', mode: 'edit', goal: 'fix bug' }, async () => '["node","--test"]');
  assert.deepEqual(input.testArgv, ['node', '--test']);
});
test('inspect accepts a non-Git folder and runs only a read-only thread without tests or edits', async () => {
  await mkdir(RUNTIME, { recursive: true });
  const source = await mkdtemp(path.join(RUNTIME, 'inspect-input-'));
  await writeFile(path.join(source, 'notes.txt'), 'unchanged source');
  const task = await createTaskWorkspace({ project: `"${source}"`, mode: 'inspect' });
  assert.equal(task.cwd, source); assert.equal(task.testArgv, null);
  const rpc = new SyntheticRpc(); let requestedMode;
  const c = new LiveController({ rpcFactory: () => rpc, jev: { route: async input => { requestedMode = input.mode; return parseJevDecision(decision()); } } });
  await c.connect();
  try {
    const result = await c.run(task, '查看项目');
    assert.equal(result.status, 'completed'); assert.ok(result.report); assert.equal(result.tests, undefined);
    assert.equal(requestedMode, 'inspect');
    assert.equal(rpc.calls.filter(call => call.method === 'command/exec').length, 0);
    assert.equal(rpc.calls.find(call => call.method === 'thread/start').params.sandbox, 'read-only');
    assert.equal(rpc.calls.find(call => call.method === 'thread/start').params.config['features.shell_tool'], false);
    assert.equal(rpc.calls.find(call => call.method === 'turn/start').params.sandboxPolicy.type, 'readOnly');
    assert.deepEqual(await readdir(source), ['notes.txt']);
    assert.equal(await readFile(path.join(source, 'notes.txt'), 'utf8'), 'unchanged source');
    assert.equal(await readFile(path.join(task.directory, 'report.txt'), 'utf8'), result.report);
    assert.match(renderLiveFrame(result), /只读目录/);
    assert.doesNotMatch(renderLiveFrame(result), /完成依据：真实文件修改/);
  } finally { await c.close(); }
});

test('inspection refusal and missing or invented file evidence cannot pass', () => {
  const evidence = { files: [{ path: 'notes.txt' }] };
  assert.equal(parseInspection(JSON.stringify({ status: 'blocked', report: '无法读取文件', filesReviewed: [] }), evidence).status, 'blocked');
  assert.throws(() => parseInspection(JSON.stringify({ status: 'completed', report: '无法读取文件', filesReviewed: [] }), evidence), /不能标记完成/);
  assert.throws(() => parseInspection(JSON.stringify({ status: 'completed', report: 'report', filesReviewed: ['invented.txt'] }), evidence), /证据无效/);
});
