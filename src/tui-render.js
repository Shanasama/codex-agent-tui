// Pure terminal renderer. No I/O, browser, network, terminal escape data, or secrets.
const ESC = '\x1b[';
const COLORS = { base: 252, dim: 244, border: 238, cyan: 81, green: 121, purple: 183, amber: 221, red: 203, white: 255, blue: 111 };
export function cleanText(value) {
  return String(value ?? '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
}
export function cellWidth(char) {
  const n = char.codePointAt(0);
  if (/\p{Mark}/u.test(char) || n === 0x200d || n === 0xfe0f) return 0;
  return (n >= 0x1100 && (n <= 0x115f || n === 0x2329 || n === 0x232a || (n >= 0x2e80 && n <= 0xa4cf) || (n >= 0xac00 && n <= 0xd7a3) || (n >= 0xf900 && n <= 0xfaff) || (n >= 0xfe10 && n <= 0xfe6f) || (n >= 0xff00 && n <= 0xff60) || (n >= 0xffe0 && n <= 0xffe6) || (n >= 0x1f300 && n <= 0x1faff) || n >= 0x20000)) ? 2 : 1;
}
export function visibleWidth(value) { return [...cleanText(value)].reduce((n, c) => n + cellWidth(c), 0); }
function shortStatus(status) {
  return ({ inProgress: 'RUNNING', pendingInit: 'WAITING', idle: 'STANDBY', watching: 'WATCHING', passed: 'PASS', completed: 'DONE', running: 'RUNNING', paused: 'PAUSED', blocked: 'BLOCKED', interrupted: 'STOPPED', pending: 'PENDING', failed: 'FAILED' })[status] || String(status || 'STANDBY').toUpperCase();
}
function statusColor(status) { return ['completed', 'passed'].includes(status) ? 'green' : ['failed', 'blocked'].includes(status) ? 'red' : ['paused', 'interrupted'].includes(status) ? 'amber' : status === 'running' ? 'cyan' : 'dim'; }
export function renderDashboardFrame(state, { columns = 120, rows = 40, tick = 0, scenario = 'success', elapsed = 0, logOffset = 0, notice = '' } = {}) {
  const width = Math.max(0, Math.min(Math.floor(Number.isFinite(columns) ? columns : 120) - 1, 200)); // last column unused: no autowrap
  const height = Math.max(0, Math.min(Math.floor(Number.isFinite(rows) ? rows : 40), 70));
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ c: ' ', color: 'base' })));
  const text = (x, y, value, color = 'base', limit = width - x) => {
    if (y < 0 || y >= height) return;
    let used = 0;
    for (const c of cleanText(value)) {
      const n = cellWidth(c); if (!n) continue;
      if (used + n > limit || x + n > width) break;
      if (x >= 0) { grid[y][x] = { c, color }; if (n === 2) grid[y][x + 1] = { c: '', color }; }
      x += n; used += n;
    }
  };
  const line = (x, y, length, color = 'border') => text(x, y, '-'.repeat(Math.max(0, length)), color);
  const box = (x, y, w, h, title, color = 'border') => {
    text(x, y, '+' + '-'.repeat(Math.max(0, w - 2)) + '+', color);
    for (let r = 1; r < h - 1; r++) { text(x, y + r, '|', color); text(x + w - 1, y + r, '|', color); }
    text(x, y + h - 1, '+' + '-'.repeat(Math.max(0, w - 2)) + '+', color);
    if (title) text(x + 2, y, ` ${title} `, color === 'border' ? 'dim' : color, w - 4);
  };
  if (width < 78 || height < 32) {
    text(2, 2, 'CODEX // MISSION CONTROL', 'cyan');
    text(2, 4, 'DEMO ONLY - No model inference', 'amber');
    text(2, 6, `Terminal ${columns}x${rows}; enlarge to 80x32+`, 'base');
    text(2, 8, 'Recommended: 120 columns x 40 rows', 'dim');
    text(2, height - 2, '[Q] Quit  [1/2/3] Scenario  [R] Replay', 'green');
  } else {
    const run = state.run; const spinner = ['|', '/', '-', '\\'][tick % 4];
    text(2, 1, 'C O D E X', 'white'); text(15, 1, '// MISSION CONTROL', 'cyan');
    text(width - 30, 1, '[ DEMO / SYNTHETIC EVENTS ]', 'amber');
    text(2, 2, 'TERMINAL AGENT ORCHESTRATOR', 'dim');
    text(width - 30, 2, 'NO AUTH  /  NO MODEL CALLS', 'dim');
    line(2, 3, width - 4);
    text(2, 4, `${run?.status === 'running' ? spinner : '*'}  CART TOTAL REVIEW`, 'white');
    text(Math.max(29, width - 42), 4, `${shortStatus(run?.status)}  |  ${Math.floor(elapsed / 1000).toString().padStart(2, '0')}s local elapsed`, statusColor(run?.status));
    text(2, 5, 'Goal: trace quantity bug -> propose fix -> review evidence', 'dim');
    const gap = 1; const cardW = Math.floor((width - 4 - gap * 3) / 4);
    const names = ['EXPLORER', 'RESEARCHER', 'WORKER', 'ARCHITECT']; const labels = ['LUNA', 'LUNA', 'SOL', 'ASTRA'];
    const descriptions = ['Map code + boundaries', 'Evidence + test cases', 'Patch proposal only', 'Plan + final review'];
    state.roles.forEach((role, i) => {
      const x = 2 + i * (cardW + gap); const active = role.status === 'running' && run?.status === 'running';
      const color = i === 3 ? 'purple' : 'cyan';
      box(x, 7, cardW, 7, `${String(i + 1).padStart(2, '0')} ${names[i]}`, active ? color : 'border');
      text(x + 2, 8, `${active ? spinner : 'o'}  ${labels[i]}`, color);
      text(x + 2, 9, role.model, 'dim', cardW - 4);
      text(x + 2, 10, descriptions[i], 'base', cardW - 4);
      text(x + 2, 12, shortStatus(run?.status === 'paused' && role.status === 'running' ? 'paused' : role.status), statusColor(role.status), cardW - 4);
    });
    const route = ['EXPLORE', 'PLAN REVIEW', 'PROPOSE', 'FINAL REVIEW'];
    const stage = run?.stage || 'exploration'; const stageIndex = ({ exploration: 0, 'plan-review': 1, implementation: 2, 'completion-review': 3, completed: 3, 'repeated-error': 2, approval: 2 })[stage] || 0;
    const routeW = Math.floor((width - 4) / 4);
    route.forEach((label, i) => {
      const active = i === stageIndex; const arrow = i < 3 ? ' ->' : '';
      text(2 + i * routeW, 15, `${active ? '[' : ' '} ${label} ${active ? ']' : ' '}${arrow}`, active ? (run?.status === 'paused' ? 'amber' : 'green') : 'dim', routeW);
    });
    const panelY = 17; const panelH = Math.max(6, Math.min(10, height - 25));
    const treeW = Math.floor((width - 5) * 0.59); const reviewX = 3 + treeW;
    box(2, panelY, treeW, panelH, 'TASK TREE / FIXTURE THREADS');
    box(reviewX, panelY, width - reviewX - 2, panelH, 'ASTRA REVIEW GATES', 'purple');
    const threads = run?.threads || [];
    if (!threads.length) text(4, panelY + 2, 'Waiting for fixture events...', 'dim');
    threads.slice(0, panelH - 2).forEach((thread, i) => {
      const prefix = thread.parentId ? '  `->' : '+--';
      const label = thread.id.replace('demo-', '').toUpperCase();
      text(4, panelY + 1 + i, `${prefix} ${label}`, thread.role === 'architect' ? 'purple' : 'base', treeW - 18);
      text(treeW - 10, panelY + 1 + i, shortStatus(thread.status), statusColor(thread.status), 12);
    });
    const gateNames = ['PLAN CHECK', 'REPEATED ERROR', 'FINAL CHECK'];
    (run?.reviews || []).forEach((review, i) => {
      if (i >= panelH - 2) return;
      text(reviewX + 2, panelY + 1 + i, `${i + 1}. ${gateNames[i]}`, 'base', Math.max(0, width - 20 - reviewX));
      text(width - 16, panelY + 1 + i, shortStatus(review.status), statusColor(review.status), 12);
    });
    if (panelH >= 7) {
      text(reviewX + 2, panelY + panelH - 3, 'Approval requests: DENY + PAUSE', 'amber', width - reviewX - 6);
      text(reviewX + 2, panelY + panelH - 2, 'No real tests / edits performed', 'dim', width - reviewX - 6);
    }
    const logY = panelY + panelH + 1; const logH = height - logY - 3;
    box(2, logY, width - 4, logH, `EVENT STREAM / ${state.events.length} events / offset ${logOffset}`);
    const available = Math.max(0, logH - 2); const events = state.events.slice(Math.max(0, state.events.length - available - logOffset), Math.max(0, state.events.length - logOffset));
    events.forEach((event, i) => {
      const time = String(event.time).slice(11, 19); const tag = String(event.type).toUpperCase().slice(0, 10).padEnd(10);
      text(4, logY + 1 + i, time, 'dim'); text(14, logY + 1 + i, tag, event.type === 'approval' || event.type === 'error' ? 'amber' : event.type === 'review' ? 'purple' : 'cyan');
      text(26, logY + 1 + i, event.message, 'base', width - 30);
    });
    const scenarioLabel = ({ success: 'SUCCESS', 'repeated-error': 'ERROR ESCALATION', approval: 'APPROVAL DENIED' })[scenario];
    text(2, height - 2, '[1] Success  [2] Error  [3] Approval  [R] Replay  [L] Loop  [UP/DOWN] Logs  [Q] Quit', 'green', width - 4);
    text(2, height - 1, notice || `SCENARIO: ${scenarioLabel}   |   Render animation is decorative; event states come from Controller fixtures.`, 'dim', width - 4);
  }
  let result = '\x1b[H\x1b[48;5;234m'; let color;
  for (let r = 0; r < height; r++) {
    if (r) result += `\x1b[${r + 1};1H`;
    for (const cell of grid[r]) { if (cell.color !== color) { result += `${ESC}38;5;${COLORS[cell.color] || COLORS.base}m`; color = cell.color; } result += cell.c; }
    result += '\x1b[K';
  }
  return result + '\x1b[0m';
}

