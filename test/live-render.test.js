import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLiveFrame } from '../src/live-render.js';
import { visibleWidth } from '../src/tui-render.js';
const plain = text => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
function state() {
  return { mode: 'live', status: 'running', stage: 'inspection', models: { worker: 'gpt-6.1-sol', reviewer: 'gpt-6-astra' },
    goal: '查看项目', task: { mode: 'inspect', cwd: 'C:\\projects\\example' }, events: [], threads: [{ id: 'w', role: 'worker', status: 'running' }],
    jev: { confidence: 0.95, effectiveRoute: 'execute', probabilities: { execute: 0.97, plan_review: 0.01, clarify: 0.02 } } };
}
test('live tree uses actual Jev probabilities, thread states and inactive role slots', () => {
  const s = state(), before = JSON.stringify(s), text = plain(renderLiveFrame(s));
  for (const label of ['ASTRA', 'Jev / TypeSafe', 'Sol / worker', 'explorer', 'researcher', '未启用', '97%', '1%', '2%', '置信度 95%', 'LIVE / 真实工作流', '只读分析', '未运行测试']) assert.ok(text.includes(label), label);
  assert.doesNotMatch(text, /DEMO|SYNTHETIC|sample|NO AUTH|back to sol/);
  assert.equal(JSON.stringify(s), before);
});
test('waiting Jev never fabricates probabilities; failed run remains failed', () => {
  const s = state(); delete s.jev; s.status = 'failed'; s.stage = 'failed'; s.error = 'Jev API 返回 HTTP 401';
  const text = plain(renderLiveFrame(s));
  assert.match(text, /失败/); assert.match(text, /HTTP 401/); assert.match(text, /分流概率尚未返回/);
  assert.doesNotMatch(text, /97%|置信度 0%/);
});
test('actual test result and final review are distinct from task completion', () => {
  const s = state(); s.task.mode = 'edit'; s.stage = 'review'; s.tests = { exitCode: 0 }; s.review = { verdict: 'revise' }; s.status = 'blocked';
  const text = plain(renderLiveFrame(s));
  assert.match(text, /测试退出码 0/); assert.match(text, /需修改/); assert.match(text, /受阻/);
});
test('live tree fits target terminal sizes including CJK and long goals', () => {
  for (const [columns, rows] of [[80, 38], [80, 40], [90, 46], [120, 40], [168, 40], [200, 70]]) {
    const s = state(); s.goal = '项目分析'.repeat(100);
    const frame = renderLiveFrame(s, { columns, rows });
    assert.equal(visibleWidth(plain(frame)), Math.min(columns - 1, 200) * Math.min(rows, 70));
    for (const match of frame.matchAll(/\x1b\[(\d+);1H/g)) assert.ok(Number(match[1]) <= rows);
  }
});
test('saved result has clear historical label; view toggle and ASCII work', () => {
  const s = state(); s.status = 'completed'; s.threads[0].status = 'completed';
  assert.match(plain(renderLiveFrame(s, { saved: true })), /SAVED RESULT/);
  assert.match(plain(renderLiveFrame(s, { saved: true, view: 'log' })), /SAVED RESULT/);
  assert.doesNotMatch(renderLiveFrame(s, { ascii: true }), /[┌─┐│└┘●▶▼]/);
  assert.match(renderLiveFrame(s, { view: 'log' }), /MISSION CONTROL/);
  assert.equal(renderLiveFrame(s, { tick: 0 }), renderLiveFrame(s, { tick: 5 }));
});
