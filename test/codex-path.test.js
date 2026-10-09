import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RUNTIME, codexCommand } from '../src/runtime.js';

test('Windows desktop launch finds installed Codex without its directory on PATH', { skip: process.platform !== 'win32' }, async () => {
  await mkdir(RUNTIME, { recursive: true });
  const directory = await mkdtemp(path.join(RUNTIME, 'codex-path-test-'));
  const installed = path.join(directory, 'Local', 'OpenAI', 'Codex', 'bin', 'installed-version', 'codex.exe');
  await mkdir(path.dirname(installed), { recursive: true });
  await mkdir(path.join(directory, 'Local', 'OpenAI', 'Codex', 'bin', 'stale-version'));
  await writeFile(installed, 'test-only executable path; never executed');
  const env = { Path: path.join(directory, 'missing-path'), LocalAppData: path.join(directory, 'Local') };
  assert.equal(await codexCommand({ env }), installed);
  const preferred = path.join(directory, 'on-path', 'codex.exe');
  await mkdir(path.dirname(preferred)); await writeFile(preferred, 'test-only path');
  assert.equal(await codexCommand({ env: { ...env, Path: path.dirname(preferred) } }), preferred);
  assert.equal(await codexCommand({ env: { ...env, CONTROL_PANEL_CODEX_BIN: preferred } }), preferred);
  await assert.rejects(codexCommand({ env: { ...env, CONTROL_PANEL_CODEX_BIN: path.join(directory, 'missing.exe') } }), /ENOENT/);
  await assert.rejects(codexCommand({ env: { CONTROL_PANEL_CODEX_BIN: 'codex.cmd' } }), /\.cmd/);
  await assert.rejects(codexCommand({ env: {} }), /未找到 codex.exe/);
});
