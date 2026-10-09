// Local preview entrypoint: no account access, no real app-server or inference.
import { createServer } from '../src/server.js';
import { Controller } from '../src/controller.js';
import { prepareRuntime } from '../src/runtime.js';

await prepareRuntime();
const controller = new Controller({ liveEnabled: false });
controller.connect = async () => {
  throw new Error('本次预览仅演示，不连接真实 Codex。');
};
const app = createServer(controller);
app.server.listen(4317, '127.0.0.1', () => {
  console.log('DEMO ONLY: http://127.0.0.1:4317');
  controller.startDemo('success');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await app.close(); process.exit(0); });
}
