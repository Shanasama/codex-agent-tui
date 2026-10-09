import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
let count = 0;
for (const dir of ['src', 'scripts', 'test', 'public']) {
  for (const name of readdirSync(dir).filter(n => /\.(js|cjs)$/.test(n))) {
    const result = spawnSync(process.execPath, ['--check', `${dir}/${name}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(1); count++;
  }
}
console.log(`Syntax checked ${count} JavaScript files. No TypeScript compilation or linting is claimed.`);
