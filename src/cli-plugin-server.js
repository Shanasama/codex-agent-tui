import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { CliWorkflowStore } from './cli-workflow-store.js';
import { JevClient, loadJevKey } from './jev.js';
import { createCliWindowBridge } from './workflow-window.js';

export const PLUGIN_TOOLS = [
  { name: 'route_task', description: '自动打开 TUI 风格工作流小窗并向 TypeSafe Jev 请求真实任务分流；只发送任务描述。', inputSchema: { type: 'object', properties: { goal: { type: 'string', minLength: 1, maxLength: 4000 }, mode: { type: 'string', enum: ['inspect','edit'], default: 'inspect' } }, required: ['goal'], additionalProperties: false } },
  { name: 'record_stage', description: '记录当前 CLI 已实际执行的阶段及证据摘要。这是 CLI 报告，不是独立验证。不会执行命令或修改项目文件。', inputSchema: { type: 'object', properties: { run_id: { type: 'string' }, stage: { type: 'string', enum: ['plan','work','tests','review','done'] }, status: { type: 'string', enum: ['running','completed','blocked','skipped'] }, summary: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' }, maxItems: 20 } }, required: ['run_id','stage','status','summary'], additionalProperties: false } },
  { name: 'workflow_status', description: '读取已保存的工作流阶段和文字流程图，可在同一 Codex 对话后续轮次继续查看。', inputSchema: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'], additionalProperties: false }, annotations: { readOnlyHint: true } },
];
export function createPluginHandler(store) {
  return async message => {
    if (message.id == null) return null;
    const reply = result => ({ jsonrpc: '2.0', id: message.id, result });
    if (message.method === 'initialize') return reply({ protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'jev-workflow', version: '0.2.1' } });
    if (message.method === 'ping') return reply({});
    if (message.method === 'tools/list') return reply({ tools: PLUGIN_TOOLS });
    if (message.method !== 'tools/call') return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
    try {
      const { name, arguments: args = {} } = message.params || {};
      const definition = PLUGIN_TOOLS.find(tool => tool.name === name);
      if (!definition || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !Object.hasOwn(definition.inputSchema.properties,k))) throw new Error('未知工具或参数');
      let result;
      if (name === 'route_task') result = await store.begin(args);
      else if (name === 'record_stage') result = await store.update(args);
      else { const run = await store.read(args.run_id); result = { run_id: run.id, goal: run.goal, mode: run.mode, decision: run.decision, stages: run.stages, workflow: store.format(run) }; }
      return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
    } catch (error) { return reply({ content: [{ type: 'text', text: error.message }], isError: true }); }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = new CliWorkflowStore({ onChange: createCliWindowBridge(), route: async input => {
    const client = new JevClient({ apiKey: await loadJevKey() });
    await client.check(); return client.route(input);
  } });
  const handle = createPluginHandler(store);
  // stdout is exclusively MCP JSON-RPC, never terminal control sequences.
  let queue = Promise.resolve();
  createInterface({ input: process.stdin }).on('line', line => {
    queue = queue.then(async () => {
      try { const response = await handle(JSON.parse(line)); if (response) process.stdout.write(JSON.stringify(response)+'\n'); }
      catch { process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:null, error:{code:-32700,message:'Parse error'} })+'\n'); }
    });
  });
}
