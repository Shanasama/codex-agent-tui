#!/usr/bin/env node
// Demo-only ANSI terminal frontend. No HTTP listener or Codex subprocess.
import { emitKeypressEvents } from 'node:readline';
import { Controller } from '../src/controller.js';
import { renderFrame } from '../src/tui-render.js';

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Codex TUI requires an interactive terminal (TTY). Open CMD / PowerShell / Windows Terminal or a desktop terminal, then run: node scripts/tui.js');
  process.exitCode = 1;
} else {
  const controller = new Controller({ liveEnabled: false, audit: false, demoDelay: 1600 });
  // Defense in depth: this entrypoint cannot create an app-server or infer.
  controller.connect = async () => { throw new Error('TUI preview is DEMO ONLY'); };
  controller.startRun = () => { throw new Error('TUI preview is DEMO ONLY'); };
  const ascii = process.argv.includes('--ascii');
  let view = 'reference';
  let tick = 0, scenario = 'success', started = Date.now(), elapsed = 0;
  let logOffset = 0, notice = '', closing = false, switching = false, looping = false, finishedAt = null;
  const wasRaw = Boolean(process.stdin.isRaw); let timer;
  const draw = () => {
    if (closing) return;
    const state = controller.snapshot();
    if (state.run?.status === 'running') { elapsed = Date.now() - started; finishedAt = null; }
    else if (state.run && !finishedAt) finishedAt = Date.now();
    if (looping && !switching && finishedAt && Date.now() - finishedAt > 2500) { finishedAt = null; void play(scenario); }
    process.stdout.write(renderFrame(state, { columns: process.stdout.columns || 120, rows: process.stdout.rows || 40, tick: tick++, scenario, view, ascii, elapsed, logOffset, notice: notice || (looping ? 'LOOP ON - [L] disables repeat; synthetic events only.' : '') }));
  };
  const cleanup = () => {
    if (closing) return; closing = true;
    clearInterval(timer); controller.generation++; controller.store.removeAllListeners();
    process.stdin.off('keypress', onKeypress); process.stdout.off('resize', draw);
    if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
    process.stdin.pause(); process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  };
  const quit = (code = 0) => { cleanup(); process.exitCode = code; };
  const play = async name => {
    if (switching || closing) return; switching = true;
    try {
      await controller.interrupt();
      await controller.background; // drain previous fixture before replay
      if (closing) return;
      scenario = name; logOffset = 0; notice = ''; started = Date.now(); elapsed = 0;
      controller.startDemo(scenario); draw();
    } catch (error) { notice = `Preview error: ${String(error.message).replace(/[\x00-\x1f]/g, '')}`; draw(); }
    finally { switching = false; }
  };
  function onKeypress(value, key = {}) {
    const name = String(key.name || value || '').toLowerCase();
    if (name === 'q' || (key.ctrl && ['c', 'd'].includes(name))) return quit();
    if (name === 'up' || name === 'k') logOffset = Math.max(0, Math.min(controller.snapshot().events.length - 1, logOffset + 1));
    else if (name === 'down' || name === 'j') logOffset = Math.max(0, logOffset - 1);
    else if (name === '1') void play('success');
    else if (name === '2') void play('repeated-error');
    else if (name === '3') void play('approval');
    else if (name === 'v') view = view === 'reference' ? 'dashboard' : 'reference';
    else if (name === 'l') { looping = !looping; notice = ''; }
    else if (name === 'r') void play(scenario);
    draw();
  }
  process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l');
  process.stdin.setRawMode(true); process.stdin.setEncoding('utf8'); process.stdin.resume();
  emitKeypressEvents(process.stdin);
  process.stdin.on('keypress', onKeypress); process.stdout.on('resize', draw);
  process.once('SIGINT', () => quit()); process.once('SIGTERM', () => quit()); process.once('SIGHUP', () => quit());
  process.once('exit', cleanup);
  process.once('uncaughtException', error => { cleanup(); console.error(error.message); process.exitCode = 1; });
  process.once('unhandledRejection', error => { cleanup(); console.error(String(error)); process.exitCode = 1; });
  controller.store.on('change', draw);
  timer = setInterval(draw, 120);
  void play('success');
}
