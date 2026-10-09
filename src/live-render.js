import { cleanText, cellWidth, visibleWidth } from './tui-render.js';
function clip(value, width) {
  let result = '', used = 0;
  for (const ch of cleanText(value)) { const n = cellWidth(ch); if (used + n > width) break; used += n; result += ch; }
  return result;
}
export function renderLiveLogFrame(state, { columns = 120, rows = 40, offset = 0, saved = false, notice = '' } = {}) {
  const width = Math.max(0, Math.min(columns - 1, 200)), height = Math.max(0, Math.min(rows, 80));
  const inspect = state.task?.mode === 'inspect';
  const lines = [
    saved ? 'CODEX // MISSION CONTROL                       SAVED RESULT / 历史结果' : 'CODEX // MISSION CONTROL                       LIVE / REAL EXECUTION',
    inspect ? '流程：Jev 分流 -> 只读查看 -> 项目报告 / 报告复核' : '流程：Jev 分流 -> 执行 / 计划审查 -> 验收测试 -> 最终审查',
    state.jev ? `Jev：${state.jev.model} / ${state.jev.effectiveRoute} / confidence ${state.jev.confidence}` : 'Jev：等待决策（未生成概率）',
    `状态：${state.status}    阶段：${state.stage}`,
    `任务：${state.goal || '等待连接与输入'}`,
    `${inspect ? '只读目录' : '副本'}：${state.task?.cwd || '-'}`,
    '-'.repeat(width),
    `${inspect ? '查看角色' : '执行角色'}  ${state.models.worker}  ${state.threads.filter(t => t.role === 'worker').at(-1)?.status || 'waiting'}`,
    `审查角色  ${state.models.reviewer}  ${state.threads.filter(t => t.role === 'reviewer').at(-1)?.status || 'waiting'}`,
    inspect ? `测试：不适用（只读查看）    报告复核：${state.review?.verdict || '未要求'}` : `测试退出码：${state.tests?.exitCode ?? '尚无结果'}    审查：${state.review?.verdict || '尚无结果'}`,
    '-'.repeat(width),
  ];
  const available = Math.max(0, height - lines.length - 2);
  const end = Math.max(0, state.events.length - offset);
  for (const event of state.events.slice(Math.max(0, end - available), end)) lines.push(`${event.time.slice(11, 19)} [${event.type}] ${event.message}`);
  while (lines.length < height - 2) lines.push('');
  lines.push('[V] 工作流图  [↑/↓] 滚动日志  [Q] 退出 / 查看报告');
  lines.push(notice || (inspect ? '只读查看完成表示报告已生成，不表示代码修改或测试通过。' : '完成依据：真实文件修改 + 指定测试退出码 0 + 独立审查通过'));
  return '\x1b[H' + lines.slice(0, height).map((line, i) => `\x1b[${i + 1};1H${i === 0 ? '\x1b[1;36m' : '\x1b[0m'}${clip(line, width)}\x1b[K`).join('') + '\x1b[0m';
}

const labels = { idle: '待开始', ready: '已就绪', running: '运行中', inProgress: '运行中', completed: '已完成', failed: '失败', blocked: '受阻', interrupted: '已中断', approval: '待授权', pending: '等待', unused: '未启用', skipped: '不适用', pass: '通过', revise: '需修改' };
const label = value => labels[value] || value || '等待';
const colorFor = value => ['completed', 'pass'].includes(value) ? 'green' : ['failed', 'blocked'].includes(value) ? 'red' : ['running', 'inProgress'].includes(value) ? 'cyan' : ['approval', 'interrupted', 'revise'].includes(value) ? 'amber' : 'dim';
const palette = { base: [211,214,224], dim: [151,155,168], border: [75,79,88], cyan: [143,215,219], green: [137,220,158], purple: [187,165,233], blue: [143,182,231], amber: [228,193,138], red: [229,137,149], white: [239,239,246] };

