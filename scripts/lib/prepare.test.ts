import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { prepareStudy } from './prepare.ts';

const STUDY = 'r22-weekly-averages';

function setup(t: { after: (fn: () => void) => void }, project: Record<string, string>, saved?: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'factory-prepare-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (base: string, files: Record<string, string>) => {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(base, rel)), { recursive: true });
      writeFileSync(join(base, rel), text);
    }
  };
  write(join(root, 'project', 'research', STUDY), project);
  if (saved) write(join(root, 'resume'), saved);
  return { project: join(root, 'project'), resumeDir: join(root, 'resume') };
}

const contract = (rounds: number) => JSON.stringify({ kind: 'contract', version: 1, maxReviewRounds: rounds });
const base = { 'contract.v1.json': contract(2) };
const saved = { ...base, 'claims/C-001.v1.json': '{}', 'evidence/E-001.json': '{}' };

test('prepare: a new study starts at step 1 with the contract\'s rounds', (t) => {
  const p = setup(t, base);
  assert.deepEqual(prepareStudy({ ...p, study: STUDY, resumeRun: '', resumeAt: '' }), { rounds: 2, start: 1, contractVersion: 1 });
});

test('prepare: bad study ids and half-given resume options are refused', (t) => {
  const p = setup(t, base);
  assert.throws(() => prepareStudy({ ...p, study: `${STUDY}.`, resumeRun: '', resumeAt: '' }), /Invalid study id/);
  assert.throws(() => prepareStudy({ ...p, study: STUDY, resumeRun: '123', resumeAt: '' }), /both/);
  assert.throws(() => prepareStudy({ ...p, study: STUDY, resumeRun: '123', resumeAt: 'research' }), /resume-at must be/);
  assert.throws(() => prepareStudy({ ...p, study: STUDY, resumeRun: 'abc', resumeAt: 'report' }), /run id/);
});

test('prepare: a new run refuses a study that already has claims', (t) => {
  const p = setup(t, saved);
  assert.throws(() => prepareStudy({ ...p, study: STUDY, resumeRun: '', resumeAt: '' }), /already has claims/);
});

test('prepare: resuming replaces the study with the saved one and starts at the chosen step', (t) => {
  const p = setup(t, base, saved);
  assert.deepEqual(prepareStudy({ ...p, study: STUDY, resumeRun: '123', resumeAt: 'review-1' }), { rounds: 2, start: 2, contractVersion: 1 });
  assert.equal(readFileSync(join(p.project, 'research', STUDY, 'claims', 'C-001.v1.json'), 'utf8'), '{}');
});

test('prepare: a saved study that lost or changed a merged record is refused', (t) => {
  const changed = setup(t, base, { ...saved, 'contract.v1.json': contract(3) });
  assert.throws(() => prepareStudy({ ...changed, study: STUDY, resumeRun: '1', resumeAt: 'report' }), /does not contain/);
  const { 'contract.v1.json': _c, ...missing } = saved;
  const lost = setup(t, base, missing);
  assert.throws(() => prepareStudy({ ...lost, study: STUDY, resumeRun: '1', resumeAt: 'report' }), /does not contain/);
});

test('prepare: round-2 steps cannot be resumed under a one-round contract', (t) => {
  const one = { 'contract.v1.json': contract(1) };
  const p = setup(t, one, { ...saved, 'contract.v1.json': contract(1) });
  assert.throws(() => prepareStudy({ ...p, study: STUDY, resumeRun: '1', resumeAt: 'respond' }), /one review round/);
});

test('prepare: resuming a run that never produced claims is refused', (t) => {
  const p = setup(t, base, base);
  assert.throws(() => prepareStudy({ ...p, study: STUDY, resumeRun: '1', resumeAt: 'review-1' }), /no claims yet/);
});
