import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkUrl, fetchSource, htmlToText, parseFetchLog, readableText, sha256Hex } from './fetch-source.ts';
import { guardStudy, manifest } from './guard.ts';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const rules = (findings: Array<{ rule: string }>) => findings.map((f) => f.rule).sort();

// --- fetch -----------------------------------------------------------------

test('fetch: html becomes readable text', () => {
  const html = '<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Weekly&nbsp;stats</h1><p>Avg &amp; trend &#8212; &#x2713;</p><!-- hidden --></body></html>';
  assert.equal(htmlToText(html), 'Weekly stats\nAvg & trend — ✓');
});

test('fetch: binary content is described, long text truncated', () => {
  assert.match(readableText({ contentType: 'image/png', bytes: Buffer.from([1, 2]) }), /image\/png content, 2 bytes/);
  assert.match(readableText({ contentType: 'text/plain', bytes: Buffer.from('x'.repeat(50_000)) }), /truncated at/);
});

test('fetch: only public http(s) urls are allowed', () => {
  assert.equal(checkUrl('https://example.com/a').hostname, 'example.com');
  assert.equal(checkUrl('https://fcbarcelona.com/').hostname, 'fcbarcelona.com');
  for (const bad of ['file:///etc/passwd', 'http://localhost:3000', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://intranet/', 'https://user:pw@example.com/', 'not a url']) {
    assert.throws(() => checkUrl(bad), Error, bad);
  }
  assert.equal(checkUrl('http://127.0.0.1:8080/', true).port, '8080');
});

async function withServer(t: { after: (fn: () => void) => void }, body: string, type = 'text/html'): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/page`;
}

test('fetch: retrieves a page and hashes exactly its bytes', async (t) => {
  const body = '<p>Hello</p>';
  const url = await withServer(t, body);
  const source = await fetchSource(url, { allowLocal: true, now: () => new Date('2026-11-13T00:00:00Z') });
  assert.equal(source.status, 200);
  assert.equal(source.sha256, sha256Hex(Buffer.from(body)));
  assert.equal(source.retrievedAt, '2026-11-13T00:00:00.000Z');
  await assert.rejects(fetchSource(url), /private/);
});

test('fetch: the CLI saves the snapshot and logs the retrieval', async (t) => {
  const url = await withServer(t, '<p>Weekly averages skip empty days.</p>');
  const dir = mkdtempSync(join(tmpdir(), 'factory-fetch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const res = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
    // spawnSync would block the server in this process, so run the CLI asynchronously.
    import('node:child_process').then(({ execFile }) =>
      execFile(process.execPath, [join(SCRIPTS, 'research-fetch.ts'), url], { env: { ...process.env, RESEARCH_SNAPSHOTS: dir, RESEARCH_ALLOW_LOCAL: '1' } }, (err, stdout) =>
        resolve({ status: err ? (err as { code?: number }).code ?? 1 : 0, stdout }),
      ),
    );
  });
  assert.equal(res.status, 0, res.stdout);
  const out = JSON.parse(res.stdout) as { evidenceFields: { sha256: string; source: { ref: string } }; text: string };
  assert.equal(out.text, 'Weekly averages skip empty days.');
  const log = parseFetchLog(readFileSync(join(dir, 'index.jsonl'), 'utf8'));
  assert.equal(log.length, 1);
  assert.equal(log[0].sha256, out.evidenceFields.sha256);
  assert.equal(readFileSync(join(dir, `${out.evidenceFields.sha256}.bin`), 'utf8'), '<p>Weekly averages skip empty days.</p>');
});

// --- guard -----------------------------------------------------------------

const STUDY = 'r22-weekly-averages';
const S = `research/${STUDY}`;
const HASH = 'c'.repeat(64);
const URL_A = 'https://example.com/help';
const contract = {
  kind: 'contract', version: 1, mode: 'focused', stage: 'after', project: 'gym-app', feature: 'Weekly averages',
  requirements: ['R22'], objective: 'Compare weekly averages.', dimensions: ['averaging'], competitorRules: 'Popular apps.',
  include: ['weekly averages'], exclude: [], deliverables: ['report'], maxCompetitors: 3, maxReviewRounds: 2,
  approvedBy: 'manager', approvedAt: '2026-11-13T00:00:00Z',
};
const evidence = (id: string, author: string, ref = URL_A, sha256 = HASH) => ({
  kind: 'evidence', id, author, source: { type: 'url', ref }, retrievedAt: '2026-11-13T01:00:00Z', sha256,
  observation: 'Says empty days are skipped.', limitations: 'Docs only.',
});
const claim = (round = 1) => ({
  kind: 'claim', id: 'C-001', version: round, author: 'researcher', round, claim: 'X skips empty days.', subject: 'X',
  basis: 'documented', evidence: ['E-001'], limitations: 'Docs only.',
});
const review = (round = 1) => ({
  kind: 'review', id: `R-00${round}`, author: 'reviewer', round, target: { claim: 'C-001', version: 1 },
  disposition: 'established', comment: 'Checked the page myself.', evidence: ['E-002'],
});
const log = [{ url: URL_A, finalUrl: URL_A, sha256: HASH, retrievedAt: '2026-11-13T01:00:00Z', status: 200 }];

function run(beforeFiles: Record<string, unknown>, afterFiles: Record<string, unknown>, role: 'researcher' | 'reviewer', round = 1, fetchLog = log) {
  const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  const hashes = (files: Record<string, unknown>) => Object.fromEntries(Object.entries(files).map(([p, v]) => [p, sha256Hex(Buffer.from(text(v)))]));
  return guardStudy({
    study: STUDY, role, round, before: hashes(beforeFiles), after: hashes(afterFiles),
    read: (p) => (p in afterFiles ? text(afterFiles[p]) : null), fetchLog,
  });
}

const start = { [`${S}/contract.v1.json`]: contract };
const researched = { ...start, [`${S}/evidence/E-001.json`]: evidence('E-001', 'researcher'), [`${S}/claims/C-001.v1.json`]: claim() };

test('guard: the researcher may add claims and its own fetched evidence', () => {
  assert.deepEqual(run(start, researched, 'researcher'), []);
});

test('guard: the reviewer may add reviews and its own evidence', () => {
  const after = { ...researched, [`${S}/evidence/E-002.json`]: evidence('E-002', 'reviewer'), [`${S}/reviews/R-001.json`]: review() };
  assert.deepEqual(run(researched, after, 'reviewer'), []);
});

test('guard: each role is limited to its own record types (G001)', () => {
  const reviewerClaims = { ...researched, [`${S}/claims/C-002.v1.json`]: { ...claim(), id: 'C-002' } };
  assert.ok(rules(run(researched, reviewerClaims, 'reviewer')).includes('G001'));
  const researcherReviews = { ...researched, [`${S}/evidence/E-002.json`]: evidence('E-002', 'reviewer'), [`${S}/reviews/R-001.json`]: review() };
  assert.deepEqual(rules(run(researched, researcherReviews, 'researcher')), ['G001', 'G001']);
});

test('guard: existing records may not change or disappear (G001)', () => {
  const edited = { ...researched, [`${S}/claims/C-001.v1.json`]: { ...claim(), claim: 'Rewritten.' } };
  assert.deepEqual(rules(run(researched, edited, 'reviewer')), ['G001']);
  const { [`${S}/evidence/E-001.json`]: _gone, ...deleted } = researched;
  assert.ok(rules(run(researched, deleted, 'researcher')).includes('G001'));
});

test('guard: url evidence must match a real retrieval in this run (G001)', () => {
  assert.deepEqual(rules(run(start, researched, 'researcher', 1, [])), ['G001']);
  const madeUp = { ...researched, [`${S}/evidence/E-001.json`]: evidence('E-001', 'researcher', URL_A, 'd'.repeat(64)) };
  assert.deepEqual(rules(run(start, madeUp, 'researcher')), ['G001']);
});

test('guard: new records must belong to the round being run (G001)', () => {
  assert.deepEqual(rules(run(start, researched, 'researcher', 2)), ['G001']);
});

test('guard: files outside the study and schema errors are caught', () => {
  assert.deepEqual(rules(run(start, { ...researched, 'research/other-study/contract.v1.json': contract }, 'researcher')), ['G001']);
  assert.deepEqual(rules(run(start, { ...researched, [`${S}/notes.txt`]: 'x' }, 'researcher')), ['R002']);
});

test('guard: the CLI snapshots a study and checks a run end to end', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'factory-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (rel: string, v: unknown) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), JSON.stringify(v));
  };
  write(`${S}/contract.v1.json`, contract);
  const snaps = join(root, 'snaps');
  mkdirSync(snaps);
  writeFileSync(join(snaps, 'index.jsonl'), `${JSON.stringify(log[0])}\n`);
  const env = { ...process.env, RESEARCH_PROJECT: root, RESEARCH_STUDY: STUDY, RESEARCH_ROLE: 'researcher', RESEARCH_ROUND: '1', RESEARCH_MANIFEST: join(root, 'manifest.json'), RESEARCH_SNAPSHOTS: snaps };
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(SCRIPTS, 'research-guard.ts'), ...args], { encoding: 'utf8', env });

  assert.equal(cli('--snapshot').status, 0);
  assert.deepEqual(Object.keys(manifest(root, S)), [`${S}/contract.v1.json`]);
  write(`${S}/evidence/E-001.json`, evidence('E-001', 'researcher'));
  write(`${S}/claims/C-001.v1.json`, claim());
  const ok = cli();
  assert.equal(ok.status, 0, ok.stdout);

  write(`${S}/contract.v1.json`, { ...contract, maxCompetitors: 50 });
  const bad = cli();
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /G001 .*contract\.v1\.json An existing research record was modified/);
});
