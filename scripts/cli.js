import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { installCliPlugin, runNativeCli } from '../src/native-cli.js';
import { normalizeProjectPath } from '../src/live-workspace.js';
import { cleanText } from '../src/tui-render.js';
try {
  const { values } = parseArgs({ options: { project: { type: 'string' }, model: { type: 'string' }, resume: { type: 'boolean' }, 'install-only': { type: 'boolean' } } });
  console.log('正在准备 Codex CLI 与 Jev 工作流插件…');
  const installed = await installCliPlugin();
  if (values['install-only']) { console.log(`插件已就绪：${installed.pluginId}`); }
  else {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('请在交互终端运行；仅安装插件可用 --install-only');
    let project = normalizeProjectPath(values.project);
    if (!project) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try { project = normalizeProjectPath(await prompt.question('项目目录（回车使用当前目录）：')); }
      finally { prompt.close(); process.stdin.pause(); }
    }
    project = path.resolve(project || process.cwd());
    console.log('进入官方 Codex CLI，可连续对话。/plugins 管理插件；/skills 选择 jev-workflow；$jev-workflow 后输入任务。');
    process.exitCode = await runNativeCli({ project, model: values.model, resume: values.resume });
  }
} catch (error) { console.error(cleanText(error.message)); process.exitCode = 1; }
