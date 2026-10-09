import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createWorkflowPublisher, openWorkflowWindow, WORKFLOW_VIEW } from '../src/workflow-window.js';
try {
  const { values } = parseArgs({ options: { result: { type: 'string' }, snapshots: { type: 'string' } } });
  if (values.result) {
    const state = JSON.parse(await readFile(values.result, 'utf8'));
    if (state.mode !== 'live' || !Array.isArray(state.threads)) throw new Error('请选择真实任务的 result.json');
    await createWorkflowPublisher().publish(state, true);
  } else {
    try { await readFile(WORKFLOW_VIEW); }
    catch { await createWorkflowPublisher().publish({ status: 'idle', events: [], threads: [] }); }
  }
  const pid = await openWorkflowWindow({ snapshotDirectory: values.snapshots });
  console.log(`工作流窗口已启动 (${pid})。拖动窗口边缘可调整大小。`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
