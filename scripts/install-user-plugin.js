import { installCliPlugin } from '../src/native-cli.js';
try {
  const installed = await installCliPlugin({ scope: 'user', force: true });
  console.log(`已安装到普通 Codex CLI：${installed.pluginId}`);
  console.log('重开普通 codex 会话后，在 /skills 中选择 jev-workflow，或使用 $jev-workflow。日常使用不需要项目启动脚本。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
