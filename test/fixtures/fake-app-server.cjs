// Synthetic wire server for protocol/controller tests. Never contacts a model.
const readline = require('node:readline');
const scenario = process.argv[2] || 'success';
let next = 1;
const threads = new Map();
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const notify = (method, params) => send({ method, params });
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line); const { id, method, params } = message;
  if (id == null) return;
  if (method === 'initialize') return send({ id, result: { userAgent: 'synthetic-fixture/1' } });
  if (method === 'model/list') return send({ id, result: { data: ['gpt-6-luna', 'gpt-6.1-sol', ...(scenario === 'missing-model' ? [] : ['gpt-6-astra'])].map(model => ({ id: model, model, displayName: model })), nextCursor: null } });
  if (method === 'account/read') return send({ id, result: { account: scenario === 'no-auth' ? null : { type: 'apiKey' }, requiresOpenaiAuth: true } });
  if (method === 'thread/start') {
    const threadId = `fixture-thread-${next++}`; threads.set(threadId, params.model);
    return send({ id, result: { thread: { id: threadId }, model: scenario === 'wrong-model' ? 'wrong' : params.model, cwd: params.cwd, sandbox: { type: 'readOnly', networkAccess: false }, reasoningEffort: null } });
  }
  if (method === 'turn/interrupt') { setTimeout(() => send({ id, result: {} }), scenario === 'late-start' ? 50 : 0); return; }
  if (method === 'turn/start') {
    const threadId = params.threadId, turnId = `fixture-turn-${next++}`;
    notify('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });
    if (scenario === 'approval') send({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId: 'cmd' } });
    if (scenario !== 'lost-start') setTimeout(() => send({ id, result: { turn: { id: turnId, status: 'inProgress' } } }), scenario === 'late-start' ? 100 : 0);
    if (scenario === 'lost-start') return;
    const failed = scenario === 'worker-failure' && threads.get(threadId) === 'gpt-6.1-sol';
    setTimeout(() => {
      const text = params.outputSchema ? JSON.stringify({ verdict: 'pass', summary: 'Synthetic review only', concerns: [] }) : 'Synthetic role output only; no model called.';
      const item = { id: `message-${turnId}`, type: 'agentMessage', text };
      notify('item/completed', { threadId, turnId, item });
      notify('turn/completed', { threadId, turn: { id: turnId, status: failed ? 'failed' : 'completed', items: [item], error: failed ? { message: 'fixture repeated failure' } : null } });
    }, scenario === 'late-start' ? 200 : 10);
  }
});
