import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checkAppendOnlyInGit } from './append-only.ts';
import { runPolicy } from './policy.ts';
import { checkAppendOnly, checkResearch, classifyResearchPath, MAX_EXCERPT, parseNameStatus } from './research.ts';
import { checkSecretsInText } from './secrets.ts';

const S = 'research/r22-weekly-averages';
const HASH = 'b'.repeat(64);
const rules = (findings: Array<{ rule: string }>) => findings.map((f) => f.rule).sort();

const contract = {
  kind: 'contract',
  version: 1,
  mode: 'focused',
  stage: 'after',
  project: 'gym-app',
  feature: 'Home weekly sleep and calorie averages (R22)',
  requirements: ['R22'],
  objective: 'Compare how workout and health apps show weekly averages and week-over-week change.',
  dimensions: ['averaging rule', 'week boundaries', 'change display'],
  competitorRules: 'Widely used fitness or health apps that show weekly sleep or calorie averages.',
  include: ['weekly averages', 'week-over-week change'],
  exclude: ['meal planning', 'social features'],
  deliverables: ['claims', 'management report'],
  maxCompetitors: 5,
  maxReviewRounds: 2,
  approvedBy: 'manager',
  approvedAt: '2026-11-13T12:00:00Z',
};
const evidence = (id: string, author = 'researcher') => ({
  kind: 'evidence',
  id,
  author,
  source: { type: 'url', ref: 'https://example.com/help/weekly-averages' },
  retrievedAt: '2026-11-13T12:30:00Z',
  sha256: HASH,
  excerpt: 'Weekly averages include only days with data.',
  observation: 'The help page says untracked days are excluded from the average.',
  limitations: 'Documentation only; behaviour not observed in the app.',
});
const claim = (id: string, version: number, extra: Record<string, unknown> = {}) => ({
  kind: 'claim',
  id,
  version,
  author: 'researcher',
  round: 1,
  claim: 'Competitor X excludes untracked days from weekly averages.',
  subject: 'Competitor X',
  basis: 'documented',
  evidence: ['E-001'],
  limitations: 'Documented, not observed.',
  ...extra,
});
const review = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: 'review',
  id,
  author: 'reviewer',
  round: 1,
  target: { claim: 'C-001', version: 1 },
  disposition: 'established',
  comment: 'The help page I fetched independently says the same.',
  evidence: ['E-002'],
  ...extra,
});

