// The research guard: run after an agent finishes (and by the agent itself as
// a self-check). It enforces, in software, what each role may write:
// - nothing that existed before the run may change or disappear;
// - the researcher may only add claims, responses, its own evidence and reports;
// - the reviewer may only add reviews and its own evidence;
// - new claims and reviews belong to the round being run;
// - every new url evidence record matches a retrieval in the fetch log, so a
//   hash or a source cannot be made up;
// - the study as a whole passes R002 and R003.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchLogEntry } from './fetch-source.ts';
import { sha256Hex } from './fetch-source.ts';
import { checkResearch, classifyResearchPath } from './research.ts';
import type { Finding } from './types.ts';

export type Role = 'researcher' | 'reviewer';

/** Relative path -> sha256 of every file under `dir` (paths relative to `root`). */
export function manifest(root: string, dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    const full = join(root, rel);
    let entries;
    try {
      entries = readdirSync(full, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.isFile()) out[child] = sha256Hex(readFileSync(join(root, child)));
    }
  };
  if (statSync(join(root), { throwIfNoEntry: false })) walk(dir);
  return out;
}

const ROLE_KINDS: Record<Role, string[]> = {
  researcher: ['claim', 'response', 'evidence', 'report'],
  reviewer: ['review', 'evidence'],
};

export interface GuardInput {
  study: string;
  role: Role;
  round: number;
  before: Record<string, string>;
  after: Record<string, string>;
  read: (path: string) => string | null;
  fetchLog: FetchLogEntry[];
}

export function guardStudy(input: GuardInput): Finding[] {
  const { study, role, round, before, after, read, fetchLog } = input;
  const prefix = `research/${study}/`;
  const findings: Finding[] = [];
  const add = (file: string, message: string) => findings.push({ rule: 'G001', file, message });

  for (const [path, hash] of Object.entries(before)) {
    if (!(path in after)) add(path, 'An existing research record was deleted.');
    else if (after[path] !== hash) add(path, 'An existing research record was modified.');
  }

  const added = Object.keys(after).filter((p) => !(p in before));
  for (const path of added) {
    if (!path.startsWith(prefix)) {
      add(path, `Only files in ${prefix} may be added.`);
      continue;
    }
    const file = classifyResearchPath(path);
    if (!file) continue; // R002 reports it below
    if (!ROLE_KINDS[role].includes(file.kind)) {
      add(path, `The ${role} may not add ${file.kind} records.`);
      continue;
    }
    if (file.kind === 'report') continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(read(path) ?? '') as Record<string, unknown>;
    } catch {
      continue; // R002 reports it below
    }
    if (file.kind === 'evidence' && record.author !== role) add(path, `Evidence added by the ${role} must have author "${role}".`);
    if ((file.kind === 'claim' || file.kind === 'review') && record.round !== round) add(path, `New ${file.kind}s in this run belong to round ${round}.`);
    if (file.kind === 'evidence') {
      const source = (record.source ?? {}) as Record<string, unknown>;
      if (source.type === 'url') {
        const ref = String(source.ref);
        const fetched = fetchLog.some((e) => (e.url === ref || e.finalUrl === ref) && e.sha256 === record.sha256);
        if (!fetched) add(path, `No retrieval of ${ref} with this sha256 in this run. Fetch it with research-fetch.ts and copy its fields.`);
      }
    }
  }

  const studyFiles = Object.keys(after).filter((p) => p.startsWith(prefix));
  findings.push(...checkResearch(studyFiles, read));
  return findings;
}
