import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, RUNTIME } from '../src/runtime.js';

test('Windows key save/read use matching Security module despite inherited module path', { skip: process.platform !== 'win32' }, async () => {
  await mkdir(RUNTIME, { recursive: true });
  const directory = await mkdtemp(path.join(RUNTIME, 'key-module-test-'));
  const modules = path.join(directory, 'Modules');
  const wrongModule = path.join(modules, 'Microsoft.PowerShell.Security');
  await mkdir(wrongModule, { recursive: true });
  await writeFile(path.join(wrongModule, 'Microsoft.PowerShell.Security.psd1'), "@{ ModuleVersion = '99.0.0'; RootModule = 'wrong.psm1'; FunctionsToExport = @('ConvertFrom-SecureString','ConvertTo-SecureString') }");
  await writeFile(path.join(wrongModule, 'wrong.psm1'), "throw 'Wrong inherited Security module loaded'\n");
  const env = { ...process.env, PSModulePath: modules };
  const script = path.join(ROOT, 'scripts', 'jev-key.ps1');
  const keyFile = path.join(directory, 'test-only.dpapi');
  const quote = text => "'" + text.replaceAll("'", "''") + "'";
  const run = code => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', code], { env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  // A synthetic value, never the user's key. Replace only the interactive input.
  const value = 'unit-test-only-not-a-real-key';
  const saved = run(`function Read-Host { param([string]$Prompt, [switch]$AsSecureString) $s = New-Object System.Security.SecureString; foreach ($ch in ${quote(value)}.ToCharArray()) { $s.AppendChar($ch) }; return $s }; & ${quote(script)} -Mode Save -KeyFile ${quote(keyFile)}`);
  assert.equal(saved.status, 0, saved.stderr);
  assert.doesNotMatch(saved.stdout + saved.stderr, new RegExp(value));
  const encrypted = await readFile(keyFile, 'utf8');
  assert.ok(encrypted.trim().length > value.length);
  assert.ok(!encrypted.includes(value));
  // Also accept ciphertext written by the old Set-Content path with CRLF.
  await writeFile(keyFile, encrypted.trim() + '\r\n');
  const loaded = run(`& ${quote(script)} -Mode Read -KeyFile ${quote(keyFile)}`);
  assert.equal(loaded.status, 0, loaded.stderr);
  assert.equal(loaded.stdout, value);
});
