'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const roleDefinitions = [
    { id: 'explorer', title: '探索者', label: 'EXPLORER', model: 'gpt-6-luna', name: 'Luna', description: '梳理结构，发现任务边界', icon: 'search', color: '#80b8ca', bg: '#192b34' },
    { id: 'researcher', title: '研究者', label: 'RESEARCHER', model: 'gpt-6-luna', name: 'Luna', description: '寻找证据，补全关键上下文', icon: 'layers', color: '#d2b482', bg: '#2e281e' },
    { id: 'worker', title: '执行者', label: 'WORKER', model: 'gpt-6.1-sol', name: 'Sol', description: '遵循计划，推进具体任务', icon: 'code', color: '#8bbfab', bg: '#1b302b' },
    { id: 'architect', title: '架构师', label: 'ARCHITECT', model: 'gpt-6-astra', name: 'Astra', description: '审核方案，把关最终交付', icon: 'star', color: '#b9a0e7', bg: '#2b223b' },
  ];
  const reviewDefinitions = [
    { type: 'plan', title: '计划审核', description: '确认任务拆解、范围与执行方案' },
    { type: 'repeated-error', title: '连续错误复核', description: '出现重复失败时，重新检查执行策略' },
    { type: 'completion', title: '交付验收', description: '核对结果、证据与目标是否一致' },
  ];
  const statusLabels = {
    idle: '待命', waiting: '等待中', pending: '待审核', queued: '排队中', running: '进行中', in_progress: '进行中', working: '执行中', exploring: '探索中', researching: '研究中', reviewing: '审核中', active: '进行中', completed: '已完成', complete: '已完成', done: '已完成', success: '已完成', succeeded: '已完成', passed: '已通过', approved: '已通过', failed: '失败', error: '异常', denied: '已拒绝', rejected: '已拒绝', blocked: '已阻塞', paused: '已暂停', interrupted: '已中断', cancelled: '已取消', canceled: '已取消', not_needed: '未触发', skipped: '未触发', disconnected: '未连接', connected: '已连接', connecting: '连接中', ready: '已就绪', unavailable: '不可用', available: '可用', not_started: '未开始', planning: '规划中', executing: '执行中', starting: '启动中', checking: '检查中', stopped: '已停止', needs_auth: '需要认证', unauthenticated: '未认证', demo: '模拟演示', timeout: '已超时', not_triggered: '未触发', triggered: '已触发', recovered: '已恢复', needs_login: '需要登录', authenticated: '已认证', not_authenticated: '未认证', unverified: '未验证', watching: '监测中', exploration: '探索与研究', 'plan-review': '计划审核', implementation: '执行建议', 'completion-review': '交付验收', 'repeated-error': '连续错误复核', approval: '权限请求', pendingInit: '等待初始化', inProgress: '进行中' };
  let state = { mode: 'disconnected', connection: { status: 'disconnected', message: '', models: [] }, roles: [], run: null, events: [] };
  let filter = 'all';
  let busy = false;
  let toastTimer;
  let lastEventSignature = '';
  let lastTaskSignature = '';
  let streamConnected = false;
  let source;
  const demoRunIds = new Set();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.setAttribute('aria-hidden', 'true');
    svg.append(use);
    return svg;
  }
  function label(status, fallback = '等待中') { return statusLabels[status] || (status ? String(status) : fallback); }
  function canonicalStatus(status) {
    if (['completed', 'complete', 'done', 'success', 'succeeded', 'passed', 'approved'].includes(status)) return 'completed';
    if (['running', 'in_progress', 'active', 'reviewing', 'working', 'planning', 'executing', 'starting', 'exploring', 'researching', 'checking'].includes(status)) return 'running';
    if (['paused', 'denied', 'rejected', 'interrupted', 'cancelled', 'canceled', 'stopped'].includes(status)) return 'paused';
    if (['failed', 'error', 'timeout'].includes(status)) return 'failed';
    return status || 'idle';
  }
  function isRunning() { return state.run && ['running', 'planning', 'executing', 'reviewing', 'in_progress', 'starting'].includes(state.run.status); }
  function runIsDemo() { return !!state.run && (state.mode === 'demo' || state.run.mode === 'demo' || demoRunIds.has(state.run.id) || (state.run.threads || []).some((thread) => thread.origin === 'fixture' || String(thread.id || '').startsWith('demo-'))); }
  function hasConnection() { return state.mode === 'live' || ['connected', 'connecting', 'ready'].includes(state.connection.status) || state.connection.connected === true; }
  function modelId(model) { return typeof model === 'string' ? model : String(model.id || model.model || model.slug || model.name || ''); }
  function modelIsListed(id) { return (state.connection.models || []).some((model) => typeof model === 'string' ? model === id : [model.id, model.model, model.slug, model.name].includes(id)); }
  function objectText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return value.summary || value.text || value.message || JSON.stringify(value, null, 2);
    return String(value);
  }
  function roleName(id) {
    const role = roleDefinitions.find((role) => role.id === id || role.name.toLowerCase() === String(id).toLowerCase());
    return role ? role.title : id || '系统';
  }
  function toast(message, isError = false) {
    clearTimeout(toastTimer);
    $('toast-message').textContent = message;
    $('toast').classList.toggle('error', isError);
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, isError ? 12000 : 6500);
  }

  function renderRoles() {
    $('role-grid').replaceChildren(...roleDefinitions.map((definition) => {
      const role = (state.roles || []).find((item) => item.id === definition.id || item.role === definition.id) || {};
      const model = role.model || definition.model;
      const displayStatus = state.run && ['paused', 'interrupted'].includes(state.run.status) && canonicalStatus(role.status) === 'running' ? state.run.status : role.status;
      const active = canonicalStatus(displayStatus) === 'running';
      const card = el('article', 'role-card' + (active ? ' active' : ''));
      card.style.setProperty('--role-color', definition.color);
      card.style.setProperty('--role-bg', definition.bg);
      const top = el('div', 'role-card-top');
      const roleIcon = el('span', 'role-icon'); roleIcon.append(icon(definition.icon));
      const roleStatus = el('span', 'role-state', label(displayStatus, '待命'));
      top.append(roleIcon, roleStatus);
      const title = el('div', 'role-title'); title.append(el('h3', '', definition.title), el('span', '', definition.label));
      const footer = el('div', 'role-model');
      const modelName = el('span', 'model-name', model); modelName.prepend(icon(definition.name === 'Luna' ? 'moon' : definition.name === 'Astra' ? 'star' : 'code'));
      let availability = '未检查'; let availabilityClass = '';
      if (state.mode === 'demo' || (!hasConnection() && runIsDemo())) { availability = '模拟角色'; availabilityClass = 'demo'; }
      else if (hasConnection()) {
        const available = role.available === true || (role.available !== false && modelIsListed(model));
        availability = available ? '已发现' : '未发现'; availabilityClass = available ? 'available' : 'unavailable';
      }
      const availabilityNode = el('span', 'model-availability ' + availabilityClass, availability);
      availabilityNode.title = state.mode === 'demo' || (!hasConnection() && runIsDemo()) ? '演示中的预设角色，不代表模型可用' : '模型出现在列表中，不代表已认证或推理已就绪';
      footer.append(modelName, availabilityNode);
      card.append(top, title, el('p', 'role-description', definition.description), footer);
      return card;
    }));
  }

  function renderReviews() {
    const reviews = state.run?.reviews || [];
    $('review-list').replaceChildren(...reviewDefinitions.map((definition, index) => {
      const matches = reviews.filter((review) => {
        const type = review.type || review.gate || review.kind || review.id || '';
        if (definition.type === 'repeated-error') return ['repeated-error', 'repeated_error', 'error', 'error_review', 'recovery', 'error-review'].includes(type);
        if (definition.type === 'completion') return ['completion', 'final', 'final_review', 'delivery', 'completion-review'].includes(type);
        return ['plan', 'planning', 'plan_review', 'plan-review'].includes(type);
      });
      const review = matches[matches.length - 1];
      const status = review?.status || (definition.type === 'repeated-error' ? 'not_triggered' : 'pending');
      const canonical = canonicalStatus(status);
      const item = el('div', 'review-item ' + (canonical === 'completed' ? 'passed' : canonical));
      const number = el('span', 'review-number');
      if (canonical === 'completed') number.append(icon('check')); else number.textContent = String(index + 1).padStart(2, '0');
      const copy = el('div', 'review-copy');
      const row = el('div'); row.append(el('strong', '', definition.title), el('span', '', label(status)));
      copy.append(row, el('p', '', review?.message || review?.summary || definition.description));
      item.append(number, copy);
      return item;
    }));
  }

  function renderTasks() {
    const run = state.run;
    const threads = run?.threads || [];
    $('thread-count').textContent = String(threads.length);
    $('nav-thread-count').textContent = String(threads.length);
    $('run-status').textContent = run ? label(run.status) : '等待任务';
    $('run-status').className = 'run-status ' + canonicalStatus(run?.status);
    $('run-id').textContent = run?.id ? 'RUN / ' + run.id : '尚无运行记录';
    $('run-id').title = run?.id || '';
    $('interrupt-button').hidden = !isRunning() && state.run?.status !== 'paused';
    $('task-footer-note').hidden = !!isRunning() || state.run?.status === 'paused';
    $('task-footer-note').textContent = runIsDemo() ? '预设事件 · 模拟数据' : '线程与状态实时同步';
    const signature = JSON.stringify([state.mode, run]);
    if (signature === lastTaskSignature) return;
    lastTaskSignature = signature;
    if (!run) {
      const empty = el('div', 'empty-state');
      const art = el('div', 'empty-tree'); art.setAttribute('aria-hidden', 'true');
      const root = el('span', 'empty-node empty-root'); root.append(icon('terminal'));
      art.append(root, el('span', 'tree-line tree-line-vertical'), el('span', 'tree-line tree-line-horizontal'));
      ['search', 'code', 'star'].forEach((name, i) => { const node = el('span', 'empty-node empty-child ' + ['one', 'two', 'three'][i]); node.append(icon(name)); art.append(node); });
      const copy = el('p', '', '启动任务后，在这里查看子任务、角色分工\n以及每条执行线程的实时状态。'); copy.style.whiteSpace = 'pre-line';
      const demo = el('button', 'text-button', '先看看团队如何协作'); demo.append(icon('arrow')); demo.addEventListener('click', openDemo); demo.disabled = hasConnection() || busy;
      empty.append(art, el('h3', '', '让复杂任务有条不紊'), copy, demo);
      $('task-content').replaceChildren(empty);
      return;
    }
    const header = el('div', 'task-run-header');
    const heading = el('div'); heading.append(el('h3', '', run.goal || '协作任务'), el('p', '', (runIsDemo() ? '模拟执行 · 无真实推理' : '真实执行 · 只读样例范围') + (run.stage ? ' · ' + label(run.stage, run.stage) : '')));
    header.append(icon('terminal'), heading);
    const list = el('div', 'thread-list');
    threads.forEach((thread) => {
      const status = canonicalStatus(thread.status);
      const row = el('article', 'thread-row ' + status + (thread.parentId || thread.parent_id ? ' child' : ''));
      const dot = el('span', 'thread-dot');
      const definition = roleDefinitions.find((role) => role.id === thread.role || role.id === thread.roleId);
      dot.append(icon(status === 'completed' ? 'check' : definition?.icon || 'terminal'));
      const copy = el('div', 'thread-copy');
      copy.append(el('strong', '', thread.title || thread.name || roleName(thread.role || thread.roleId)));
      const summary = thread.summary || thread.message || thread.description || thread.result;
      if (summary) copy.append(el('p', '', objectText(summary)));
      const meta = el('div', 'thread-meta');
      meta.append(el('span', '', roleName(thread.role || thread.roleId)));
      if (thread.model) meta.append(el('span', '', thread.model));
      if (thread.id) { const id = el('span', '', String(thread.id).slice(0, 18)); id.title = thread.id; meta.append(id); }
      copy.append(meta); row.append(dot, copy, el('span', 'thread-status', label(thread.status))); list.append(row);
    });
    if (!threads.length) list.append(el('p', 'panel-intro', '任务已创建，等待第一条执行线程。'));
    const nodes = [header, list];
    if (['paused', 'blocked', 'denied', 'rejected'].includes(run.status)) nodes.push(el('div', 'run-alert', '任务已暂停或阻塞。请在时间线查看原因；原型不会自动批准权限请求，也不会绕过安全检查。'));
    if (run.errorCount) nodes.push(el('div', 'run-alert', '已记录 ' + run.errorCount + ' 次错误。查看架构师复核与运行日志了解处理结果。'));
    if (run.result) {
      const result = el('div', 'run-result');
      result.append(el('h4', '', runIsDemo() ? '模拟结果 · 预设数据' : '任务结果'), el('p', '', objectText(run.result)));
      nodes.push(result);
    }
    $('task-content').replaceChildren(...nodes);
  }

  function category(event) {
    const text = [event.type, event.source, event.role].join(' ').toLowerCase();
    if (/error|fail|denied|reject|pause|block|approval|warn/.test(text)) return 'error';
    if (/review|architect|gate/.test(text)) return 'review';
    if (/tool|command|exec|file|mcp/.test(text)) return 'tool';
    if (/agent|thread|turn|explor|research|worker|luna|sol|astra/.test(text)) return 'agent';
    return 'system';
  }
  function eventTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 12);
    return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function renderEvents() {
    const events = state.events || [];
    $('event-count').textContent = String(events.length);
    const signature = JSON.stringify([filter, events]);
    if (signature === lastEventSignature) return;
    lastEventSignature = signature;
    const list = $('event-list');
    const oldScroll = list.scrollTop;
    const openDetails = new Set(Array.from(list.querySelectorAll('details[open]')).map((node) => node.dataset.eventId));
    const filtered = events.filter((event) => filter === 'all' || category(event) === filter).slice().reverse();
    const nodes = filtered.map((event, index) => {
      const type = category(event);
      const row = el('article', 'event-row ' + type);
      const time = el('time', 'event-time', eventTime(event.time || event.timestamp));
      if (event.time || event.timestamp) { time.title = String(event.time || event.timestamp); time.dateTime = String(event.time || event.timestamp); }
      const eventIcon = el('span', 'event-icon'); eventIcon.append(icon({ tool: 'code', review: 'shield', error: 'info', agent: 'layers', system: 'pulse' }[type]));
      const copy = el('div', 'event-copy');
      const top = el('div', 'event-top');
      top.append(el('span', 'event-source', event.role ? roleName(event.role) : event.source || '系统'), el('span', 'event-type', event.type || type));
      copy.append(top, el('p', '', event.message || event.summary || '状态更新'));
      if (event.detail || event.threadId || event.turnId) {
        const details = el('details'); const id = String(event.id || index); details.dataset.eventId = id; details.open = openDetails.has(id);
        const detail = typeof event.detail === 'object' && event.detail !== null ? { ...event.detail } : event.detail ? { detail: event.detail } : {};
        if (event.threadId) detail.threadId = event.threadId;
        if (event.turnId) detail.turnId = event.turnId;
        details.append(el('summary', '', '查看详情'), el('pre', '', JSON.stringify(detail, null, 2))); copy.append(details);
      }
      row.append(time, eventIcon, copy); return row;
    });
    if (!nodes.length) {
      const empty = el('div', 'events-empty');
      empty.append(icon('pulse'), el('p', '', events.length ? '当前筛选下没有事件。' : '任务公开状态、工具调用与审核会在这里留下轨迹。'), el('span', '', events.length ? '尝试切换到其他事件类型' : '等待第一条运行事件'));
      nodes.push(empty);
    }
    list.replaceChildren(...nodes);
    list.scrollTop = oldScroll;
  }

  function renderConnection() {
    const connection = state.connection;
    const isDemo = state.mode === 'demo';
    const connected = hasConnection();
    const ready = connection.ready === true;
    const authenticated = connection.authenticated;
    $('mode-badge').className = 'mode-badge ' + (isDemo ? 'demo' : connected ? 'live' : '');
    $('mode-badge').replaceChildren(el('span'), document.createTextNode(isDemo ? '演示模式' : connected ? '实时连接' : '未连接'));
    $('sidebar-status-light').className = 'status-light ' + (isDemo ? 'demo' : ready ? 'live' : '');
    $('sidebar-status').textContent = isDemo ? '正在模拟演示' : ready ? 'Codex 已就绪' : connected ? 'Codex 已连接' : '等待连接';
    $('connection-dot').className = 'small-dot ' + (ready ? 'live' : 'muted');
    $('connection-status').textContent = isDemo ? '演示模式 · 未连接 Codex' : ready ? '已连接，可以启动任务' : connected ? '已连接，尚未就绪' : label(connection.status, '尚未连接');
    $('connection-message').textContent = connection.message || (isDemo ? '当前播放预设协作数据，未验证模型与认证状态。' : '通过本地桥接服务连接 Codex，验证登录状态和模型可用性。');
    $('auth-status').textContent = isDemo ? '演示不使用认证' : !connected ? '未检查' : authenticated === true ? '已认证' : authenticated === false ? '未认证' : '未检查';
    $('auth-status').style.color = authenticated === true && !isDemo ? 'var(--green)' : '';
    $('server-version').textContent = connection.version || '—';
    $('ready-status').textContent = isDemo ? '仅模拟数据' : ready ? '已就绪' : '尚未就绪';
    $('ready-status').style.color = ready ? 'var(--green)' : '';
    const models = [...new Set(roleDefinitions.map((role) => role.model))];
    $('model-list').replaceChildren(...models.map((id) => {
      const listed = !isDemo && connected && modelIsListed(id);
      const chip = el('span', 'model-chip' + (listed ? ' available' : ''), id);
      chip.title = isDemo ? '演示模型标签；没有进行可用性检查' : listed ? '服务端模型列表包含此模型；认证状态单独显示' : connected ? '服务端未报告此模型' : '尚未检查';
      return chip;
    }));
    const connectButton = $('connect-button');
    connectButton.replaceChildren(icon('plug'), el('span', '', busy ? '处理中…' : connected ? '断开连接' : '连接 Codex'));
    connectButton.disabled = busy;
    $('demo-top').disabled = busy || connected;
    $('demo-top').title = connected ? '先断开 Codex 连接，再体验模拟演示' : '选择模拟场景';
    $('exit-demo').disabled = busy;
    $('demo-banner').hidden = !isDemo;
    const canRun = ready && state.mode === 'live' && !busy && !isRunning() && state.run?.status !== 'paused' && $('goal').value.trim().length > 0;
    $('run-button').disabled = !canRun;
    $('run-button').title = canRun ? '启动只读样例工作区任务' : isDemo ? '演示使用预设流程，输入不会发送给模型' : !ready ? '先连接 Codex，并通过认证和模型检查' : isRunning() || state.run?.status === 'paused' ? '等待当前任务结束，或中断当前任务' : '先输入任务目标';
    $('composer-hint').textContent = isDemo ? '演示使用预设目标；输入不会发送给任何模型' : state.run?.status === 'paused' ? '任务已暂停；中断当前流程后可重新开始' : isRunning() ? '任务执行中，可以在任务面板中断' : ready ? '真实推理已就绪 · 仅限只读样例工作区' : connected && authenticated !== true ? '需要 Codex 认证；发现模型不等于可以推理' : '连接并验证模型后，即可启动真实推理';
  }

  function render() { renderConnection(); renderRoles(); renderReviews(); renderTasks(); renderEvents(); }
  function applyState(next) {
    if (!next || typeof next !== 'object') return;
    if (next.state) next = next.state;
    if (!next.mode || !next.connection) return;
    if (next.mode === 'demo' && next.run?.id) demoRunIds.add(next.run.id);
    state = { ...next, connection: { models: [], ...next.connection }, roles: next.roles || [], events: next.events || [], run: next.run || null };
    render();
  }
  async function request(path, body) {
    if (busy) return null;
    busy = true; renderConnection();
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Control-Panel': '1' }, body: JSON.stringify(body || {}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || '请求失败（' + response.status + '）');
      applyState(data);
      return data;
    } catch (error) { toast(error.message || '无法连接控制台服务，请确认本地服务正在运行。', true); return null; }
    finally { busy = false; renderConnection(); }
  }
  function openDemo() {
    if (hasConnection()) { toast('请先断开 Codex 连接，再体验模拟演示。'); return; }
    if (busy) return;
    $('demo-dialog').showModal();
  }
  function showInfo(type) {
    const content = $('info-content');
    content.replaceChildren();
    if (type === 'api') {
      $('info-title').textContent = '本地桥接接口';
      content.append(el('p', '', '控制台通过同源 HTTP 接口与本地桥接服务通信。实时状态由 Server-Sent Events 推送。'));
      [
        ['GET /api/state', '读取连接、角色、任务、审核与事件状态'],
        ['GET /api/events', 'SSE 实时订阅；state 事件携带完整状态'],
        ['POST /api/connect', '连接 Codex，检查认证与模型；空 JSON 请求'],
        ['POST /api/disconnect', '断开连接并停止当前流程；空 JSON 请求'],
        ['POST /api/run', '启动真实只读任务；参数 goal'],
        ['POST /api/interrupt', '请求中断当前任务；空 JSON 请求'],
        ['POST /api/demo', '仅断开时可用；scenario 为 success、repeated-error 或 approval'],
      ].forEach(([route, text]) => { const item = el('div', 'api-route', route); item.append(el('span', '', text)); content.append(item); });
      content.append(el('p', '', '真实执行由服务端校验。模型出现在列表中不构成认证凭据。不要把访问令牌或密码粘贴到任务输入框。'));
    } else {
      $('info-title').textContent = '为可见的协作而设计';
      content.append(el('p', '', '这是一个独立的本地 Codex 多智能体控制台原型，不是 Codex 官方界面。它让角色分工、任务线程、工具事件与审核节点集中可见。'));
      content.append(el('h3', '', '两种清晰区分的运行方式'));
      const list = el('ul');
      list.append(el('li', '', '模拟演示：播放预设数据，不调用 Codex、不执行命令、不修改文件。'), el('li', '', '实时连接：通过本地 Codex app-server 运行。必须完成认证，并确认所需模型可用，才会启用任务按钮。'));
      content.append(list, el('h3', '', '隔离环境要求'), el('p', '', '项目专用 HOME 和只读模式不等于操作系统级的文件读取隔离。启用真实推理前，操作者必须提供真正隔离的执行环境，并在终端显式启用；本界面不能创建或证明该隔离。'), el('h3', '', '原型的执行范围'), el('p', '', '真实任务限定在服务端的只读样例工作区。控制台不会把任意提示词变成不受限制的终端控制，也不会自动批准命令、文件或权限请求。遇到权限请求时，服务端拒绝并暂停。时间线保留最近 300 条公开状态事件，不展示私人推理过程。'), el('p', '', '计划、重复错误和最终交付由架构师角色复核。演示里的复核是模拟事件；实时模式里的结果以实际服务端事件为准。'));
    }
    $('info-dialog').showModal();
  }
  function updateStream(connected) {
    streamConnected = connected;
    $('stream-state').textContent = connected ? '实时同步' : '重连中';
    $('stream-dot').className = 'small-dot ' + (connected ? 'live' : '');
    $('stream-label').textContent = connected ? '控制台事件流已连接' : '等待控制台服务';
    $('activity-dot').style.background = connected ? 'var(--green)' : '';
  }

  $('connect-button').addEventListener('click', async () => { await request(hasConnection() ? '/api/disconnect' : '/api/connect', {}); });
  $('demo-top').addEventListener('click', openDemo);
  $('empty-demo').addEventListener('click', openDemo);
  $('exit-demo').addEventListener('click', () => request('/api/disconnect', {}));
  document.querySelectorAll('[data-scenario]').forEach((button) => button.addEventListener('click', async () => {
    if (busy || hasConnection()) return;
    $('demo-dialog').close();
    const result = await request('/api/demo', { scenario: button.dataset.scenario });
    if (result) $('tasks').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }));
  $('goal').addEventListener('input', renderConnection);
  async function run() { if (!$('run-button').disabled) await request('/api/run', { goal: $('goal').value.trim() }); }
  $('run-button').addEventListener('click', run);
  $('goal').addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); run(); } });
  $('interrupt-button').addEventListener('click', () => request('/api/interrupt', {}));
  $('help-button').addEventListener('click', () => showInfo('about'));
  $('api-button').addEventListener('click', () => showInfo('api'));
  $('dismiss-toast').addEventListener('click', () => { $('toast').hidden = true; });
  document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('.filter').forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
    renderEvents();
  }));
  document.querySelectorAll('.nav-item').forEach((link) => link.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((item) => { item.classList.toggle('active', item === link); item.removeAttribute('aria-current'); });
    link.setAttribute('aria-current', 'location');
  }));
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
  });
  document.querySelector('.nav-item.active').setAttribute('aria-current', 'location');
  render();
  fetch('/api/state').then((response) => { if (!response.ok) throw new Error('状态接口不可用'); return response.json(); }).then(applyState).catch((error) => toast(error.message + '。请确认本地控制台服务已启动。', true));
  source = new EventSource('/api/events');
  source.addEventListener('state', (event) => { try { applyState(JSON.parse(event.data)); updateStream(true); } catch (_) { toast('收到无法解析的状态事件。等待下一次状态同步。', true); } });
  source.addEventListener('open', () => updateStream(true));
  source.addEventListener('error', () => updateStream(false));
  window.addEventListener('pagehide', () => source.close());
  window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
})();
