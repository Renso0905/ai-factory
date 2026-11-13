// Research guard CLI.
//   --snapshot   record the study's files before an agent runs (writes RESEARCH_MANIFEST)
//   (default)    check what the agent added since the snapshot; exit 1 on any finding
// Settings come from the environment so an agent can run the check itself with
// no arguments: RESEARCH_PROJECT, RESEARCH_STUDY, RESEARCH_ROLE, RESEARCH_ROUND,
// RESEARCH_MANIFEST, RESEARCH_SNAPSHOTS (fetch log directory).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFetchLog } from './lib/fetch-source.ts';
import { guardStudy, manifest, type Role } from './lib/guard.ts';

const env = process.env;
const project = env.RESEARCH_PROJECT ?? '.';
const study = env.RESEARCH_STUDY ?? '';
const manifestPath = env.RESEARCH_MANIFEST ?? '';
if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(study) || !manifestPath) {
  console.error('RESEARCH_STUDY (a study id) and RESEARCH_MANIFEST are required.');
  process.exit(2);
}
const dir = `research/${study}`;

if (process.argv.includes('--snapshot')) {
  const files = manifest(project, dir);
  writeFileSync(manifestPath, JSON.stringify(files, null, 2));
  console.log(`Recorded ${Object.keys(files).length} existing files in ${dir}.`);
  process.exit(0);
}

const role = env.RESEARCH_ROLE as Role;
const round = Number(env.RESEARCH_ROUND);
if ((role !== 'researcher' && role !== 'reviewer') || !Number.isInteger(round) || round < 1) {
  console.error('RESEARCH_ROLE (researcher|reviewer) and RESEARCH_ROUND (1 or more) are required.');
  process.exit(2);
}

let fetchLog: ReturnType<typeof parseFetchLog> = [];
try {
  fetchLog = parseFetchLog(readFileSync(join(env.RESEARCH_SNAPSHOTS ?? '', 'index.jsonl'), 'utf8'));
} catch {
  // nothing fetched in this run
}

const findings = guardStudy({
  study,
  role,
  round,
  before: JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>,
  after: manifest(project, dir),
  read: (p) => {
    try {
      return readFileSync(join(project, p), 'utf8');
    } catch {
      return null;
    }
  },
  fetchLog,
});

for (const f of findings) console.log(`${f.rule} ${f.file ?? ''} ${f.message}`);
console.log(findings.length === 0 ? `Research guard (${role}, round ${round}): passed.` : `Research guard (${role}, round ${round}): FAILED, ${findings.length} finding(s).`);
process.exit(findings.length === 0 ? 0 : 1);
