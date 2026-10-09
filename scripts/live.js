#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { LiveController } from '../src/live-controller.js';
import { prepareLiveRuntime, liveEnv, LIVE_HOME, createTaskWorkspace } from '../src/live-workspace.js';
import { codexCommand } from '../src/runtime.js';
import { renderLiveFrame } from '../src/live-render.js';
import { cleanText } from '../src/tui-render.js';
import { JevClient, loadJevKey } from '../src/jev.js';
import { readTaskInput } from '../src/live-input.js';
import { readFile } from 'node:fs/promises';

export async function main() {
  const { values } = parseArgs({ options: {
    login: { type: 'boolean' }, check: { type: 'boolean' }, fixture: { type: 'boolean' },
    project: { type: 'string' }, goal: { type: 'string' }, 'test-args': { type: 'string' },
    mode: { type: 'string' },
    result: { type: 'string' }, ascii: { type: 'boolean' }, view: { type: 'string' },
    'no-window': { type: 'boolean' },
    'worker-model': { type: 'string' }, 'reviewer-model': { type: 'string' },
  } });
  await prepareLiveRuntime();
  if (values.login) {
    // Official interactive login owns authentication. Never read or copy auth files.
    const binary = await codexCommand();
    console.log(`请在官方登录流程中完成授权。独立配置目录：${LIVE_HOME}`);
    const child = spawn(binary, ['login'], { env: liveEnv(), stdio: 'inherit', shell: false });
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => { process.exitCode = code ?? 1; resolve(); }); });
    return;
  }
  if (!values.check && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('真实任务需要交互终端；连接诊断可用 npm run live:check。');
  if (values.view && !['tree', 'log'].includes(values.view)) throw new Error('--view 仅支持 tree 或 log');
  let drawing = false, offset = 0, closing = false, prompt, timer, tick = 0, finished = false, finishWaiter, savedState;
  let view = values.view || 'tree';
  const oldRaw = Boolean(process.stdin.isRaw);
  const controller = new LiveController({ workerModel: values['worker-model'], reviewerModel: values['reviewer-model'], approve: async request => {
    screenOff();
    console.log('\n操作需要授权（仅本次有效）：');
    for (const line of JSON.stringify(request, null, 2).split('\n')) console.log(cleanText(line));
    prompt = createInterface({ input: process.stdin, output: process.stdout });
    let answer = '';
    try { answer = await prompt.question('允许此操作？输入 y 同意，其余输入拒绝：'); }
    catch { /* closing a prompt declines */ }
    finally { prompt.close(); prompt = null; }
    if (!closing) screenOn();
    return answer.trim().toLowerCase() === 'y';
  } });
  const draw = () => { if (drawing) process.stdout.write(renderLiveFrame(savedState || controller.snapshot(), { columns: process.stdout.columns, rows: process.stdout.rows, offset, view, tick: tick++, saved: Boolean(savedState), ascii: values.ascii })); };
  function screenOff() {
    if (!drawing) return; drawing = false;
    clearInterval(timer);
    process.stdin.off('keypress', onKey); process.stdin.setRawMode(oldRaw);
    process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  }
  function screenOn() {
    drawing = true; process.stdout.write('\x1b[?1049h\x1b[2J\x1b[?25l');
    process.stdin.setRawMode(true); emitKeypressEvents(process.stdin); process.stdin.on('keypress', onKey); process.stdin.resume(); draw();
    timer = setInterval(() => { if (!finished && controller.state.status === 'running') draw(); }, 160);
  }
  async function quit() {
    if (closing) return; closing = true; prompt?.close(); screenOff();
    if (!finished) await controller.interrupt(); else await controller.close();
    finishWaiter?.(); process.stdin.pause();
  }
  function onKey(value, key = {}) {
    if (key.name === 'q' || (key.ctrl && ['c', 'd'].includes(key.name))) { void quit(); return; }
    if (key.name === 'v') view = view === 'tree' ? 'log' : 'tree';
    if (key.name === 'up') offset = Math.min((savedState || controller.state).events.length, offset + 1);
    if (key.name === 'down') offset = Math.max(0, offset - 1);
    draw();
  }
  process.once('SIGINT', quit); process.once('SIGTERM', quit);
  controller.on('change', draw); process.stdout.on('resize', draw);
  try {
    if (values.result) {
      savedState = JSON.parse(await readFile(values.result, 'utf8'));
      if (savedState.mode !== 'live' || !Array.isArray(savedState.events) || !Array.isArray(savedState.threads) || typeof savedState.models?.worker !== 'string' || typeof savedState.models?.reviewer !== 'string') throw new Error('不是有效的真实任务结果文件');
      finished = true; screenOn();
      if (!closing) await new Promise(resolve => { finishWaiter = resolve; });
      screenOff();
      for (const line of (savedState.report || savedState.review?.summary || savedState.error || '').split('\n')) console.log(cleanText(line));
      return;
    }
    console.log('正在连接独立 Codex 环境…'); await controller.connect();
    if (closing) return;
    if (values.check) { console.log(controller.state.events.at(-1).message); return; }
    controller.jev = new JevClient({ apiKey: await loadJevKey() });
    await controller.jev.check();
    console.log('Jev 已连接。运行时仅发送任务描述和工作区类型，不发送源代码。');
    prompt = createInterface({ input: process.stdin, output: process.stdout });
    const input = await readTaskInput(values, text => prompt.question(text));
    prompt.close(); prompt = null;
    const task = await createTaskWorkspace(input);
    screenOn();
    const result = await controller.run(task, input.goal);
    finished = true;
    await controller.close(); draw();
    // Keep the completed workflow visible; Q returns to the readable report.
    if (!closing) await new Promise(resolve => { finishWaiter = resolve; });
    screenOff();
    console.log(`\n任务状态：${result.status}\n${task.mode === 'inspect' ? '只读查看目录' : '任务副本'}：${task.cwd}\n结果记录：${task.directory}\\result.json`);
    if (result.report) for (const line of result.report.split('\n')) console.log(cleanText(line));
    if (result.error) console.log(cleanText(result.error));
    if (result.review) console.log(cleanText(result.review.summary));
    if (result.status !== 'completed') process.exitCode = 1;
  } finally {
    screenOff(); clearInterval(timer); prompt?.close(); await controller.close(); process.stdin.pause();
    process.stdout.off('resize', draw); process.off('SIGINT', quit); process.off('SIGTERM', quit);
    process.stdin.unref?.();
    if (closing) process.stdin.destroy();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(cleanText(error.message)); process.exitCode = 1; });
}
