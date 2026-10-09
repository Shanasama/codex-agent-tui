import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { RUNTIME } from '../src/runtime.js';
import { projectWorkflow, createWorkflowPublisher, projectCliWorkflow, createCliWindowBridge } from '../src/workflow-window.js';
import { CliWorkflowStore } from '../src/cli-workflow-store.js';
import { createPluginHandler } from '../src/cli-plugin-server.js';
const fixture = () => ({ status: 'completed', stage: 'completed', goal: '查看项目', task: { mode: 'inspect', id: 'test' }, models: { worker: 'sol', reviewer: 'astra' }, threads: [{ role: 'worker', status: 'completed' }], events: [], inspectionEvidence: { files: ['a','b'] }, jev: { model: 'jev-test', confidence: 0.95, effectiveRoute: 'execute', probabilities: { execute: 0.97, plan_review: 0.01, clarify: 0.02 } } });
test('window projection preserves actual probabilities and inactive review state', () => {
  const result = projectWorkflow(fixture(), true);
  assert.deepEqual(result.probabilities.map(p => p.value), [0.97,0.01,0.02]);
  assert.equal(result.source, '历史结果'); assert.equal(result.workerStatus, '已完成');
  assert.equal(result.review, '本次未触发'); assert.equal(result.reviewerStatus, '尚未派发');
  assert.match(result.outcomeDetail, /未运行测试/);
});

test('plugin route opens viewer before provider returns and stage updates do not reopen it', async () => {
  await mkdir(RUNTIME,{recursive:true}); const dir=await mkdtemp(path.join(RUNTIME,'cli-window-test-'));
  const views=[]; let opened=0, routed=0;
  const bridge=createCliWindowBridge({publisher:{publishView:async view=>views.push(view)},open:async()=>{opened++;}});
  const store=new CliWorkflowStore({directory:dir,onChange:bridge,route:async()=>{assert.equal(opened,1);routed++;return fixture().jev;}});
  const handle=createPluginHandler(store);
  const reply=await handle({id:1,method:'tools/call',params:{name:'route_task',arguments:{goal:'查看项目',mode:'inspect'}}});
  const result=JSON.parse(reply.result.content[0].text);
  assert.equal(reply.result.isError,false);assert.equal(opened,1);assert.equal(routed,1);
  assert.deepEqual(views[0].probabilities.map(p=>p.value),[null,null,null]);
  assert.deepEqual(views[1].probabilities.map(p=>p.value),[0.97,0.01,0.02]);
  await store.update({run_id:result.run_id,stage:'work',status:'running',summary:'开始读取文件'});
  assert.equal(views.at(-1).workerStatus,'进行中');assert.equal(opened,1);
  await store.update({run_id:result.run_id,stage:'done',status:'completed',summary:'报告已生成',evidence:['CLI returned the report']});
  assert.equal(views.at(-1).statusCode,'completed');assert.equal(opened,1);
  assert.equal(views.at(-1).workerTitle,'CODEX');assert.equal(views.at(-1).reviewerTitle,'REVIEW');
  assert.match(views.at(-1).reviewerModel,/非独立验收/);
});
test('provider failure updates the visible state without invented probabilities', async () => {
  const dir=await mkdtemp(path.join(RUNTIME,'cli-window-error-'));const changes=[];
  const store=new CliWorkflowStore({directory:dir,onChange:async r=>changes.push(projectCliWorkflow(r)),route:async()=>{throw new Error('Jev API HTTP 401');}});
  await assert.rejects(store.begin({goal:'查看项目'}),/HTTP 401/);
  assert.equal(changes.at(-1).statusCode,'blocked');assert.match(changes.at(-1).event,/HTTP 401/);
  assert.ok(changes.at(-1).probabilities.every(p=>p.value===null));
});
test('visualization failure is reported without stopping the authorized workflow', async () => {
  const dir=await mkdtemp(path.join(RUNTIME,'cli-window-unavailable-'));
  const store=new CliWorkflowStore({directory:dir,onChange:async()=>{throw new Error('display unavailable');},route:async()=>fixture().jev});
  const result=await store.begin({goal:'查看项目'});
  assert.equal(result.window_error,'display unavailable');assert.equal(result.next,'execute');
});
test('a resumed CLI task does not look complete because an older done entry remains', () => {
  const run={id:'test',mode:'inspect',goal:'继续查看',decision:fixture().jev,stages:[
    {stage:'work',status:'running',summary:'继续读取',time:'2026-10-09T06:02:00Z'},
    {stage:'done',status:'completed',summary:'旧报告',time:'2026-10-09T06:00:00Z'},
  ]};
  const view=projectCliWorkflow(run);assert.equal(view.statusCode,'running');assert.equal(view.event,'继续读取');
});
test('window waits for real Jev data and does not expose raw model outputs', () => {
  const s = fixture(); delete s.jev; s.workerOutput = 'private model output';
  const result = projectWorkflow(s);
  assert.deepEqual(result.probabilities.map(p => p.value), [null,null,null]);
  assert.doesNotMatch(JSON.stringify(result), /private model output/);
});
test('separate window gets final state in order without controlling execution', async () => {
  await mkdir(RUNTIME,{recursive:true}); const dir=await mkdtemp(path.join(RUNTIME,'window-state-test-'));
  const file=path.join(dir,'view.json'), publisher=createWorkflowPublisher(file);
  const s=fixture(); s.status='running';
  const a=publisher.publish(s); s.status='completed'; const b=publisher.publish(s);
  await Promise.all([a,b]); await publisher.flush();
  assert.equal(JSON.parse(await readFile(file,'utf8')).statusCode,'completed');
});
