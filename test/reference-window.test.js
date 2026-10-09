import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFrame, cellWidth } from '../src/tui-render.js';
import { StateStore } from '../src/state.js';
import { projectCliWorkflow } from '../src/workflow-window.js';
import { buildReferenceWindowFrame, terminalFrameFromAnsi } from '../src/reference-window-frame.js';
const view = () => projectCliWorkflow({id:'test',mode:'edit',goal:'还原 demo',status:'running',stages:[{stage:'work',status:'running',summary:'实际更新内容',time:'2026-10-09T05:00:00Z'}],decision:{model:'jev-test',confidence:0.95,effectiveRoute:'execute',probabilities:{execute:0.97,plan_review:0.01,clarify:0.02}}});
function positions(frame, pattern) {
  const out=[]; for(const s of frame.segments){let x=s.x;for(const c of s.text){if(pattern.test(c))out.push(`${x},${s.y},${c}`);x+=cellWidth(c);}} return out.sort();
}
test('window and original demo share identical box corner coordinates', () => {
  const store=new StateStore();store.newRun('fixture','demo');
  const original=terminalFrameFromAnsi(renderFrame(store.snapshot(),{columns:120,rows:46}));
  const actual=buildReferenceWindowFrame(view());
  assert.deepEqual(positions(actual,/[┌┐└┘]/),positions(original,/[┌┐└┘]/));
  assert.equal(actual.background,'#1a1d24');
});
test('three role nodes remain on the same row with the original order', () => {
  const frame=buildReferenceWindowFrame(view());
  const roles=['worker','explorer','researcher'].map(name=>frame.segments.find(s=>s.text.trim()===name));
  assert.ok(roles.every(Boolean));assert.equal(new Set(roles.map(s=>s.y)).size,1);
  assert.ok(roles[0].x<roles[1].x&&roles[1].x<roles[2].x);
});
test('true probabilities and actual event log replace demo values without fake agent activity', () => {
  const frame=buildReferenceWindowFrame(view());const text=frame.segments.map(s=>s.text).join('');
  for(const value of ['97%','1%','2%','session log / actual reports','NOT ENABLED','REFERENCE ROLE'])assert.ok(text.includes(value),value);
  assert.doesNotMatch(text,/SYNTHETIC|VISUAL DEMO|sample/);
  for(const s of frame.segments){assert.ok(s.x>=0&&s.y>=0);assert.ok(s.x+s.width<=frame.columns);assert.ok(s.y<frame.rows);}
});
test('terminal controls from task content cannot escape the canvas', () => {
  const data=view();data.goal='unsafe\x1b]52;c;secret\x07\x1b[2J';
  const result=buildReferenceWindowFrame(data);
  assert.doesNotMatch(JSON.stringify(result),/secret|\\u001b/);
});