/** A valid study as path -> JSON text, with overrides (null removes a file). */
function study(over: Record<string, unknown | null> = {}): Record<string, string> {
  const base: Record<string, unknown> = {
    [`${S}/contract.v1.json`]: contract,
    [`${S}/evidence/E-001.json`]: evidence('E-001'),
    [`${S}/evidence/E-002.json`]: evidence('E-002', 'reviewer'),
    [`${S}/claims/C-001.v1.json`]: claim('C-001', 1),
    [`${S}/reviews/R-001.json`]: review('R-001'),
  };
  const out: Record<string, string> = {};
  for (const [path, value] of Object.entries({ ...base, ...over })) {
    if (value !== null) out[path] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}
const check = (files: Record<string, string>) => checkResearch(Object.keys(files), (p) => files[p] ?? null);

// --- paths -----------------------------------------------------------------

test('research: record paths are classified', () => {
  assert.deepEqual(classifyResearchPath(`${S}/claims/C-001.v2.json`), { kind: 'claim', study: 'r22-weekly-averages', id: 'C-001', version: 2 });
  assert.deepEqual(classifyResearchPath(`${S}/report.v1.md`), { kind: 'report', study: 'r22-weekly-averages', id: 'v1', version: 1 });
  assert.equal(classifyResearchPath(`${S}/claims/C-001.json`), null);
  assert.equal(classifyResearchPath(`${S}/notes.txt`), null);
});

// --- R002 schema -----------------------------------------------------------

test('research: a valid study passes', () => {
  assert.deepEqual(check(study({ [`${S}/report.v1.md`]: '# Report\n' })), []);
});

test('research: unrecognised files and non-JSON records fail (R002)', () => {
  assert.deepEqual(rules(check(study({ [`${S}/scratch.md`]: 'x' }))), ['R002']);
  assert.deepEqual(rules(check(study({ [`${S}/evidence/E-001.json`]: '[1]' }))), ['R002', 'R003']);
});

test('research: a claim may not grade itself (R002)', () => {
  const findings = check(study({ [`${S}/claims/C-001.v1.json`]: claim('C-001', 1, { status: 'established' }) }));
  assert.deepEqual(rules(findings), ['R002']);
  assert.match(findings[0].message, /only the reviewer/);
});

test('research: a factual claim needs evidence; an interpretation may have none (R002)', () => {
  assert.deepEqual(rules(check(study({ [`${S}/claims/C-001.v1.json`]: claim('C-001', 1, { evidence: [] }) }))), ['R002']);
  assert.deepEqual(check(study({ [`${S}/claims/C-001.v1.json`]: claim('C-001', 1, { evidence: [], basis: 'interpretation' }) })), []);
});

test('research: ids, versions, authors and excerpts are checked (R002)', () => {
  assert.deepEqual(rules(check(study({ [`${S}/claims/C-001.v1.json`]: claim('C-002', 1) }))), ['R002']);
  assert.deepEqual(rules(check(study({ [`${S}/claims/C-001.v1.json`]: claim('C-001', 1, { author: 'reviewer' }) }))), ['R002']);
  assert.deepEqual(rules(check(study({ [`${S}/reviews/R-001.json`]: review('R-001', { author: 'researcher' }) }))), ['R002']);
  const long = { ...evidence('E-001'), excerpt: 'x'.repeat(MAX_EXCERPT + 1) };
  assert.deepEqual(rules(check(study({ [`${S}/evidence/E-001.json`]: long }))), ['R002']);
  assert.deepEqual(rules(check(study({ [`${S}/evidence/E-001.json`]: { ...evidence('E-001'), sha256: 'abc' } }))), ['R002']);
  assert.deepEqual(rules(check(study({ [`${S}/contract.v1.json`]: { ...contract, include: [] } }))), ['R002']);
});

// --- R003 cross-references -------------------------------------------------

test('research: a study without a contract fails (R003)', () => {
  assert.deepEqual(rules(check(study({ [`${S}/contract.v1.json`]: null }))), ['R003']);
});

test('research: established needs the reviewer\'s own evidence (R003)', () => {
  const findings = check(study({ [`${S}/reviews/R-001.json`]: review('R-001', { evidence: ['E-001'] }) }));
  assert.deepEqual(rules(findings), ['R003']);
  assert.match(findings[0].message, /Agreement is not verification/);
  assert.deepEqual(check(study({ [`${S}/reviews/R-001.json`]: review('R-001', { disposition: 'unknown', evidence: [] }) })), []);
});

test('research: dangling references and skipped versions fail (R003)', () => {
  assert.deepEqual(rules(check(study({ [`${S}/claims/C-001.v1.json`]: claim('C-001', 1, { evidence: ['E-009'] }) }))), ['R003']);
  assert.deepEqual(rules(check(study({ [`${S}/reviews/R-001.json`]: review('R-001', { target: { claim: 'C-001', version: 3 } }) }))), ['R003']);
  assert.deepEqual(rules(check(study({ [`${S}/claims/C-001.v3.json`]: claim('C-001', 3) }))), ['R003']);
});

test('research: review rounds beyond the contract limit fail (R003)', () => {
  assert.deepEqual(rules(check(study({ [`${S}/reviews/R-001.json`]: review('R-001', { round: 3 }) }))), ['R003']);
});

test('research: a revised response must point at an existing new version (R003)', () => {
  const response = { kind: 'response', id: 'A-001', author: 'researcher', review: 'R-001', action: 'revised', comment: 'Narrowed the claim.', newVersion: 2 };
  assert.deepEqual(rules(check(study({ [`${S}/responses/A-001.json`]: response }))), ['R003']);
  assert.deepEqual(check(study({ [`${S}/responses/A-001.json`]: response, [`${S}/claims/C-001.v2.json`]: claim('C-001', 2, { round: 2 }) })), []);
});

// --- R001 append-only ------------------------------------------------------

test('append-only: parses git name-status output', () => {
  const raw = ['A', `${S}/claims/C-001.v2.json`, 'M', 'src/a.ts', 'R100', `${S}/x.json`, `${S}/y.json`, 'D', `${S}/evidence/E-001.json`, ''].join('\0');
  assert.deepEqual(parseNameStatus(raw), [
    { status: 'A', path: `${S}/claims/C-001.v2.json` },
    { status: 'M', path: 'src/a.ts' },
    { status: 'R', from: `${S}/x.json`, path: `${S}/y.json` },
    { status: 'D', path: `${S}/evidence/E-001.json` },
  ]);
});

test('append-only: additions pass; changes, deletions and renames of records fail (R001)', () => {
  assert.deepEqual(checkAppendOnly([{ status: 'A', path: `${S}/claims/C-001.v2.json` }, { status: 'M', path: 'src/a.ts' }]), []);
  assert.deepEqual(
    rules(checkAppendOnly([
      { status: 'M', path: `${S}/claims/C-001.v1.json` },
      { status: 'D', path: `${S}/evidence/E-001.json` },
      { status: 'R', from: `${S}/reviews/R-001.json`, path: 'elsewhere/R-001.json' },
    ])),
    ['R001', 'R001', 'R001'],
  );
});

function git(cwd: string, ...args: string[]): string {
  const res = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim();
}

test('append-only: compares a real git checkout with its base (R001)', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'factory-research-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  git(root, 'init', '-q');
  for (const [rel, text] of Object.entries(study())) write(rel, text);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'study');
  const base = git(root, 'rev-parse', 'HEAD');

  write(`${S}/claims/C-001.v2.json`, JSON.stringify(claim('C-001', 2, { round: 2 })));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'append');
  assert.deepEqual(checkAppendOnlyInGit(root, base), []);

  write(`${S}/claims/C-001.v1.json`, JSON.stringify(claim('C-001', 1, { claim: 'Quietly rewritten.' })));
  unlinkSync(join(root, `${S}/reviews/R-001.json`));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'rewrite history');
  assert.deepEqual(rules(checkAppendOnlyInGit(root, base)), ['R001', 'R001']);

  assert.deepEqual(rules(checkAppendOnlyInGit(root, 'f'.repeat(40))), ['R001'], 'an unknown base is a finding, not a skip');
  assert.deepEqual(rules(checkAppendOnlyInGit(root, 'not-a-sha')), ['R001']);
});

test('policy: research rules run in factory mode too', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'factory-research-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, S), { recursive: true });
  writeFileSync(join(root, `${S}/notes.txt`), 'x');
  assert.deepEqual(rules(runPolicy({ target: root, mode: 'factory', factoryRepo: 'Renso0905/ai-factory' })), ['R002']);
});

// --- S001 addition ---------------------------------------------------------

test('secrets: a Google API key is detected (S001)', () => {
  const fake = ['AI', 'za', 'Sy', 'x'.repeat(33)].join('');
  assert.deepEqual(rules(checkSecretsInText('a.ts', `const k = "${fake}";`)), ['S001']);
  assert.deepEqual(checkSecretsInText('a.ts', 'const k = "AIzaShort";'), []);
});