// Same visual language as the original reference TUI: Astra rail, central
// decision node, three role slots and an outcome node. Every value is live data.
export function renderLiveFrame(state, options = {}) {
  const { columns = 120, rows = 40, offset = 0, view = 'tree', tick = 0, saved = false, ascii = false, now = Date.now() } = options;
  if (view === 'log' || columns < 80 || rows < 38) return renderLiveLogFrame(state, { ...options, notice: view === 'tree' ? '放大终端至 80 列 × 38 行以上显示完整工作流图，推荐最大化窗口。' : '' });
  const canvasW = Math.max(0, Math.min(columns - 1, 200)), w = Math.min(canvasW, 120), h = Math.min(rows, 70), left = Math.floor((canvasW - w) / 2);
  const grid = Array.from({ length: h }, () => Array.from({ length: canvasW }, () => ({ c: ' ', color: 'base' })));
  const g = ascii ? { h: '-', v: '|', tl: '+', tr: '+', bl: '+', br: '+', down: 'v', arrow: '>', dot: '*' } : { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘', down: '▼', arrow: '▶', dot: '●' };
  const put = (x, y, value, color = 'base', limit = w - x) => {
    if (y < 0 || y >= h) return;
    let used = 0;
    for (const c of cleanText(value)) {
      const n = cellWidth(c); if (!n) continue;
      if (used + n > limit || x + n > w) break;
      if (x >= 0) { grid[y][x + left] = { c, color }; if (n === 2) grid[y][x + left + 1] = { c: '', color }; }
      x += n; used += n;
    }
  };
  const center = (x, y, width, text, color) => put(x + Math.max(0, Math.floor((width - visibleWidth(text)) / 2)), y, text, color, width);
  const line = (x, y, width, color = 'border') => put(x, y, g.h.repeat(Math.max(0, width)), color);
  const vertical = (x, y1, y2, color = 'border') => { for (let y = y1; y <= y2; y++) put(x, y, g.v, color); };
  const box = (x, y, width, height, color) => {
    put(x, y, g.tl + g.h.repeat(Math.max(0, width - 2)) + g.tr, color);
    for (let row = y + 1; row < y + height - 1; row++) { put(x, row, g.v, color); put(x + width - 1, row, g.v, color); }
    put(x, y + height - 1, g.bl + g.h.repeat(Math.max(0, width - 2)) + g.br, color);
  };
  const inspect = state.task?.mode === 'inspect', running = state.status === 'running' && !saved;
  const worker = state.threads.filter(t => t.role === 'worker').at(-1), reviewer = state.threads.filter(t => t.role === 'reviewer').at(-1);
  const sideX = 2, sideW = Math.max(21, Math.floor(w * 0.235));
  const rightX = sideX + sideW + 3, rightW = w - rightX - 2, cx = rightX + Math.floor(rightW / 2);
  const mainW = Math.min(42, rightW), mainX = cx - Math.floor(mainW / 2);
  const jevW = Math.min(60, rightW), jevX = cx - Math.floor(jevW / 2);
  const outcomeY = h - 13, logY = h - 8;
  center(0, 1, w, 'CODEX AGENT TREE  /  JEV + SOL + ASTRA', 'white');
  line(2, 2, w - 4);
  put(3, 3, inspect ? '只读查看' : '代码修改', 'cyan');
  put(15, 3, label(state.status), colorFor(state.status), 14);
  put(w - 27, 3, saved ? 'SAVED RESULT / 历史结果' : 'LIVE / 真实工作流', saved ? 'amber' : 'green', 25);

  box(sideX, 5, sideW, outcomeY - 1, 'purple');
  center(sideX + 1, 6, sideW - 2, 'ASTRA', 'purple');
  put(sideX + 2, 7, state.models.reviewer, 'dim', sideW - 4);
  put(sideX + 2, 9, '计划审查', 'base', sideW - 4);
  put(sideX + 2, 10, state.planReview ? label(state.planReview.verdict) : state.stage === 'plan-review' ? '运行中' : '未触发', state.stage === 'plan-review' ? 'purple' : colorFor(state.planReview?.verdict), sideW - 4);
  put(sideX + 2, 12, inspect ? '报告复核' : '完成审查', 'base', sideW - 4);
  put(sideX + 2, 13, state.review ? label(state.review.verdict) : state.stage === 'review' ? '运行中' : inspect && state.jev?.effectiveRoute === 'execute' ? '本次未触发' : '等待', state.stage === 'review' ? 'purple' : colorFor(state.review?.verdict), sideW - 4);
  put(sideX + 2, 15, '线程状态', 'dim', sideW - 4);
  put(sideX + 2, 16, reviewer ? label(reviewer.status) : '尚未创建', colorFor(reviewer?.status), sideW - 4);
  put(sideX + 2, 18, '只读审查 / 不改文件', 'dim', sideW - 4);
  if (h >= 42) { put(sideX + 2, 20, '实际审查线程', 'dim', sideW - 4); put(sideX + 2, 21, String(state.threads.filter(t => t.role === 'reviewer').length), 'purple'); }
  put(sideX + 2, outcomeY, state.stage === 'approval' ? '等待你授权' : '流程由程序调度', state.stage === 'approval' ? 'amber' : 'dim', sideW - 4);

  box(mainX, 5, mainW, 4, 'cyan');
  center(mainX + 1, 6, mainW - 2, 'TASK / 任务输入', 'cyan');
  center(mainX + 1, 7, mainW - 2, clip(state.goal || '等待任务', mainW - 4), 'base');
  vertical(cx, 9, 9); put(cx, 9, g.down, 'green');
  box(jevX, 10, jevW, 7, 'green');
  put(jevX + 2, 11, 'Jev / TypeSafe', 'green', jevW - 4);
  put(jevX + jevW - 17, 11, state.jev ? '已返回决策' : state.stage === 'jev-routing' ? '请求中' : '等待', 'dim', 15);
  const names = { execute: '直接执行', plan_review: '审查 / 复核', clarify: '补充信息' };
  ['execute', 'plan_review', 'clarify'].forEach((route, i) => {
    const p = state.jev?.probabilities?.[route];
    const barW = Math.max(3, Math.min(12, jevW - 31));
    const filled = Number.isFinite(p) ? Math.round(p * barW) : 0;
    const color = state.jev?.effectiveRoute === route ? 'green' : 'dim';
    put(jevX + 2, 12 + i, names[route], color, 14);
    put(jevX + 17, 12 + i, Number.isFinite(p) ? '[' + '#'.repeat(filled) + '.'.repeat(barW - filled) + ']' : '等待真实结果', color, barW + 2);
    put(jevX + 20 + barW, 12 + i, Number.isFinite(p) ? `${(p * 100).toFixed(0)}%` : '', color, 7);
  });
  put(jevX + 2, 15, state.jev ? `置信度 ${(state.jev.confidence * 100).toFixed(0)}%  → ${names[state.jev.effectiveRoute]}` : '分流概率尚未返回', 'dim', jevW - 4);

  const gap = 2, cardW = Math.floor((rightW - gap * 2) / 3), agentY = 19;
  const cardXs = [0, 1, 2].map(i => rightX + i * (cardW + gap));
  const workCenter = cardXs[0] + Math.floor(cardW / 2);
  line(workCenter, 18, cx - workCenter + 1, 'blue'); vertical(cx, 17, 18, 'blue'); put(workCenter, 18, g.down, 'blue');
  const workerState = state.status === 'approval' || state.stage === 'approval' ? 'approval' : worker?.status === 'running' && state.status !== 'running' ? 'interrupted' : worker?.status || 'pending';
  const cards = [
    ['Sol / worker', inspect ? '只读分析' : '修改代码', label(workerState), colorFor(workerState)],
    ['explorer', '未启用', '本次不派发', 'dim'],
    ['researcher', '未启用', '本次不派发', 'dim'],
  ];
  cards.forEach(([title, action, status, color], i) => {
    const x = cardXs[i]; box(x, agentY, cardW, 5, i === 0 ? 'blue' : 'border');
    center(x + 1, agentY + 1, cardW - 2, title, i === 0 ? 'white' : 'dim');
    center(x + 1, agentY + 2, cardW - 2, action, i === 0 ? 'blue' : 'dim');
    center(x + 1, agentY + 3, cardW - 2, status, color);
  });
  vertical(workCenter, 24, outcomeY - 1, 'blue');
  if (running && ['implementation', 'inspection'].includes(state.stage) && worker?.status === 'running') put(workCenter, 24 + tick % Math.max(1, outcomeY - 24), g.dot, 'cyan');
  line(workCenter, outcomeY - 1, cx - workCenter + 1, 'blue'); put(cx, outcomeY - 1, g.down, 'cyan');
  const resultW = Math.min(60, rightW), resultX = cx - Math.floor(resultW / 2);
  box(resultX, outcomeY, resultW, 4, state.status === 'failed' || state.status === 'blocked' ? 'red' : 'cyan');
  center(resultX + 1, outcomeY + 1, resultW - 2, inspect ? `项目报告 / ${label(state.status)}` : `验收 / ${label(state.status)}`, colorFor(state.status));
  center(resultX + 1, outcomeY + 2, resultW - 2, inspect ? `材料 ${state.inspectionEvidence?.files?.length ?? 0} 份 / 未运行测试` : `测试退出码 ${state.tests?.exitCode ?? '待运行'} / 审查 ${state.review ? label(state.review.verdict) : '待审查'}`, 'dim');
  if (state.stage === 'review' || state.review) { line(sideX + sideW, outcomeY + 1, resultX - sideX - sideW, 'purple'); put(resultX - 1, outcomeY + 1, g.arrow, 'purple'); }

  box(2, logY, w - 4, 6, 'border'); put(4, logY, ' session log / 实际事件 ', 'dim');
  const end = Math.max(0, state.events.length - offset);
  state.events.slice(Math.max(0, end - 4), end).forEach((event, i) => {
    put(4, logY + 1 + i, event.time.slice(11, 19), 'dim'); put(14, logY + 1 + i, event.type, event.type === 'error' ? 'red' : 'blue', 11);
    put(26, logY + 1 + i, event.message, 'base', w - 30);
  });
  const elapsed = state.startedAt ? Math.max(0, Math.floor(((state.finishedAt ? Date.parse(state.finishedAt) : now) - Date.parse(state.startedAt)) / 1000)) : 0;
  put(2, h - 2, `[V] 日志视图 [↑/↓] 滚动 [Q] ${running ? '中断退出' : '关闭图 / 查看报告'}`, 'green', w - 24);
  put(w - 23, h - 2, `${elapsed}s / 本地经过时间`, 'dim', 21);
  put(2, h - 1, state.error || (saved ? '展示已保存的真实任务结果；没有重新调用模型。' : `${inspect ? '只读目录' : '任务副本'}：${state.task?.cwd || '-'}  |  光点仅表示等待，不表示完成进度。`), state.error ? 'red' : 'dim', w - 4);
  let result = '\x1b[H\x1b[48;2;26;29;36m', currentColor;
  for (let row = 0; row < h; row++) {
    if (row) result += `\x1b[${row + 1};1H`;
    for (const cell of grid[row]) {
      if (currentColor !== cell.color) { result += `\x1b[${['white','cyan','green','purple','blue'].includes(cell.color) ? 1 : 22};38;2;${palette[cell.color].join(';')}m`; currentColor = cell.color; }
      result += cell.c;
    }
    result += '\x1b[K';
  }
  return result + '\x1b[0m';
}
