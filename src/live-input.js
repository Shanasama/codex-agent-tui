import { normalizeProjectPath } from './live-workspace.js';

// Shared by the interactive launcher and its regression tests.
export async function readTaskInput(values, question) {
  let project = normalizeProjectPath(values.project) || undefined;
  let goal = values.goal?.trim();
  if (!values.fixture && !project) {
    project = normalizeProjectPath(await question('项目目录（直接回车运行购物车验收示例）：')) || undefined;
  }
  let mode = values.mode || (project ? undefined : 'edit');
  if (!mode) {
    const choice = (await question('任务类型 [1] 只读查看（默认） [2] 修改代码：')).trim();
    if (!['', '1', '2'].includes(choice)) throw new Error('任务类型请输入 1 或 2');
    mode = choice === '2' ? 'edit' : 'inspect';
  }
  if (!['edit', 'inspect'].includes(mode)) throw new Error('--mode 必须是 inspect 或 edit');
  if (!goal) goal = (await question(mode === 'inspect' ? '查看需求（默认：查看项目结构、用途、启动方式和待处理问题）：' : '任务需求（示例可直接回车）：')).trim();
  if (!goal && mode === 'inspect') goal = '查看项目结构、用途、启动方式和待处理问题，说明证据与尚未验证的事项。';
  if (!goal && project) throw new Error('修改代码需要输入具体任务需求');
  if (!goal) goal = '修复购物车金额计算，校验非法输入，并补充测试。';
  let testArgv;
  if (mode === 'edit' && project) {
    const text = values['test-args'] || await question('验收命令参数（JSON 数组，例如 ["node","--test"]）：');
    try { testArgv = JSON.parse(text); } catch { throw new Error('验收命令需要有效的 JSON 数组；只想查看项目请选择只读查看。'); }
  }
  return { project, goal, mode, testArgv };
}
