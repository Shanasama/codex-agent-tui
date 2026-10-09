import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ignored = new Set(['node_modules', 'runtime', 'vendor', 'dist', 'build', 'target', '__pycache__', 'coverage']);
export async function readInspectionFiles(root) {
  const candidates = [], listing = []; let limited = false;
  async function walk(directory, depth) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (listing.length >= 1200) { limited = true; return; }
      if (entry.name.startsWith('.') || ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name), relative = path.relative(root, absolute);
      listing.push(relative + (entry.isDirectory() ? '/' : ''));
      if (entry.isDirectory()) { if (depth < 3) await walk(absolute, depth + 1); else limited = true; }
      else if (entry.isFile() && (/\.(md|txt|py|js|ts|tsx|jsx|rs)$/i.test(entry.name) || /^(package\.json|pyproject\.toml|Cargo\.toml|requirements\.txt)$/i.test(entry.name))) {
        const rank = /^(README|AGENTS)\.md$/i.test(entry.name) ? 0 : /^(package\.json|pyproject\.toml|Cargo\.toml)$/i.test(entry.name) ? 1 : /\.md$/i.test(entry.name) ? 2 : 3;
        candidates.push({ absolute, relative, rank, depth });
      }
    }
  }
  await walk(root, 0);
  candidates.sort((a, b) => a.rank - b.rank || a.depth - b.depth || a.relative.localeCompare(b.relative));
  const files = []; let remaining = 80000;
  for (const candidate of candidates) {
    if (files.length >= 30 || remaining <= 0) { limited = true; break; }
    const data = await readFile(candidate.absolute);
    if (data.includes(0)) continue;
    const original = data.toString('utf8');
    const text = original.slice(0, Math.min(10000, remaining)); remaining -= text.length;
    files.push({ path: candidate.relative, text, truncated: text.length < original.length });
  }
  if (!files.length) throw new Error('目录中没有可供分析的文本材料；请指定包含项目文件的目录');
  return { listing, files, limited, note: '只读概览；跳过隐藏目录、依赖、构建产物及符号链接，最多 4 层、1200 个目录条目、30 个文件、80000 字符。' };
}
export const INSPECTION_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  status: { type: 'string', enum: ['completed', 'blocked'] }, report: { type: 'string' },
  filesReviewed: { type: 'array', items: { type: 'string' } },
}, required: ['status', 'report', 'filesReviewed'] };
export function parseInspection(text, evidence) {
  let result; try { result = JSON.parse(text); } catch { throw new Error('查看报告没有返回有效的结构化结果'); }
  const available = new Set(evidence.files.map(f => f.path));
  if (!result || !['completed', 'blocked'].includes(result.status) || typeof result.report !== 'string' || !result.report.trim() || !Array.isArray(result.filesReviewed) || result.filesReviewed.some(f => typeof f !== 'string' || !available.has(f))) throw new Error('查看报告的结构或引用文件证据无效');
  if (result.status === 'completed' && !result.filesReviewed.length) throw new Error('查看报告没有引用任何已提供的文件，不能标记完成');
  return result;
}
