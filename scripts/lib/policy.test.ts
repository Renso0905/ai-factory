import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkBoundariesInText, parseBoundaries } from './boundaries.ts';
import { runPolicy } from './policy.ts';
import { checkSecretFileName, checkSecretsInText } from './secrets.ts';
import { callsFactoryCi, checkWorkflowText } from './workflows.ts';

const FACTORY = 'Renso0905/ai-factory';
const SHA = 'a'.repeat(40);
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'policy-check.ts');

const rules = (findings: Array<{ rule: string }>) => findings.map((f) => f.rule).sort();

const GOOD_WORKFLOW = `name: CI
on:
  pull_request:
permissions:
  contents: read
jobs:
  factory:
    uses: ${FACTORY}/.github/workflows/project-ci.yml@v1
`;

/** Builds a throwaway repository on disk; returns its path. */
function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'factory-policy-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const GOOD_PROJECT: Record<string, string> = {
  'docs/REQUIREMENTS.md': '# Requirements\n',
  'docs/ARCHITECTURE.md': '# Architecture\n',
  'package-lock.json': '{}\n',
  '.github/CODEOWNERS': '* @owner\n',
  '.github/workflows/ci.yml': GOOD_WORKFLOW,
  'factory.config.json': JSON.stringify({ boundaries: [{ from: 'src/lib', forbid: ['react'] }] }),
  'src/lib/math.ts': 'export const add = (a: number, b: number) => a + b;\n',
  'src/App.tsx': "import React from 'react';\nexport const App = () => null;\n",
};

// --- workflows -------------------------------------------------------------

test('workflow: SHA-pinned actions and factory tags pass', () => {
  const text = `${GOOD_WORKFLOW}  other:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${SHA} # v7\n      - uses: ./local-action\n`;
  assert.deepEqual(checkWorkflowText('ci.yml', text, FACTORY), []);
});

test('workflow: tag-pinned third-party action is rejected (W001)', () => {
  const text = `${GOOD_WORKFLOW}      - uses: actions/checkout@v7\n`;
  const findings = checkWorkflowText('ci.yml', text, FACTORY);
  assert.deepEqual(rules(findings), ['W001']);
  assert.equal(findings[0].line, 9);
});

test('workflow: factory workflow on a branch ref is rejected (W001)', () => {
  const text = GOOD_WORKFLOW.replace('@v1', '@main');
  assert.deepEqual(rules(checkWorkflowText('ci.yml', text, FACTORY)), ['W001']);
});

test('workflow: another repo cannot borrow the factory tag exception', () => {
  const text = `${GOOD_WORKFLOW}      - uses: someone/ai-factory/.github/workflows/project-ci.yml@v1\n`;
  assert.deepEqual(rules(checkWorkflowText('ci.yml', text, FACTORY)), ['W001']);
});

test('workflow: unpinned docker action is rejected, digest passes', () => {
  const bad = `${GOOD_WORKFLOW}      - uses: docker://alpine:3\n`;
  const good = `${GOOD_WORKFLOW}      - uses: docker://alpine@sha256:${'b'.repeat(64)}\n`;
  assert.deepEqual(rules(checkWorkflowText('ci.yml', bad, FACTORY)), ['W001']);
  assert.deepEqual(checkWorkflowText('ci.yml', good, FACTORY), []);
});

test('workflow: pull_request_target is rejected (W002)', () => {
  const text = GOOD_WORKFLOW.replace('pull_request:', 'pull_request_target:');
  assert.deepEqual(rules(checkWorkflowText('ci.yml', text, FACTORY)), ['W002']);
});

test('workflow: missing top-level permissions is rejected (W003)', () => {
  const text = GOOD_WORKFLOW.replace('permissions:\n  contents: read\n', '');
  assert.deepEqual(rules(checkWorkflowText('ci.yml', text, FACTORY)), ['W003']);
});

test('workflow: write-all is rejected (W004)', () => {
  const text = GOOD_WORKFLOW.replace('permissions:\n  contents: read', 'permissions: write-all');
  assert.deepEqual(rules(checkWorkflowText('ci.yml', text, FACTORY)), ['W004']);
});

test('workflow: commented-out lines are ignored', () => {
  const text = `${GOOD_WORKFLOW}      # - uses: actions/checkout@v7\n      # pull_request_target\n`;
  assert.deepEqual(checkWorkflowText('ci.yml', text, FACTORY), []);
});

test('workflow: callsFactoryCi detects the shared workflow only when really used', () => {
  assert.equal(callsFactoryCi(GOOD_WORKFLOW, FACTORY), true);
  assert.equal(callsFactoryCi(GOOD_WORKFLOW.replace('    uses:', '    # uses:'), FACTORY), false);
  assert.equal(callsFactoryCi(GOOD_WORKFLOW.replace('project-ci.yml', 'other.yml'), FACTORY), false);
});

// --- secrets ---------------------------------------------------------------
// Fake credentials are assembled at runtime so this file never contains one.

test('secrets: token-shaped strings are flagged without echoing the value (S001)', () => {
  const fakes = [
    'gh' + 'p_' + 'A'.repeat(36),
    'github' + '_pat_' + 'B'.repeat(60),
    'sk-' + 'ant-' + 'c'.repeat(30),
    'AK' + 'IA' + 'D'.repeat(16),
    '-----BEGIN RSA ' + 'PRIVATE KEY-----',
  ];
  for (const fake of fakes) {
    const findings = checkSecretsInText('config.ts', `const x = "${fake}";`);
    assert.deepEqual(rules(findings), ['S001'], fake.slice(0, 6));
    assert.ok(!findings[0].message.includes(fake));
  }
});

