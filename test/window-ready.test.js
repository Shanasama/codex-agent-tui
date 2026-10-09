import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RUNTIME } from '../src/runtime.js';
import { waitForWindowReady } from '../src/workflow-window.js';
async function stateFile() { await mkdir(RUNTIME,{recursive:true}); return path.join(await mkdtemp(path.join(RUNTIME,'ready-test-')),'state.json'); }
test('a successful process exit without a rendered window is not success', async () => {
  const file=await stateFile(), child=new EventEmitter();
  const ready=waitForWindowReady({stateFile:file,launchId:'new',child,timeoutMs:80,pollMs:5});
  child.emit('exit',0,null);
  await assert.rejects(ready,/未返回/);
});
test('stale acknowledgement and invisible window cannot pass readiness', async () => {
  const file=await stateFile();
  await writeFile(file+'.window.json',JSON.stringify({launchId:'old',visible:true,rendered:true,pid:1}));
  await assert.rejects(waitForWindowReady({stateFile:file,launchId:'new',child:new EventEmitter(),timeoutMs:30,pollMs:5}),/未返回/);
  await writeFile(file+'.window.json',JSON.stringify({launchId:'new',visible:false,rendered:true,pid:1}));
  await assert.rejects(waitForWindowReady({stateFile:file,launchId:'new',child:new EventEmitter(),timeoutMs:30,pollMs:5}),/未返回/);
});
test('current visible and rendered acknowledgement returns its actual viewer pid', async () => {
  const file=await stateFile();
  await writeFile(file+'.window.json',JSON.stringify({launchId:'current',visible:true,rendered:true,pid:123}));
  const result=await waitForWindowReady({stateFile:file,launchId:'current',child:new EventEmitter(),timeoutMs:30});
  assert.equal(result.pid,123);
});
