import { writeFile } from 'node:fs/promises';
import { Controller } from '../src/controller.js';
import { prepareRuntime } from '../src/runtime.js';
await prepareRuntime();
const controller = new Controller({ liveEnabled: false });
try {
  await controller.connect();
  const s = controller.snapshot();
  const result = { time: new Date().toISOString(), platform: process.platform, node: process.version, mode: s.mode, connection: s.connection, roles: s.roles, inferenceAttempted: false };
  await writeFile(new URL('../docs/probe-result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await controller.disconnect(); }