// Reference layout studied from the user's video frames: Astra rail + Sol/Jev/
// three-agent/review flow. Jev and the main Sol coordinator remain visual demos.
export function renderFrame(state, options = {}) {
  const live = options.workflowView;
  const { columns = 120, rows = 40, tick = 0, scenario = 'success', elapsed = 0, logOffset = 0, notice = '', view = 'reference', ascii = false } = options;
  const canvasW = Math.max(0, Math.min(Math.floor(Number.isFinite(columns) ? columns : 120) - 1, 200));
  const w = Math.min(canvasW, 120), offsetX = Math.floor((canvasW - w) / 2);
  const h = Math.max(0, Math.min(Math.floor(Number.isFinite(rows) ? rows : 40), 70));
  if (view === 'dashboard' || w < 79 || h < 40) return renderDashboardFrame(state, options);
  const palette = { base: [211,214,224], dim: [135,139,151], border: [75,79,88], cyan: [143,215,219], green: [137,220,158], purple: [187,165,233], blue: [143,182,231], amber: [228,193,138], red: [229,137,149], white: [239,239,246] };
  const glyph = ascii ? { h: '-', v: '|', tl: '+', tr: '+', bl: '+', br: '+', dot: 'o', tail: '.', active: '>', idle: 'o', right: '>', down: 'v', branch: '+' } : { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘', dot: '●', tail: '·', active: '◆', idle: '◇', right: '▶', down: '▼', branch: '┬' };
  const grid = Array.from({ length: h }, () => Array.from({ length: canvasW }, () => ({ c: ' ', color: 'base' })));
  const put = (x, y, value, color = 'base', limit = w - x) => {
    if (y < 0 || y >= h) return;
    let used = 0;
    for (const c of cleanText(value)) {
      const n = cellWidth(c); if (!n) continue;
      if (used + n > limit || x + n > w) break;
      if (x >= 0) { grid[y][x + offsetX] = { c, color }; if (n === 2) grid[y][x + offsetX + 1] = { c: '', color }; }
      x += n; used += n;
    }
  };
  const centerText = (x, y, width, value, color) => put(x + Math.max(0, Math.floor((width - visibleWidth(value)) / 2)), y, value, color, width);
  const horizontal = (x1, x2, y, color = 'border') => put(x1, y, glyph.h.repeat(Math.max(0, x2 - x1 + 1)), color);
  const vertical = (x, y1, y2, color = 'border') => { for (let y = y1; y <= y2; y++) put(x, y, glyph.v, color); };
  const box = (x, y, width, height, color) => {
    put(x, y, glyph.tl + glyph.h.repeat(Math.max(0, width - 2)) + glyph.tr, color);
    for (let row = y + 1; row < y + height - 1; row++) { put(x, row, glyph.v, color); put(x + width - 1, row, glyph.v, color); }
    put(x, y + height - 1, glyph.bl + glyph.h.repeat(Math.max(0, width - 2)) + glyph.br, color);
  };
  const particle = (points, color, seed = 0) => {
    if (live) return; // Live status comes from events, not decorative fixture motion.
    if (!points.length) return;
    const index = (Math.floor(tick / 2) + seed) % points.length;
    const [x, y] = points[index]; put(x, y, glyph.dot, color);
    if (points.length > 2) { const [tx, ty] = points[(index + points.length - 1) % points.length]; put(tx, ty, glyph.tail, color); }
  };
  const vpoints = (x, y1, y2) => Array.from({ length: Math.max(0, y2 - y1 + 1) }, (_, i) => [x, y1 + i]);
  const hpoints = (x1, x2, y) => Array.from({ length: Math.max(0, x2 - x1 + 1) }, (_, i) => [x1 + i, y]);
  const run = state.run; const large = h >= 44; const treeBottom = h - 11;
  const sideX = 2, sideW = Math.max(19, Math.floor(w * 0.235));
  const rightX = sideX + sideW + 3, rightW = w - rightX - 2, cx = rightX + Math.floor(rightW / 2);
  const mainW = Math.min(36, rightW - 4), mainX = cx - Math.floor(mainW / 2), mainY = 5, mainH = large ? 6 : 5;
  const jevW = Math.min(57, rightW - 2), jevX = cx - Math.floor(jevW / 2), jevY = mainY + mainH + 1, jevH = large ? 7 : 6;
  const branchY = jevY + jevH + (large ? 2 : 1), agentY = branchY + 2, agentH = large ? 7 : 5;
  const reviewY = treeBottom - 3, reviewW = Math.min(46, rightW - 2), reviewX = cx - Math.floor(reviewW / 2), mergeY = reviewY - 1;
  const title = live ? 'CODEX AGENT TREE  .  SOL + JEV + ASTRA' : w >= 100 ? 'CODEX AGENT TREE  .  GPT-6.1 SOL WORKS  .  ASTRA ON CALL' : 'CODEX AGENT TREE  .  SOL + AGENTS + ASTRA';
  centerText(0, 1, w, title, 'white');
  horizontal(2, w - 3, 2);
  put(3, 3, 'sol', 'cyan'); put(10, 3, 'agents', 'blue'); put(20, 3, live ? 'JEV API' : 'DEMO JEV', 'green'); put(32, 3, 'astra', 'purple');
  put(w - 28, 3, live ? live.source : 'DEMO / SYNTHETIC EVENTS', 'amber', 26);

  // Left reference rail, with true fixture review state instead of fake token/cost counters.
  box(sideX, 5, sideW, treeBottom - 4, 'purple');
  centerText(sideX + 1, 6, sideW - 2, 'ASTRA', 'purple');
  centerText(sideX + 1, 7, sideW - 2, live ? 'review role / reference' : 'architect / on call', 'dim');
  const reviews = run?.reviews || [];
  const findReview = type => reviews.find(r => r.type === type);
  const reviewEvents = state.events.filter(e => e.type === 'review');
  const triggerRows = [8, Math.min(agentY + 2, treeBottom - 8), treeBottom - 2];
  ['before a plan', 'error repeats', 'before done'].forEach((name, i) => {
    const review = findReview(['plan', 'repeated-error', 'completion'][i]);
    const active = review?.status === 'blocked' || reviewEvents.at(-1)?.detail?.startsWith(['plan:', 'repeated-error:', 'completion:'][i]) || (i === 0 && run?.stage === 'plan-review') || (i === 2 && run?.stage === 'completion-review');
    const row = triggerRows[i];
    put(sideX + 2, row, `${active ? glyph.active : glyph.idle} ${name}`, active ? 'purple' : 'dim', sideW - 4);
    horizontal(sideX + sideW, i === 0 ? mainX - 2 : i === 1 ? rightX - 2 : reviewX - 2, row, active ? 'purple' : 'border');
    put(i === 0 ? mainX - 1 : i === 1 ? rightX - 1 : reviewX - 1, row, glyph.right, active ? 'purple' : 'dim');
    if (active) { for (let x = sideX + 1; x < sideX + sideW - 1; x++) grid[row][x + offsetX].bg = true; }
    if (active) particle(hpoints(sideX + sideW, (i === 0 ? mainX : i === 1 ? rightX : reviewX) - 2, row), 'purple', i * 3);
  });
  const railLines = live ? [ ['plan / '+live.plan, 'base'], ['final / '+live.review, 'dim'], ['', 'dim'], ['status source:', 'dim'], [live.reviewerModel, 'purple'] ] : [ ['review at 3 gates', 'base'], ['plan, errors, final', 'dim'], ['', 'dim'], ['last fixture review:', 'dim'], [reviewEvents.at(-1)?.detail || 'waiting for events', 'purple'] ];
  railLines.forEach(([label, color], i) => put(sideX + 2, 10 + i, label, color, sideW - 4));
  if (h >= 44) {
    put(sideX + 2, 17, 'review events', 'dim', sideW - 4); put(sideX + 2, 18, String(reviewEvents.length), 'purple');
    put(sideX + 2, 20, 'tokens / cost', 'dim'); put(sideX + 2, 21, 'not measured', 'dim');
  }
  put(sideX + 2, treeBottom - 6, live ? live.reviewerNote : 'never edits files', 'dim', sideW - 4);
  put(sideX + 2, treeBottom - 5, live ? live.reviewerNoteDetail : 'no real tests run', 'dim', sideW - 4);
  put(sideX + 2, treeBottom - 4, live ? 'REFERENCE ROLE' : 'DEMO ONLY', 'amber', sideW - 4);
  put(sideX + 2, treeBottom - 3, live ? 'NO INFERRED AGENT' : 'NO AUTH', 'dim', sideW - 4);

  box(mainX, mainY, mainW, mainH, 'cyan');
  centerText(mainX + 1, mainY + 1, mainW - 2, live ? 'Sol / main role' : 'GPT-6.1 Sol / main', 'cyan');
  centerText(mainX + 1, mainY + 2, mainW - 2, live ? live.workerModel : 'REFERENCE SCHEMATIC / DEMO', 'base');
  centerText(mainX + 1, mainY + 3, mainW - 2, live ? live.workerAction+' / '+live.workerStatus : 'patch proposals, no edits', 'dim');
  if (large) centerText(mainX + 1, mainY + 4, mainW - 2, live ? 'role label / CLI source' : 'effort / cost: not measured', 'dim');
  vertical(cx, mainY + mainH, jevY - 1); particle(vpoints(cx, mainY + mainH, jevY - 1), 'cyan');

  box(jevX, jevY, jevW, jevH, 'green');
  put(jevX + 2, jevY + 1, live ? 'JEV / '+live.jevModel : jevW >= 52 ? 'JEV / VISUAL DEMO' : 'DEMO JEV / NOT CONNECTED', 'green', jevW - 4);
  if (jevW >= 52 && !live) put(jevX + jevW - 20, jevY + 1, 'NOT CONNECTED', 'amber', 17);
  const gateRows = 3;
  (live ? ['execute', 'plan review', 'clarify'] : ['which file', 'which tool', 'retry / stop']).slice(0, gateRows).forEach((name, i) => {
    const barWidth = Math.max(5, Math.min(12, jevW - 33));
    // These are intentionally static illustration levels, not probabilities or real fork data.
    const probability = live?.probabilities?.[i]?.value;
    const filled = live ? Number.isFinite(probability) ? Math.round(Math.max(0,Math.min(1,probability))*barWidth) : 0 : [barWidth - 1, Math.floor(barWidth * .5), barWidth - 1][i];
    put(jevX + 2, jevY + 2 + i, name, 'base', 14);
    put(jevX + 17, jevY + 2 + i, '[' + '#'.repeat(filled) + '.'.repeat(barWidth - filled) + ']', i === 1 ? 'cyan' : 'green');
    put(jevX + 20 + barWidth, jevY + 2 + i, live ? Number.isFinite(probability) ? `${Math.round(probability*100)}%` : '--' : 'sample', 'dim', jevW - 22 - barWidth);
  });
  if (large) put(jevX + 2, jevY + jevH - 2, live ? live.decision : 'actual routing: controller / sample bars', 'dim', jevW - 4);
  vertical(cx, jevY + jevH, branchY); particle(vpoints(cx, jevY + jevH, branchY), 'blue', 2);
  if (large) centerText(rightX, branchY - 1, rightW, live ? 'role map / inactive slots are not running' : 'spawn agents / synthetic fixtures', 'base');
  const gap = 2, cardW = Math.floor((rightW - 2 * gap) / 3);
  const agents = ['worker', 'explorer', 'researcher'];
  const cardXs = agents.map((_, i) => rightX + i * (cardW + gap));
  const centers = cardXs.map(x => x + Math.floor(cardW / 2));
  horizontal(centers[0], centers[2], branchY); particle(hpoints(centers[0], centers[2], branchY), 'blue', 3);
  agents.forEach((roleId, i) => {
    const x = cardXs[i]; const role = state.roles.find(r => r.id === roleId); const thread = run?.threads?.find(t => t.role === roleId);
    vertical(centers[i], branchY, agentY - 1); put(centers[i], branchY, glyph.branch, 'blue'); put(centers[i], agentY - 1, glyph.down, 'blue');
    box(x, agentY, cardW, agentH, 'blue');
    centerText(x + 1, agentY + 1, cardW - 2, roleId, 'white');
    centerText(x + 1, agentY + 2, cardW - 2, role?.model || '', 'blue');
    if (large) {
      centerText(x + 1, agentY + 3, cardW - 2, live ? i === 0 ? live.workerAction : 'NOT ENABLED' : ['patch proposal', 'reads fixture', 'test ideas'][i], 'base');
      centerText(x + 1, agentY + 5, cardW - 2, shortStatus(thread?.status || role?.status), statusColor(thread?.status || role?.status));
    } else centerText(x + 1, agentY + 3, cardW - 2, `${shortStatus(thread?.status || role?.status)} / ${['patch', 'read', 'ideas'][i]}`, statusColor(thread?.status || role?.status));
    if (large) centerText(x + 1, agentY + 4, cardW - 2, live ? i === 0 ? 'CLI reported' : 'reference slot' : 'DEMO / no tools', 'dim');
    vertical(centers[i], agentY + agentH, mergeY); particle(vpoints(centers[i], agentY + agentH, mergeY), 'base', i + 1);
  });
  horizontal(centers[0], centers[2], mergeY); particle(hpoints(centers[0], centers[2], mergeY), 'base', 5);
  vertical(cx, mergeY, reviewY - 1); put(cx, reviewY - 1, glyph.down, 'cyan');
  box(reviewX, reviewY, reviewW, 4, 'cyan');
  centerText(reviewX + 1, reviewY + 1, reviewW - 2, live ? 'back to sol / result' : 'back to sol / review + verify', 'cyan');
  centerText(reviewX + 1, reviewY + 2, reviewW - 2, live ? live.outcomeDetail : `FIXTURE: ${shortStatus(run?.status)} / no real tests`, 'dim');

  const logY = h - 9;
  box(2, logY, w - 4, 6, 'border'); put(4, logY, live ? ' session log / actual reports ' : ' session log / synthetic ', 'dim');
  const events = state.events.slice(Math.max(0, state.events.length - 4 - logOffset), Math.max(0, state.events.length - logOffset));
  events.forEach((event, i) => {
    put(4, logY + 1 + i, String(event.time).slice(11, 19), 'dim');
    put(14, logY + 1 + i, event.role || event.type, event.type === 'review' ? 'purple' : 'blue', 12);
    put(27, logY + 1 + i, event.message, 'base', w - 31);
  });
  put(2, h - 2, '~/agent-tree $', 'green'); put(17, h - 2, live ? live.mode+' / '+live.status : 'npm start  [DEMO - NO MODEL CALLS]', 'base');
  put(w - 25, h - 2, `${shortStatus(run?.status)} / ${Math.floor(elapsed / 1000)}s local`, statusColor(run?.status), 23);
  put(2, h - 1, notice || (live ? live.goal : '[1/2/3] scenes [R] replay [L] loop [V] layout [UP/DOWN] log [Q] quit | flow dots: decorative'), 'dim', w - 4);
  let result = '\x1b[H\x1b[48;2;26;29;36m'; let color, background = false;
  for (let row = 0; row < h; row++) {
    if (row) result += `\x1b[${row + 1};1H`;
    for (const cell of grid[row]) {
      if (Boolean(cell.bg) !== background) { background = Boolean(cell.bg); result += background ? '\x1b[48;2;56;48;70m' : '\x1b[48;2;26;29;36m'; }
      if (color !== cell.color) { result += `\x1b[${['white', 'cyan', 'blue', 'purple', 'green', 'amber'].includes(cell.color) ? 1 : 22};38;2;${(palette[cell.color] || palette.base).join(';')}m`; color = cell.color; }
      result += cell.c;
    }
    result += '\x1b[K';
  }
  return result + '\x1b[0m';
}
