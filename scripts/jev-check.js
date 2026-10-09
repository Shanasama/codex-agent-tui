import { JevClient, loadJevKey } from '../src/jev.js';
try {
  const client = new JevClient({ apiKey: await loadJevKey() });
  console.log(`Jev 账户模型可用：${await client.check()}`);
  if (process.argv.includes('--infer')) {
    const result = await client.route({ goal: '修复购物车总价计算，使它累加 price * quantity，非法输入抛错。', fixture: true });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
