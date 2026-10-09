import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { symlink, unlink, writeFile, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { RpcClient } from '../src/protocol.js';
import { StateStore, safeText } from '../src/state.js';
import { Controller } from '../src/controller.js';
import { prepareRuntime, isolatedEnv, ROOT, RUNTIME, assertSafePath } from '../src/runtime.js';
import { createServer } from '../src/server.js';
await prepareRuntime();
const fixture = path.join(ROOT, 'test/fixtures/fake-app-server.cjs');
const makeController = (scenario = 'success', opts = {}) => new Controller({ rpcFactory: () => new RpcClient({ command: process.execPath, args: [fixture, scenario], timeoutMs: 2000 }), version: async () => 'fixture-cli', liveEnabled: true, audit: false, demoDelay: 1, ...opts });

test('child environment excludes host credentials and redirects all state', () => {
  const env = isolatedEnv({ PATH: '/safe', HOME: '/host', CODEX_HOME: '/host/.codex', OPENAI_API_KEY: 'secret', NODE_OPTIONS: '--require evil', HTTPS_PROXY: 'secret' });
  assert.equal(env.PATH, '/safe'); assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.HTTPS_PROXY, undefined);
  assert.ok(env.CODEX_HOME.startsWith(RUNTIME)); assert.ok(env.HOME.startsWith(RUNTIME));
});
test('runtime path checks reject outside paths and symlinks', async () => {
  await assert.rejects(assertSafePath('/tmp/outside'), /outside/);
  const link = path.join(RUNTIME, 'fixture-link'); await symlink('/tmp', link);
  try { await assert.rejects(assertSafePath(path.join(link, 'file')), /Symlink/); } finally { await unlink(link); }
});
test('protocol tolerates fragmented frames, null, arrays, malformed JSON', () => {
  const rpc = new RpcClient(); const notifications = []; rpc.on('notification', e => notifications.push(e));
  rpc.consume('null\n[]\n5\n{"method":4}\nnot-json\n{"meth'); rpc.consume('od":"thread/started","params":{}}\n');
  assert.equal(notifications.length, 1);
});
test('protocol has no arbitrary shell or process RPC', async () => {
  const rpc = new RpcClient();
  await assert.rejects(rpc.request('thread/shellCommand'), /not allowed/);
  await assert.rejects(rpc.request('process/spawn'), /not allowed/);
  await assert.rejects(rpc.request('config/write'), /not allowed/);
});
test('all supported server approval requests fail closed', () => {
  const rpc = new RpcClient(); const writes = []; rpc.write = m => writes.push(m);
  for (const method of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'mcpServer/elicitation/request', 'execCommandApproval', 'unknown/request']) rpc.rejectServerRequest({ id: writes.length, method });
  assert.equal(writes[0].result.decision, 'decline'); assert.equal(writes[1].result.decision, 'decline');
  assert.deepEqual(writes[2].result.permissions, {}); assert.deepEqual(writes[3].result, { action: 'decline', content: null, _meta: null });
  assert.ok(writes[4].result.decision.denied); assert.ok(writes[5].error);
});
test('real stdio transport works against labeled protocol fixture and closes child', async () => {
  const rpc = new RpcClient({ command: process.execPath, args: [fixture], timeoutMs: 2000 });
  assert.equal((await rpc.start()).userAgent, 'synthetic-fixture/1');
  assert.equal((await rpc.request('model/list')).data.length, 3); const child = rpc.child;
  await rpc.stop(); assert.notEqual(child.exitCode, null);
});
test('native subagent hierarchy and statuses map real protocol fields', () => {
  const s = new StateStore(); s.newRun('test', 'live');
  s.ingest({ method: 'thread/started', params: { thread: { id: 'child', parentThreadId: 'parent', source: 'appServer' } } });
  s.ingest({ method: 'item/completed', params: { threadId: 'parent', item: { id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'completed', senderThreadId: 'parent', receiverThreadIds: ['child'], agentsStates: { child: { status: 'running' } } } } });
  assert.equal(s.thread('child').parentId, 'parent'); assert.equal(s.thread('child').status, 'running');
  s.ingest({ method: 'thread/status/changed', params: { threadId: 'child', status: { type: 'active', activeFlags: ['waitingOnApproval'] } } });
  assert.equal(s.thread('child').status, 'active');
});
test('duplicate failure event counts once; repeated failure pauses', () => {
  const s = new StateStore(); s.newRun('test', 'demo');
  const failure = id => ({ method: 'item/completed', params: { threadId: 't', item: { id, type: 'commandExecution', command: 'fixture', status: 'failed', exitCode: 1 } } });
  s.ingest(failure('a')); s.ingest(failure('a')); assert.equal(s.state.run.errorCount, 1);
  s.ingest(failure('b')); assert.equal(s.state.run.status, 'paused'); assert.equal(s.state.run.stage, 'repeated-error');
});
test('private reasoning and raw command output are not projected to browser', () => {
  const s = new StateStore(); s.newRun('test', 'live');
  s.ingest({ method: 'item/completed', params: { threadId: 't', item: { id: 'r', type: 'reasoning', content: ['PRIVATE_REASONING'] } } });
  s.ingest({ method: 'item/completed', params: { threadId: 't', item: { id: 'c', type: 'commandExecution', command: 'SECRET_COMMAND', aggregatedOutput: 'SECRET_OUTPUT', status: 'completed' } } });
  assert.doesNotMatch(JSON.stringify(s.snapshot()), /PRIVATE_REASONING|SECRET_COMMAND|SECRET_OUTPUT/);
  assert.doesNotMatch(safeText('Bearer abc.def api_key=secret sk-abcdefghijklmnop'), /abc.def|=secret|sk-/);
});
test('model catalog does not imply auth or inference authorization', async () => {
  const c = makeController('no-auth'); await c.connect();
  assert.equal(c.snapshot().connection.authenticated, false); assert.equal(c.snapshot().connection.ready, false);
  assert.throws(() => c.startRun('test'), /未就绪/); await c.disconnect();
});
test('missing exact role model blocks workflow and never substitutes', async () => {
  const c = makeController('missing-model'); await c.connect();
  assert.equal(c.snapshot().connection.ready, false); assert.equal(c.snapshot().roles.find(r => r.id === 'architect').available, false); await c.disconnect();
});
test('all role stages and review gates run over fixture stdio (no inference)', async () => {
  const c = makeController(); await c.connect(); c.startRun('fixture test'); await c.background;
  const s = c.snapshot(); assert.equal(s.run.status, 'completed'); assert.equal(s.run.threads.length, 5);
  assert.equal(s.run.reviews.find(r => r.type === 'plan').status, 'passed'); assert.equal(s.run.reviews.find(r => r.type === 'completion').status, 'passed');
  await c.disconnect();
});
test('repeated live-fixture worker errors escalate to architect and stay paused', async () => {
  const c = makeController('worker-failure'); await c.connect(); c.startRun('fixture repeated failure'); await c.background;
  const s = c.snapshot(); assert.equal(s.run.status, 'paused'); assert.match(s.run.reviews.find(r => r.type === 'repeated-error').message, /升级 Astra/);
  await c.disconnect();
});
test('malformed review JSON always blocks', () => {
  const c = makeController(); c.store.newRun('test', 'demo');
  for (const text of ['null', '{}', '{"verdict":"pass"}', '{"verdict":"pass","summary":"ok","concerns":null}', 'not json']) assert.equal(c.parseReview(text, 'plan'), 'blocked');
  assert.equal(c.parseReview('{"verdict":"pass","summary":"ok","concerns":[]}', 'plan'), 'pass');
});
for (const scenario of ['success', 'repeated-error', 'approval']) test(`demo ${scenario} is explicitly synthetic and has expected gate`, async () => {
  const c = makeController(); c.startDemo(scenario); await c.background; const s = c.snapshot();
  assert.equal(s.mode, 'demo'); assert.equal(s.connection.authenticated, false); assert.equal(s.run.status, scenario === 'success' ? 'completed' : 'paused');
  assert.ok(s.events.every(e => e.source === 'fixture'));
});
test('foreign notifications cannot create browser threads', async () => {
  const c = makeController(); await c.connect(); c.store.newRun('test', 'live');
  c.rpc.emit('notification', { method: 'thread/started', params: { thread: { id: 'foreign' } } });
  assert.equal(c.snapshot().run.threads.length, 0); await c.disconnect();
});
test('HTTP loopback capability, origin, safe routes and body validation', async () => {
  const c = makeController(); const app = createServer(c); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const first = await fetch(base + '/'); assert.equal(first.status, 200);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    assert.match(first.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.equal((await fetch(base + '/api/state')).status, 403);
    assert.equal((await fetch(base + '/api/state', { headers: { Cookie: cookie } })).status, 200);
    const post = (route, value, headers = {}) => fetch(base + route, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Control-Panel': '1', ...headers }, body: JSON.stringify(value) });
    assert.equal((await post('/api/demo', { scenario: 'success' }, { Origin: 'https://evil.example' })).status, 403);
    const hostileHost = await new Promise(resolve => { const r = http.get(base + '/api/state', { headers: { Host: 'evil.example', Cookie: cookie } }, response => { response.resume(); resolve(response.statusCode); }); r.on('error', () => resolve(0)); });
    assert.equal(hostileHost, 403);
    assert.equal((await post('/api/run', { goal: 'x', cwd: '/root' })).status, 400);
    assert.equal((await post('/api/run', { goal: 'x'.repeat(9000) })).status, 400);
    assert.equal((await post('/api/rpc', { method: 'process/spawn' })).status, 404);
    for (const route of ['/runtime/codex-home/config.toml', '/src/server.js', '/.env', '/%2e%2e/.codex/auth.json']) assert.equal((await fetch(base + route, { headers: { Cookie: cookie } })).status, 404);
    assert.equal((await post('/api/demo', { scenario: 'success' })).status, 200); await c.background;
  } finally { await app.close(); }
});

test('model mismatch fails before turn/start without substitution', async () => {
  const c = makeController('wrong-model'); await c.connect(); c.startRun('fixture'); await c.background;
  assert.equal(c.snapshot().run.status, 'failed'); assert.equal(c.snapshot().run.threads.length, 0); await c.disconnect();
});
test('approval request is denied and stops progression', async () => {
  const c = makeController('approval'); await c.connect(); c.startRun('fixture'); await c.background;
  assert.equal(c.snapshot().run.status, 'paused'); assert.equal(c.snapshot().run.stage, 'approval');
  assert.ok(c.snapshot().events.some(e => e.type === 'approval')); await c.disconnect();
});
test('new run is blocked during interrupt cleanup and late starts are interrupted', async () => {
  const c = makeController('late-start'); await c.connect(); c.startRun('A');
  while (c.activeTurns.size < 2) await new Promise(resolve => setTimeout(resolve, 2));
  const cleanup = c.interrupt();
  assert.throws(() => c.startRun('B'), /尚未结束/);
  await cleanup; await c.background;
  assert.equal(c.snapshot().run.status, 'interrupted'); assert.equal(c.waiters.size, 0);
  await c.disconnect();
});
test('uncertain turn/start delivery stops subprocess and is never retried', async () => {
  const c = makeController('lost-start', { rpcFactory: () => new RpcClient({ command: process.execPath, args: [fixture, 'lost-start'], timeoutMs: 100 }) });
  await c.connect(); c.startRun('fixture lost response'); const child = c.rpc.child; await c.background;
  assert.equal(c.snapshot().run.threads.length, 2); assert.notEqual(child.exitCode, null); assert.equal(c.snapshot().run.status, 'failed'); await c.disconnect();
});
