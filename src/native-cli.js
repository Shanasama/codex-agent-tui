import { mkdir, readFile, writeFile, cp, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { ROOT, RUNTIME, codexCommand } from './runtime.js';
import { liveEnv, prepareLiveRuntime } from './live-workspace.js';

const exec = promisify(execFile);
export const MARKETPLACE_NAME = 'codex-tui-local';
export const PLUGIN_ID = `jev-workflow@${MARKETPLACE_NAME}`;
export const MARKETPLACE_ROOT = path.join(RUNTIME, 'cli-marketplace');
export async function prepareCliPlugin() {
  await prepareLiveRuntime();
  const source = path.join(ROOT, 'plugins', 'jev-workflow');
  const destination = path.join(MARKETPLACE_ROOT, 'plugins', 'jev-workflow');
  const manifest = await readFile(path.join(source, '.codex-plugin', 'plugin.json'), 'utf8');
  const skill = await readFile(path.join(source, 'skills', 'jev-workflow', 'SKILL.md'), 'utf8');
  const fingerprint = createHash('sha256').update(manifest + skill + ROOT + process.execPath).digest('hex');
  await mkdir(path.join(MARKETPLACE_ROOT, '.agents', 'plugins'), { recursive: true });
  await cp(source, destination, { recursive: true });
  await writeFile(path.join(destination, '.mcp.json'), JSON.stringify({ mcpServers: {
    jev_workflow: { command: process.execPath, args: [path.join(ROOT, 'src', 'cli-plugin-server.js')] },
  } }, null, 2));
  await writeFile(path.join(MARKETPLACE_ROOT, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
    name: MARKETPLACE_NAME, interface: { displayName: 'Jev 本地工作流' }, plugins: [{ name: 'jev-workflow', source: { source: 'local', path: './plugins/jev-workflow' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
  }, null, 2));
  return { fingerprint, destination };
}
export async function installCliPlugin({ force = false, scope = 'isolated' } = {}) {
  if (!['isolated', 'user'].includes(scope)) throw new Error('安装范围必须是 isolated 或 user');
  const prepared = await prepareCliPlugin();
  const marker = path.join(RUNTIME, scope === 'user' ? 'cli-plugin-installed-user.json' : 'cli-plugin-installed.json');
  if (!force) {
    try { if (JSON.parse(await readFile(marker, 'utf8')).fingerprint === prepared.fingerprint) return { pluginId: PLUGIN_ID, alreadyInstalled: true }; } catch { /* first install */ }
  }
  const binary = await codexCommand();
  const options = { env: scope === 'user' ? process.env : liveEnv(), cwd: ROOT, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 };
  await exec(binary, ['plugin', 'marketplace', 'add', MARKETPLACE_ROOT, '--json'], options);
  const result = await exec(binary, ['plugin', 'add', PLUGIN_ID, '--json'], options);
  const installed = JSON.parse(result.stdout);
  await writeFile(marker, JSON.stringify({ fingerprint: prepared.fingerprint, installedAt: new Date().toISOString(), pluginId: PLUGIN_ID, scope }, null, 2));
  return installed;
}
export function nativeCliArgs({ project = ROOT, model = 'gpt-6.1-sol', resume = false } = {}) {
  const args = ['--no-daemon', '--cd', project, '--model', model, '--sandbox', 'workspace-write', '--ask-for-approval', 'on-request', '-c', 'agents.enabled=true'];
  if (resume) args.push('resume', '--last');
  return args;
}
export async function runNativeCli(options) {
  if (!(await stat(options.project)).isDirectory()) throw new Error('请选择有效的项目目录');
  const binary = await codexCommand();
  // Native Codex owns the terminal, continuous session, slash menus and approvals.
  const child = spawn(binary, nativeCliArgs(options), { cwd: options.project, env: liveEnv(), stdio: 'inherit', shell: false });
  return await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
  });
}
