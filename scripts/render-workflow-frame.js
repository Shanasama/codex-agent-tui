import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildReferenceWindowFrame } from '../src/reference-window-frame.js';
import { projectCliWorkflow } from '../src/workflow-window.js';
import { RUNTIME } from '../src/runtime.js';
try {
  let view = JSON.parse(await readFile(process.argv[2], 'utf8'));
  if (view.schema !== 1) throw new Error('Invalid workflow view');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(view.runId || '')) {
    try {
      const run=JSON.parse(await readFile(path.join(RUNTIME,'cli-workflows',`${view.runId}.json`),'utf8'));
      const source=view.source; view=projectCliWorkflow(run); view.source=source;
    } catch { /* Historical snapshots need not have a current run file. */ }
  }
  const frame=buildReferenceWindowFrame(view);
  process.stdout.write(JSON.stringify({ ...frame, probabilities:view.probabilities, source:view.source }));
} catch(error) { console.error(error.message); process.exitCode=1; }