test('secrets: ordinary text is not flagged', () => {
  assert.deepEqual(checkSecretsInText('a.md', 'Store tokens in GitHub secrets, e.g. secrets.GITHUB_TOKEN.'), []);
});

test('secrets: credential file names are flagged, .env.example is allowed (S002)', () => {
  assert.deepEqual(rules(checkSecretFileName('.env')), ['S002']);
  assert.deepEqual(rules(checkSecretFileName('config/.env.production')), ['S002']);
  assert.deepEqual(rules(checkSecretFileName('certs/server.pem')), ['S002']);
  assert.deepEqual(checkSecretFileName('.env.example'), []);
  assert.deepEqual(checkSecretFileName('src/environment.ts'), []);
});

// --- boundaries ------------------------------------------------------------

test('boundaries: forbidden import inside the layer is flagged (A001)', () => {
  const b = parseBoundaries(JSON.stringify({ boundaries: [{ from: 'src/lib/', forbid: ['react'] }] }));
  assert.deepEqual(rules(checkBoundariesInText('src/lib/x.ts', "import { useState } from 'react';", b)), ['A001']);
  assert.deepEqual(rules(checkBoundariesInText('src/lib/x.ts', "const r = await import('react/jsx-runtime');", b)), ['A001']);
});

test('boundaries: other layers and similarly named packages are untouched', () => {
  const b = parseBoundaries(JSON.stringify({ boundaries: [{ from: 'src/lib', forbid: ['react'] }] }));
  assert.deepEqual(checkBoundariesInText('src/App.tsx', "import React from 'react';", b), []);
  assert.deepEqual(checkBoundariesInText('src/lib/x.ts', "import x from 'react-dom';", b), []);
  assert.deepEqual(checkBoundariesInText('src/library/x.ts', "import React from 'react';", b), []);
});

test('boundaries: malformed config throws instead of silently disabling rules', () => {
  assert.throws(() => parseBoundaries('{"boundaries": "nope"}'));
  assert.throws(() => parseBoundaries('{"boundaries": [{"from": "src"}]}'));
  assert.throws(() => parseBoundaries('not json'));
  assert.deepEqual(parseBoundaries('{}'), []);
});

// --- whole-repository policy ----------------------------------------------

test('policy: a well-formed project passes', (t) => {
  const repo = makeRepo(GOOD_PROJECT);
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  assert.deepEqual(runPolicy({ target: repo, mode: 'project', factoryRepo: FACTORY }), []);
});

test('policy: missing required files are reported (P001)', (t) => {
  const { 'docs/REQUIREMENTS.md': _r, 'package-lock.json': _l, ...rest } = GOOD_PROJECT;
  const repo = makeRepo(rest);
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const findings = runPolicy({ target: repo, mode: 'project', factoryRepo: FACTORY });
  assert.deepEqual(rules(findings), ['P001', 'P001']);
});

test('policy: a project that stops calling the factory CI fails (P002)', (t) => {
  const repo = makeRepo({
    ...GOOD_PROJECT,
    '.github/workflows/ci.yml': 'name: CI\non: push\npermissions:\n  contents: read\njobs: {}\n',
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  assert.deepEqual(rules(runPolicy({ target: repo, mode: 'project', factoryRepo: FACTORY })), ['P002']);
});

test('policy: architecture violation and invalid config are reported (A001, A002)', (t) => {
  const violating = makeRepo({ ...GOOD_PROJECT, 'src/lib/bad.ts': "import React from 'react';\n" });
  const invalid = makeRepo({ ...GOOD_PROJECT, 'factory.config.json': '{ broken' });
  t.after(() => {
    rmSync(violating, { recursive: true, force: true });
    rmSync(invalid, { recursive: true, force: true });
  });
  assert.deepEqual(rules(runPolicy({ target: violating, mode: 'project', factoryRepo: FACTORY })), ['A001']);
  assert.deepEqual(rules(runPolicy({ target: invalid, mode: 'project', factoryRepo: FACTORY })), ['A002']);
});

test('policy: node_modules is not scanned', (t) => {
  const repo = makeRepo({ ...GOOD_PROJECT, 'node_modules/pkg/.env': 'X=1\n' });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  assert.deepEqual(runPolicy({ target: repo, mode: 'project', factoryRepo: FACTORY }), []);
});

test('policy: factory mode skips project-only rules but still checks workflows', (t) => {
  const repo = makeRepo({ '.github/workflows/ci.yml': 'name: CI\non: push\njobs: {}\n' });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  assert.deepEqual(rules(runPolicy({ target: repo, mode: 'factory', factoryRepo: FACTORY })), ['W003']);
});

// --- CLI -------------------------------------------------------------------

test('cli: exits 0 on a clean project and 1 with findings', (t) => {
  const good = makeRepo(GOOD_PROJECT);
  const bad = makeRepo({ ...GOOD_PROJECT, '.env': 'TOKEN=x\n' });
  t.after(() => {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  });
  const env = { ...process.env, GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '' };
  const run = (target: string) => spawnSync(process.execPath, [CLI, '--target', target, '--mode', 'project'], { encoding: 'utf8', env });

  const ok = run(good);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /passed, 0 findings/);

  const fail = run(bad);
  assert.equal(fail.status, 1, fail.stdout + fail.stderr);
  assert.match(fail.stdout, /S002 \.env/);
});

test('cli: unknown mode exits 2', () => {
  const res = spawnSync(process.execPath, [CLI, '--mode', 'nonsense'], { encoding: 'utf8' });
  assert.equal(res.status, 2);
});
