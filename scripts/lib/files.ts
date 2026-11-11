import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const MAX_TEXT_BYTES = 1_000_000;

/** All files under root as forward-slash relative paths, skipping build and VCS dirs. */
export function walk(root: string, dir = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(root, rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out.sort();
}

/** File contents as text, or null when the file is binary or too large to scan. */
export function readText(root: string, rel: string): string | null {
  const full = join(root, rel);
  if (statSync(full).size > MAX_TEXT_BYTES) return null;
  const buf = readFileSync(full);
  if (buf.includes(0)) return null;
  return buf.toString('utf8');
}
