import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Controller } from '../src/controller.js';
import { cleanText, cellWidth, visibleWidth, renderFrame } from '../src/tui-render.js';

const create = () => new Controller({ liveEnabled: false, audit: false, demoDelay: 1 });
test('TUI strips CSI, OSC, controls and bidi injection from event content', () => {
  const unsafe = '\x1b[2Jhello\x1b]52;c;c2VjcmV0\x07\x1b]8;;https://evil.test\x1b\\link\x1b]8;;\x1b\\\r\n\t\x00\x9b\u202e';
  const safe = cleanText(unsafe);
  assert.doesNotMatch(safe, /[\x00-\x1f\x7f-\x9f\u202e]/);
  assert.doesNotMatch(safe, /c2VjcmV0|https:\/\/evil/);
  assert.match(safe, /hello/);
});
test('TUI width handles CJK and combining marks without terminal padding drift', () => {
  assert.equal(cellWidth('界'), 2); assert.equal(cellWidth('A'), 1);
  assert.equal(visibleWidth('审核 DEMO'), 9); assert.equal(visibleWidth('e\u0301'), 1);
});
test('TUI frame stays inside 120x40 and remains explicitly demo', async () => {
  const c = create(); c.startDemo('success'); await c.background;
  const frame = renderFrame(c.snapshot(), { columns: 120, rows: 40 });
  assert.match(frame, /DEMO \/ SYNTHETIC EVENTS/); assert.match(frame, /NO AUTH/);
  assert.doesNotMatch(frame, /\x1b\]/);
  const plain = frame.replace(/\x1b\[(?:\d+;)*\d*[A-Za-z]/g, '');
  assert.equal(visibleWidth(plain), 119 * 40);
});
test('TUI small terminal gives resize instructions and quit control', () => {
  for (const [columns, rows] of [[40, 12], [80, 24], [20, 8]]) {
    const frame = renderFrame(create().snapshot(), { columns, rows });
    assert.match(frame, /Quit/); assert.doesNotMatch(frame, /undefined|NaN/);
  }
});
test('TUI projects controller failure/approval states without fabricated success', async () => {
  for (const scenario of ['repeated-error', 'approval']) {
    const c = create(); c.startDemo(scenario); await c.background;
    const frame = renderFrame(c.snapshot(), { columns: 120, rows: 40, scenario });
    assert.match(frame, /PAUSED/); assert.match(frame, /NO MODEL CALLS/);
    assert.equal(c.snapshot().connection.ready, false); assert.equal(c.rpc, null);
  }
});
test('TUI non-TTY exits with actionable message without screen escapes', () => {
  const result = spawnSync(process.execPath, ['scripts/tui.js'], { encoding: 'utf8', env: { PATH: process.env.PATH, CONTROL_PANEL_ENABLE_LIVE: '1', CONTROL_PANEL_ISOLATED_ENV: '1' } });
  assert.equal(result.status, 1); assert.match(result.stderr, /interactive terminal/); assert.equal(result.stdout, '');
});
test('TUI never exceeds actual tiny or degenerate terminal dimensions', () => {
  for (const [columns, rows] of [[1, 1], [10, 4], [20, 7], [0, 0]]) {
    const frame = renderFrame(create().snapshot(), { columns, rows });
    const plain = frame.replace(/\x1b\[(?:\d+;)*\d*[A-Za-z]/g, '');
    assert.equal(visibleWidth(plain), Math.max(0, columns - 1) * rows);
    for (const match of frame.matchAll(/\x1b\[(\d+);1H/g)) assert.ok(Number(match[1]) <= rows);
  }
});
test('reference layout preserves topology, demo labels and centered width across reference/wide terminals', async () => {
  const c = create(); c.startDemo('success'); await c.background;
  for (const [columns, rows] of [[80, 40], [90, 46], [120, 40], [168, 40], [200, 70]]) {
    const frame = renderFrame(c.snapshot(), { columns, rows, tick: 8 });
    const plain = frame.replace(/\x1b\[(?:\d+;)*\d*[A-Za-z]/g, '');
    assert.equal(visibleWidth(plain), Math.min(columns - 1, 200) * Math.min(rows, 70));
    for (const label of ['ASTRA', 'REFERENCE SCHEMATIC', 'NOT CONNECTED', 'worker', 'explorer', 'researcher', 'back to sol', 'session log', 'NO AUTH']) assert.match(plain, new RegExp(label));
    assert.doesNotMatch(plain, /\$2|\/ 1M|1,299|forks\s+\d/);
  }
});
test('layout toggle and decorative flow animation do not mutate controller state', async () => {
  const c = create(); c.startDemo('success'); await c.background;
  const state = c.snapshot(), original = JSON.stringify(state);
  const first = renderFrame(state, { tick: 0 });
  const later = renderFrame(state, { tick: 10 });
  assert.notEqual(first, later);
  assert.match(renderFrame(state, { view: 'dashboard' }), /MISSION CONTROL/);
  assert.equal(JSON.stringify(state), original);
});
test('reference has Unicode/truecolor by default and explicit ASCII fallback', async () => {
  const c = create(); c.startDemo('success'); await c.background;
  const rich = renderFrame(c.snapshot(), { columns: 120, rows: 40 });
  const ascii = renderFrame(c.snapshot(), { columns: 120, rows: 40, ascii: true });
  assert.match(rich, /┌/); assert.match(rich, /│/); assert.match(rich, /●/);
  assert.match(rich, /\x1b\[48;2;26;29;36m/);
  assert.match(rich, /retry \/ stop/);
  assert.doesNotMatch(ascii, /[┌─┐│└┘●◆◇▶▼┬]/);
  const strip = value => value.replace(/\x1b\[(?:\d+;)*\d*[A-Za-z]/g, '');
  assert.equal(visibleWidth(strip(rich)), visibleWidth(strip(ascii)));
});
