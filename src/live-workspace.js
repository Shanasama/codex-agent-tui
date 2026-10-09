import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ROOT, RUNTIME, isolatedEnv, assertSafePath, canonicalPath } from './runtime.js';

const exec = promisify(execFile);
export const LIVE_HOME = path.join(RUNTIME, 'live-home');
export async function prepareLiveRuntime() {
  for (const dir of [RUNTIME, LIVE_HOME, path.join(RUNTIME, 'home'), path.join(RUNTIME, 'tmp'), path.join(RUNTIME, 'runs')]) {
    await assertSafePath(dir); await mkdir(dir, { recursive: true }); await assertSafePath(dir, true);
  }
  // Separate from both the legacy read-only prototype and the user's Codex settings.
  const config = '[analytics]\nenabled = false\n[agents]\nenabled = false\n';
  try { await writeFile(path.join(LIVE_HOME, 'config.toml'), config, { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
}
export function liveEnv() { return { ...isolatedEnv(), CODEX_HOME: LIVE_HOME }; }
export async function git(cwd, args) {
  const result = await exec('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return result.stdout;
}
export function normalizeProjectPath(value) {
  const text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1).trim();
  return text;
}
export async function createTaskWorkspace({ project, testArgv, mode = 'edit' } = {}) {
  await prepareLiveRuntime();
  if (!['edit', 'inspect'].includes(mode)) throw new Error('任务类型必须是 inspect 或 edit');
  project = normalizeProjectPath(project) || undefined;
  if (mode === 'inspect' && !project) throw new Error('只读查看需要指定项目目录');
  if (mode === 'edit' && project && (!Array.isArray(testArgv) || !testArgv.length || testArgv.some(s => typeof s !== 'string' || !s))) {
    throw new Error('真实项目必须指定验收命令 --test-args，例如 ["node","--test"]');
  }
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(RUNTIME, 'runs', id), cwd = path.join(directory, 'workspace');
  if (mode === 'inspect') {
    const source = await canonicalPath(project);
    if (!(await stat(source)).isDirectory()) throw new Error('请选择项目目录');
    await mkdir(directory);
    const task = { id, directory, cwd: source, source, sourceCommit: null, testArgv: null, fixture: false, mode };
    await writeFile(path.join(directory, 'task.json'), JSON.stringify(task, null, 2));
    return task;
  }
  await mkdir(directory);
  let source = null, sourceCommit = null;
  if (project) {
    source = await canonicalPath(project);
    if ((await git(source, ['rev-parse', '--show-toplevel'])).trim().toLowerCase() !== source.toLowerCase()) throw new Error('请选择 Git 仓库根目录');
    if ((await git(source, ['status', '--porcelain'])).trim()) throw new Error('项目有未提交修改。请先保存为提交，再创建任务；原文件未改动。');
    sourceCommit = (await git(source, ['rev-parse', 'HEAD'])).trim();
    await git(source, ['worktree', 'add', '--detach', cwd, sourceCommit]);
  } else {
    await mkdir(cwd);
    await writeFile(path.join(cwd, 'package.json'), '{"type":"module","private":true}\n');
    await writeFile(path.join(cwd, 'cart.js'), await readFile(path.join(ROOT, 'fixture-workspace', 'cart.js')));
    await git(cwd, ['init']);
    await git(cwd, ['add', '--', 'cart.js', 'package.json']);
    await git(cwd, ['-c', 'user.name=Mission Control', '-c', 'user.email=local@example.invalid', 'commit', '-m', 'Initial acceptance fixture']);
    sourceCommit = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
    const checks = path.join(directory, 'checks'); await mkdir(checks);
    await writeFile(path.join(checks, 'cart.test.mjs'), `import test from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../workspace/cart.js';
test('price times quantity', () => assert.equal(cartTotal([{price:12,quantity:2},{price:3,quantity:4}]),36));
test('empty cart', () => assert.equal(cartTotal([]),0));
test('zero quantity', () => assert.equal(cartTotal([{price:12,quantity:0}]),0));
test('decimal prices', () => assert.ok(Math.abs(cartTotal([{price:0.1,quantity:3}])-0.3)<1e-10));
test('invalid input', () => { for (const value of [null, {}, [null], [{price:-1,quantity:2}], [{price:1,quantity:-2}], [{price:NaN,quantity:2}], [{price:1,quantity:Infinity}], [{price:'2',quantity:1}], [{price:1}]]) assert.throws(() => cartTotal(value)); });
`);
    testArgv = [process.execPath, '--test', path.join(checks, 'cart.test.mjs')];
  }
  const task = { id, directory, cwd, source, sourceCommit, testArgv, fixture: !project, mode };
  await writeFile(path.join(directory, 'task.json'), JSON.stringify(task, null, 2));
  return task;
}
export async function collectChanges(task) {
  const tracked = await git(task.cwd, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--']);
  const untracked = (await git(task.cwd, ['ls-files', '--others', '--exclude-standard'])).trim();
  const head = (await git(task.cwd, ['rev-parse', 'HEAD'])).trim();
  if (head !== task.sourceCommit) throw new Error('执行角色改变了 Git 提交位置；请人工检查任务目录');
  return { diff: tracked, untracked, changed: Boolean(tracked.trim() || untracked) };
}
