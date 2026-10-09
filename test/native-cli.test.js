import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { RUNTIME } from '../src/runtime.js';
import { CliWorkflowStore } from '../src/cli-workflow-store.js';
import { createPluginHandler } from '../src/cli-plugin-server.js';
import { nativeCliArgs } from '../src/native-cli.js';
const decision = { model:'jev-test', effectiveRoute:'execute', confidence:0.95, probabilities:{execute:0.97,plan_review:0.01,clarify:0.02} };
async function directory() { await mkdir(RUNTIME,{recursive:true}); return mkdtemp(path.join(RUNTIME,'native-plugin-test-')); }
test('native CLI starts the interactive frontend and leaves approvals enabled', () => {
  const project = 'C:\\a path\\literal & project';
  const args=nativeCliArgs({project});
  assert.equal(args[args.indexOf('--cd')+1],project);
  assert.ok(!args.includes('exec')); assert.ok(!args.includes('app-server'));
  assert.ok(!args.some(a=>a.includes('dangerously-bypass')));
  assert.equal(args[args.indexOf('--ask-for-approval')+1],'on-request');
  assert.deepEqual(nativeCliArgs({project,resume:true}).slice(-2),['resume','--last']);
});
test('plugin initialization and discovery never call a model', async () => {
  let calls=0; const handle=createPluginHandler(new CliWorkflowStore({directory:await directory(),route:async()=>{calls++;return decision;}}));
  const init=await handle({id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}});
  assert.equal(init.result.serverInfo.name,'jev-workflow');
  const list=await handle({id:2,method:'tools/list'});
  assert.deepEqual(list.result.tools.map(t=>t.name),['route_task','record_stage','workflow_status']);
  assert.equal(calls,0);
});
test('workflow can continue across tool calls and a fresh MCP process without rerouting', async () => {
  const dir=await directory(); let calls=0;
  const store=new CliWorkflowStore({directory:dir,route:async()=>{calls++;return decision;}});
  const first=await store.begin({goal:'查看项目',mode:'inspect'});
  await store.update({run_id:first.run_id,stage:'work',status:'completed',summary:'已读取 README',evidence:['native file tool returned README contents']});
  const reopened=new CliWorkflowStore({directory:dir,route:async()=>{throw new Error('must not reroute');}});
  const handle=createPluginHandler(reopened);
  const reply=await handle({id:3,method:'tools/call',params:{name:'workflow_status',arguments:{run_id:first.run_id}}});
  const result=JSON.parse(reply.result.content[0].text);
  assert.equal(result.goal,'查看项目'); assert.equal(result.stages[0].status,'completed'); assert.equal(calls,1);
});
test('read-only tasks cannot claim test passes; complete stages need evidence', async () => {
  const store=new CliWorkflowStore({directory:await directory(),route:async()=>decision});
  const {run_id}=await store.begin({goal:'查看项目'});
  await assert.rejects(store.update({run_id,stage:'tests',status:'completed',summary:'passed',evidence:['claim']}),/只读模式/);
  await assert.rejects(store.update({run_id,stage:'work',status:'completed',summary:'done'}),/证据/);
  await assert.rejects(store.read('../../auth.json'),/run_id/);
});
test('plugin rejects unknown tools and unexpected arguments without invoking Jev', async () => {
  let calls=0; const handler=createPluginHandler(new CliWorkflowStore({route:async()=>{calls++;return decision;}}));
  for(const params of [{name:'shell',arguments:{command:'anything'}},{name:'route_task',arguments:{goal:'test',api_key:'never accepted'}}]) {
    const reply=await handler({id:1,method:'tools/call',params});assert.equal(reply.result.isError,true);
  }
  assert.equal(calls,0);
});
