import type { Finding } from './types.ts';

export interface Boundary {
  /** Directory the rule applies to, relative to the repo root. */
  from: string;
  /** Import specifiers (or prefixes of them) that files under `from` may not import. */
  forbid: string[];
}

const IMPORT = /(?:\bfrom\s+|\bimport\s+|\bimport\(\s*|\brequire\(\s*)['"]([^'"]+)['"]/g;
const SOURCE = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;

/** Parses factory.config.json. Throws on a malformed file so a typo cannot silently disable the rules. */
export function parseBoundaries(configText: string): Boundary[] {
  const config = JSON.parse(configText) as { boundaries?: unknown };
  if (config.boundaries === undefined) return [];
  if (!Array.isArray(config.boundaries)) throw new Error('"boundaries" must be an array');
  return config.boundaries.map((b, i) => {
    const { from, forbid } = (b ?? {}) as Partial<Boundary>;
    if (typeof from !== 'string' || !Array.isArray(forbid) || forbid.some((f) => typeof f !== 'string')) {
      throw new Error(`boundaries[${i}] needs a string "from" and a string array "forbid"`);
    }
    return { from: from.replace(/\/+$/, ''), forbid };
  });
}

/** A001: a source file imports something its layer is not allowed to depend on. */
export function checkBoundariesInText(file: string, text: string, boundaries: Boundary[]): Finding[] {
  if (!SOURCE.test(file)) return [];
  const active = boundaries.filter((b) => file.startsWith(`${b.from}/`));
  if (active.length === 0) return [];

  const findings: Finding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const match of line.matchAll(IMPORT)) {
      const spec = match[1];
      for (const b of active) {
        const hit = b.forbid.find((f) => spec === f || spec.startsWith(`${f}/`));
        if (hit) {
          findings.push({ rule: 'A001', file, line: i + 1, message: `Files under ${b.from}/ may not import "${hit}" (found "${spec}").` });
        }
      }
    }
  });
  return findings;
}
