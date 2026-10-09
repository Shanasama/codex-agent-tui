import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { RUNTIME } from './runtime.js';
import { safeText } from './state.js';

export const CLI_RUNS = path.join(RUNTIME, 'cli-workflows');
const stages = ['plan', 'work', 'tests', 'review', 'done'];
const statuses = ['running', 'completed', 'blocked', 'skipped'];
export class CliWorkflowStore {
  constructor({ directory = CLI_RUNS, route, onChange = async () => {} } = {}) { this.directory = directory; this.route = route; this.onChange = onChange; this.currentId = null; }
  async notify(run, event) {
    try { await this.onChange(structuredClone(run), event); }
    catch (error) { run.visualizationError = safeText(error.message, 300); await this.save(run); }
  }
  async save(run) { await mkdir(this.directory, { recursive: true }); await writeFile(path.join(this.directory, `${run.id}.json`), JSON.stringify(run, null, 2)); }
  async read(id = this.currentId) {
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('请使用 route_task 返回的 run_id');
    return JSON.parse(await readFile(path.join(this.directory, `${id}.json`), 'utf8'));
  }
  async begin({ goal, mode = 'inspect' }) {
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000 || !['inspect', 'edit'].includes(mode)) throw new Error('任务需要 1–4000 字符的 goal 和 inspect/edit 模式');
    const run = { id: randomUUID(), goal: safeText(goal, 4000), mode, decision: null, routing: 'running', status: 'running', startedAt: new Date().toISOString(), stages: [], source: 'native-codex-cli' };
    await this.save(run); this.currentId = run.id; await this.notify(run, 'start');
    try {
      run.decision = await this.route({ goal: goal.trim(), mode, fixture: false });
      run.routing = 'completed';
      run.routedAt = new Date().toISOString();
      if (run.decision.effectiveRoute === 'clarify') run.status = 'blocked';
      await this.save(run); await this.notify(run, 'update');
      return { run_id: run.id, decision: run.decision, workflow: this.format(run), next: run.decision.effectiveRoute, ...(run.visualizationError ? { window_error: run.visualizationError } : {}) };
    } catch (error) {
      run.routing = 'failed'; run.status = 'blocked'; run.error = safeText(error.message, 500);
      await this.save(run); await this.notify(run, 'update'); throw error;
    }
  }
  async update({ run_id, stage, status, summary, evidence = [] }) {
    if (!stages.includes(stage) || !statuses.includes(status) || typeof summary !== 'string' || !summary.trim() || summary.length > 2000 || !Array.isArray(evidence) || evidence.length > 20 || evidence.some(e => typeof e !== 'string' || e.length > 2000)) throw new Error('阶段、状态或证据格式无效');
    const run = await this.read(run_id);
    if (run.mode === 'inspect' && stage === 'tests' && status === 'completed') throw new Error('只读模式不能记录测试通过，应使用 skipped');
    if (status === 'completed' && !evidence.length) throw new Error('完成状态必须附带本会话实际工具结果的证据摘要');
    const entry = { stage, status, summary: safeText(summary, 2000), evidence: evidence.map(e => safeText(e, 2000)), source: 'cli-reported', time: new Date().toISOString() };
    const i = run.stages.findIndex(s => s.stage === stage);
    if (i < 0) run.stages.push(entry); else run.stages[i] = entry;
    run.status = status === 'blocked' ? 'blocked' : stage === 'done' && status === 'completed' ? 'completed' : 'running';
    if (run.status === 'completed') run.finishedAt = entry.time;
    await this.save(run); await this.notify(run, 'update');
    return { run_id: run.id, stage: entry, workflow: this.format(run), ...(run.visualizationError ? { window_error: run.visualizationError } : {}) };
  }
  format(run) {
    const state = { running: '进行中', completed: '完成', blocked: '受阻', skipped: '跳过' };
    const name = { plan: '计划', work: run.mode === 'inspect' ? '查看' : '执行', tests: '测试', review: '复核', done: '交付' };
    const lines = [run.decision ? `Jev ${run.decision.model} → ${run.decision.effectiveRoute}（置信度 ${Math.round(run.decision.confidence * 100)}%）` : `Jev ${run.routing === 'failed' ? '请求失败' : '等待决策'}`];
    lines.push(stages.map(stage => { const s = run.stages.find(s => s.stage === stage); return `${name[stage]}[${s ? state[s.status] : '待开始'}]`; }).join(' → '));
    lines.push('Jev 决策来自 API；执行阶段由当前 CLI 报告，未由插件独立复验。');
    return lines.join('\n');
  }
}
