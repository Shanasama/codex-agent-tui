import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT, RUNTIME } from './runtime.js';
import { safeText } from './state.js';

export const WORKFLOW_VIEW = path.join(RUNTIME, 'workflow-view.json');
const labels = { running: '运行中', inProgress: '运行中', completed: '已完成', failed: '失败', blocked: '受阻', interrupted: '已中断', ready: '已就绪', idle: '待开始', pass: '通过', revise: '需修改' };
const label = s => labels[s] || s || '等待';
export function projectWorkflow(state, saved = false) {
  const inspect = state.task?.mode === 'inspect';
  const worker = state.threads?.filter(t => t.role === 'worker').at(-1);
  const reviewer = state.threads?.filter(t => t.role === 'reviewer').at(-1);
  const terminal = ['completed', 'failed', 'blocked', 'interrupted'].includes(state.status);
  const threadStatus = t => t?.status === 'running' && terminal ? '已停止' : t ? label(t.status) : '尚未派发';
  const routeNames = { execute: '直接执行', plan_review: inspect ? '报告复核' : '计划审查', clarify: '补充信息' };
  return {
    schema: 1, updatedAt: new Date().toISOString(), runId: state.task?.id || null,
    elapsedMs: state.startedAt ? Math.max(0,(state.finishedAt ? Date.parse(state.finishedAt) : Date.now())-Date.parse(state.startedAt)) : 0,
    source: saved ? '历史结果' : terminal ? '任务结果' : '实时同步',
    status: label(state.status), statusCode: state.status, mode: inspect ? '只读查看' : '代码修改',
    goal: safeText(state.goal || '等待任务', 300),
    jevModel: state.jev?.model || '等待 Jev',
    probabilities: ['execute', 'plan_review', 'clarify'].map(key => ({ key, label: routeNames[key], value: Number.isFinite(state.jev?.probabilities?.[key]) ? state.jev.probabilities[key] : null })),
    decision: state.jev ? `置信度 ${Math.round(state.jev.confidence * 100)}% · ${routeNames[state.jev.effectiveRoute]}` : state.stage === 'jev-routing' ? '正在请求真实决策…' : '尚无决策数据',
    workerModel: state.models?.worker || 'Sol', workerAction: inspect ? '只读分析' : '修改代码', workerStatus: threadStatus(worker),
    workerTitle: 'SOL', reviewerTitle: 'ASTRA', reviewerStatusLabel: '实际线程', reviewerNote: '只读审查', reviewerNoteDetail: '不修改文件',
    reviewerModel: state.models?.reviewer || 'Astra', reviewerStatus: threadStatus(reviewer),
    plan: state.planReview ? label(state.planReview.verdict) : state.stage === 'plan-review' ? '运行中' : '未触发',
    review: state.review ? label(state.review.verdict) : state.stage === 'review' ? '运行中' : inspect && state.jev?.effectiveRoute === 'execute' ? '本次未触发' : '等待',
    outcomeTitle: inspect ? '项目报告' : '验收结果',
    outcomeDetail: inspect ? `已读材料 ${state.inspectionEvidence?.files?.length || 0} 份 · 未运行测试` : `测试退出码 ${state.tests?.exitCode ?? '待运行'} · 审查 ${state.review ? label(state.review.verdict) : '等待'}`,
    event: safeText(state.error || state.events?.at(-1)?.message || '等待工作流事件', 400),
    currentStage: state.stage,
    events: (state.events || []).slice(-4).map(e=>({time:e.time||'',type:e.type||'status',message:safeText(e.message,400)})),
  };
}
export function projectCliWorkflow(run) {
  const stage = name => run.stages.find(s => s.stage === name);
  const names = { completed: '完成', running: '进行中', blocked: '受阻', skipped: '跳过' };
  const text = name => stage(name) ? names[stage(name).status] : '待开始';
  const decision = run.decision;
  const latest = [...run.stages].sort((a,b) => (Date.parse(a.time) || 0) - (Date.parse(b.time) || 0)).at(-1);
  const status = run.error || latest?.status === 'blocked' || decision?.effectiveRoute === 'clarify' ? 'blocked' : latest?.stage === 'done' && latest.status === 'completed' ? 'completed' : 'running';
  const view = projectWorkflow({
    status,
    stage: run.routing === 'running' ? 'jev-routing' : 'cli', task: { id: run.id, mode: run.mode }, goal: run.goal, jev: decision,
    models: {}, threads: [], events: [], error: run.error, startedAt:run.startedAt, finishedAt:run.finishedAt,
  });
  return { ...view, source: run.source === 'integration-fixture' ? '测试夹具' : 'CLI 阶段报告',
    workerTitle: 'CODEX', workerModel: '当前 CLI 会话', workerStatus: text('work'),
    reviewerTitle: 'REVIEW', reviewerModel: 'CLI · 非独立验收', reviewerStatusLabel: '状态来源', reviewerStatus: '由 CLI 上报',
    reviewerNote: '无独立线程记录', reviewerNoteDetail: '不推定已调用 Astra',
    plan: text('plan'), review: text('review'),
    outcomeTitle: run.mode === 'inspect' ? '只读查看' : '执行结果',
    outcomeDetail: `执行 ${text('work')} · 测试 ${run.mode === 'inspect' ? '不适用' : text('tests')} · 复核 ${text('review')}`,
    event: safeText(run.error || latest?.summary || (decision ? `Jev 已分流：${decision.effectiveRoute}；等待 CLI 上报进展` : '正在等待 Jev 决策'), 400),
    currentStage: latest?.stage === 'plan' ? 'plan-review' : latest?.stage === 'review' ? 'completion-review' : latest?.stage || 'jev-routing',
    events: [
      ...(decision ? [{time:run.routedAt||'',type:'jev',message:`${decision.model}: ${decision.effectiveRoute} / confidence ${decision.confidence}`}] : []),
      ...[...run.stages].sort((a,b)=>(Date.parse(a.time)||0)-(Date.parse(b.time)||0)).map(s=>({time:s.time||'',type:s.stage==='review'?'review':s.stage,message:safeText(s.summary,400)})),
      ...(run.error ? [{time:'',type:'error',message:safeText(run.error,400)}] : []),
    ].slice(-4),
  };
}
export function createWorkflowPublisher(file = WORKFLOW_VIEW) {
  let pending = Promise.resolve();
  return {
    publish(state, saved = false) { return this.publishView(projectWorkflow(state, saved)); },
    publishView(view) {
      const content = JSON.stringify(view);
      pending = pending.catch(() => {}).then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, content, 'utf8');
        for (let attempt = 0; ; attempt++) {
          try { await rename(temporary, file); break; }
          catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 25)); }
        }
      });
      return pending;
    },
    flush: () => pending,
  };
}
export function createCliWindowBridge({ stateFile = path.join(RUNTIME, 'cli-workflows', `window-${process.pid}.json`), publisher = createWorkflowPublisher(stateFile), open = openWorkflowWindow } = {}) {
  return async (run, event) => {
    await publisher.publishView(projectCliWorkflow(run));
    if (event === 'start') await open({ stateFile });
  };
}
export async function waitForWindowReady({ stateFile, launchId, child, timeoutMs = 15000, pollMs = 100 }) {
  const started = Date.now(); let exit = null;
  const onExit = (code, signal) => { exit = { code, signal, at: Date.now() }; };
  child.once('exit', onExit);
  try {
    while (Date.now() - started < timeoutMs) {
      try {
        const status = JSON.parse(await readFile(`${stateFile}.window.json`, 'utf8'));
        if (status.launchId === launchId && status.visible === true && status.rendered === true && Number.isInteger(status.pid) && status.pid > 0) return status;
      } catch { /* The viewer may still be starting or replacing its status file. */ }
      if (exit && (exit.code !== 0 || Date.now() - exit.at > 1500)) {
        throw new Error(`工作流窗口脚本在显示前退出 (${exit.code ?? exit.signal})`);
      }
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    throw new Error('工作流窗口未返回可见且已渲染的确认');
  } finally { child.off('exit', onExit); }
}
export async function openWorkflowWindow({ stateFile = WORKFLOW_VIEW, snapshotDirectory } = {}) {
  if (process.platform !== 'win32') throw new Error('独立原生工作流窗口目前支持 Windows');
  const launchId = randomUUID();
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(`${stateFile}.launch-request.json`, JSON.stringify({ launchId }));
  const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', path.join(ROOT, 'scripts', 'workflow-window.ps1'), '-StateFile', stateFile, '-NodePath', process.execPath, '-LaunchId', launchId];
  if (snapshotDirectory) args.push('-SnapshotDirectory', snapshotDirectory);
  const stderrFile = `${stateFile}.launch.stderr.log`, fd = openSync(stderrFile, 'w');
  let child;
  // DETACHED_PROCESS makes Windows PowerShell exit before executing its script
  // on this host. Hide the console, but keep normal process creation semantics.
  try { child = spawn('powershell.exe', args, { windowsHide: true, detached: false, stdio: ['ignore', 'ignore', fd] }); }
  finally { closeSync(fd); }
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    if (snapshotDirectory) {
      await new Promise((resolve, reject) => { child.once('exit', code => code === 0 ? resolve() : reject(new Error(`工作流窗口渲染失败 (${code})`))); });
      return child.pid;
    }
    const ready = await waitForWindowReady({ stateFile, launchId, child });
    child.unref();
    return ready.pid;
  } catch (error) {
    const diagnostic = safeText((await readFile(stderrFile, 'utf8').catch(() => '')).trim(), 500);
    const message = error.message + (diagnostic ? `：${diagnostic}` : '');
    await writeFile(`${stateFile}.launch-error.json`, JSON.stringify({ launchId, error: message, time: new Date().toISOString() }));
    child?.unref();
    throw new Error(message);
  }
}
