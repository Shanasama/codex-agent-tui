// Explicit Windows UI integration check; not part of routine headless npm test.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { RUNTIME } from '../src/runtime.js';
import { createWorkflowPublisher, openWorkflowWindow } from '../src/workflow-window.js';
await mkdir(RUNTIME,{recursive:true});
const stateFile=path.join(await mkdtemp(path.join(RUNTIME,'window-launch-check-')),'state.json');
await createWorkflowPublisher(stateFile).publish({status:'idle',goal:'窗口启动验收（无模型调用）',events:[],threads:[]},true);
let ownedPid;
try {
  ownedPid=await openWorkflowWindow({stateFile});
  const first=JSON.parse(await readFile(stateFile+'.window.json','utf8'));
  assert.equal(first.visible,true);assert.equal(first.rendered,true);assert.equal(first.pid,ownedPid);
  const reused=await openWorkflowWindow({stateFile});
  const second=JSON.parse(await readFile(stateFile+'.window.json','utf8'));
  assert.equal(reused,ownedPid);assert.notEqual(first.launchId,second.launchId);
  console.log(JSON.stringify({firstLaunch:'visible and rendered',reuse:'same window',pid:ownedPid,modelCalled:false}));
} finally { if(ownedPid) { try{process.kill(ownedPid);}catch(error){if(error.code!=='ESRCH')throw error;} } }
