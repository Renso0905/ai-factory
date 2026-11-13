// Research records: the evidence schema (R002) and cross-references (R003) for
// market-intelligence studies kept under research/<study>/ in a project.
// docs/RESEARCH.md describes the process; this file is the enforceable part.
import type { Finding } from './types.ts';

export const RESEARCH_ROOT = 'research';

/** Longest verbatim excerpt a record may keep from a source. Repositories are public. */
export const MAX_EXCERPT = 300;

type Kind = 'contract' | 'claim' | 'evidence' | 'review' | 'response' | 'report';

const STUDY = '[a-z0-9][a-z0-9-]{2,79}';
const FILE_PATTERNS: Array<{ kind: Kind; re: RegExp }> = [
  { kind: 'contract', re: new RegExp(`^research/(${STUDY})/contract\\.v([1-9]\\d*)\\.json$`) },
  { kind: 'claim', re: new RegExp(`^research/(${STUDY})/claims/(C-\\d{3,})\\.v([1-9]\\d*)\\.json$`) },
  { kind: 'evidence', re: new RegExp(`^research/(${STUDY})/evidence/(E-\\d{3,})\\.json$`) },
  { kind: 'review', re: new RegExp(`^research/(${STUDY})/reviews/(R-\\d{3,})\\.json$`) },
  { kind: 'response', re: new RegExp(`^research/(${STUDY})/responses/(A-\\d{3,})\\.json$`) },
  { kind: 'report', re: new RegExp(`^research/(${STUDY})/report\\.v([1-9]\\d*)\\.md$`) },
];

export interface ResearchFile {
  kind: Kind;
  study: string;
  /** Record id from the file name (C-001, E-002, ...); the version for contracts and reports. */
  id: string;
  /** Version from the file name, for versioned records. */
  version?: number;
}

/** What a research path names, or null when it is not a recognised record path. */
export function classifyResearchPath(path: string): ResearchFile | null {
  for (const { kind, re } of FILE_PATTERNS) {
    const m = re.exec(path);
    if (!m) continue;
    if (kind === 'contract' || kind === 'report') return { kind, study: m[1], id: `v${m[2]}`, version: Number(m[2]) };
    if (kind === 'claim') return { kind, study: m[1], id: m[2], version: Number(m[3]) };
    return { kind, study: m[1], id: m[2] };
  }
  return null;
}

const MODES = ['focused', 'general'];
const STAGES = ['before', 'after'];
const CLAIM_BASIS = ['documented', 'observed', 'measured', 'interpretation'];
const SOURCE_TYPES = ['url', 'document', 'app-test', 'measurement'];
const DISPOSITIONS = ['established', 'contradicted', 'unknown', 'needs-change', 'out-of-scope'];
const ACTIONS = ['revised', 'withdrawn', 'disputed'];
/** Fields that would let a researcher grade its own claim. Only reviews carry a verdict. */
const VERDICT_FIELDS = ['status', 'verdict', 'disposition', 'verified', 'confidence'];

type Json = Record<string, unknown>;

const isText = (v: unknown) => typeof v === 'string' && v.trim() !== '';
const isTextList = (v: unknown, min = 0) => Array.isArray(v) && v.length >= min && v.every(isText);
const isPositiveInt = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
const isTimestamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
const isOneOf = (v: unknown, options: string[]) => typeof v === 'string' && options.includes(v);
const ids = (v: unknown, prefix: string) => Array.isArray(v) && v.every((x) => typeof x === 'string' && new RegExp(`^${prefix}-\\d{3,}$`).test(x));

/** Problems with one record's own content, as messages. Cross-record checks are separate. */
function recordProblems(file: ResearchFile, r: Json): string[] {
  const p: string[] = [];
  const need = (ok: boolean, message: string) => { if (!ok) p.push(message); };

  need(r.kind === file.kind, `"kind" must be "${file.kind}"`);
  if (file.kind !== 'contract' && file.kind !== 'report') need(r.id === file.id, `"id" must match the file name (${file.id})`);

  switch (file.kind) {
    case 'contract':
      need(r.version === file.version, `"version" must match the file name (${file.version})`);
      need(isOneOf(r.mode, MODES), `"mode" must be one of ${MODES.join(', ')}`);
      need(isOneOf(r.stage, STAGES), `"stage" must be one of ${STAGES.join(', ')}`);
      for (const f of ['project', 'feature', 'objective', 'competitorRules', 'approvedBy']) need(isText(r[f]), `"${f}" is required`);
      need(isTimestamp(r.approvedAt), '"approvedAt" must be an ISO timestamp');
      for (const f of ['requirements', 'dimensions', 'include', 'deliverables']) need(isTextList(r[f], 1), `"${f}" must list at least one item`);
      need(isTextList(r.exclude), '"exclude" must be a list of topics');
      need(isPositiveInt(r.maxCompetitors), '"maxCompetitors" must be a positive whole number');
      need(isPositiveInt(r.maxReviewRounds), '"maxReviewRounds" must be a positive whole number');
      break;
    case 'claim':
      need(r.version === file.version, `"version" must match the file name (${file.version})`);
      need(r.author === 'researcher', '"author" must be "researcher"');
      need(isPositiveInt(r.round), '"round" must be a positive whole number');
      need(isText(r.claim), '"claim" is required');
      need(isText(r.subject), '"subject" is required');
      need(isOneOf(r.basis, CLAIM_BASIS), `"basis" must be one of ${CLAIM_BASIS.join(', ')}`);
      need(ids(r.evidence, 'E'), '"evidence" must be a list of evidence ids (E-001)');
      need(r.basis === 'interpretation' || (Array.isArray(r.evidence) && r.evidence.length > 0), 'a claim that is not an interpretation needs evidence');
      need(isText(r.limitations), '"limitations" is required; say what the evidence cannot establish');
      for (const f of VERDICT_FIELDS) need(!(f in r), `"${f}" is not allowed; only the reviewer records a verdict`);
      break;
    case 'evidence': {
      need(isOneOf(r.author, ['researcher', 'reviewer']), '"author" must be "researcher" or "reviewer"');
      const s = (r.source ?? {}) as Json;
      need(isOneOf(s.type, SOURCE_TYPES), `"source.type" must be one of ${SOURCE_TYPES.join(', ')}`);
      need(isText(s.ref), '"source.ref" is required (URL, document name or test description)');
      need(isTimestamp(r.retrievedAt), '"retrievedAt" must be an ISO timestamp');
      need(typeof r.sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.sha256), '"sha256" must be the hex SHA-256 of the retrieved content');
      need(r.excerpt === undefined || (typeof r.excerpt === 'string' && r.excerpt.length <= MAX_EXCERPT), `"excerpt" may be at most ${MAX_EXCERPT} characters`);
      need(isText(r.observation), '"observation" is required; say what the source actually shows');
      need(isText(r.limitations), '"limitations" is required');
      break;
    }
    case 'review': {
      need(r.author === 'reviewer', '"author" must be "reviewer"');
      need(isPositiveInt(r.round), '"round" must be a positive whole number');
      const t = (r.target ?? {}) as Json;
      need(typeof t.claim === 'string' && /^C-\d{3,}$/.test(t.claim) && isPositiveInt(t.version), '"target" must name a claim id and version');
      need(isOneOf(r.disposition, DISPOSITIONS), `"disposition" must be one of ${DISPOSITIONS.join(', ')}`);
      need(isText(r.comment), '"comment" is required');
      need(ids(r.evidence, 'E'), '"evidence" must be a list of evidence ids (E-001)');
      break;
    }
    case 'response':
      need(r.author === 'researcher', '"author" must be "researcher"');
      need(typeof r.review === 'string' && /^R-\d{3,}$/.test(r.review), '"review" must name a review id');
      need(isOneOf(r.action, ACTIONS), `"action" must be one of ${ACTIONS.join(', ')}`);
      need(isText(r.comment), '"comment" is required');
      need(r.action !== 'revised' || isPositiveInt(r.newVersion), 'a revised response needs "newVersion"');
      break;
  }
  return p;
}

interface Loaded {
  path: string;
  file: ResearchFile;
  record: Json | null;
}

/**
 * R002 and R003 over every file under research/. `read` returns a file's text.
 * R002: a file is a recognised record with valid content. R003: references
 * between records in one study resolve and follow the review rules.
 */
export function checkResearch(paths: string[], read: (path: string) => string | null): Finding[] {
  const findings: Finding[] = [];
  const studies = new Map<string, Loaded[]>();

  for (const path of paths.filter((p) => p.startsWith(`${RESEARCH_ROOT}/`))) {
    const file = classifyResearchPath(path);
    if (!file) {
      findings.push({ rule: 'R002', file: path, message: 'Not a recognised research record path (see docs/RESEARCH.md).' });
      continue;
    }
    let record: Json | null = null;
    if (file.kind !== 'report') {
      const text = read(path);
      try {
        const parsed: unknown = JSON.parse(text ?? '');
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        record = parsed as Json;
      } catch {
        findings.push({ rule: 'R002', file: path, message: 'Research record must be a JSON object.' });
        continue;
      }
      for (const message of recordProblems(file, record)) findings.push({ rule: 'R002', file: path, message });
    }
    const list = studies.get(file.study) ?? [];
    list.push({ path, file, record });
    studies.set(file.study, list);
  }

  for (const [study, records] of studies) findings.push(...checkStudy(study, records));
  return findings;
}

function checkStudy(study: string, records: Loaded[]): Finding[] {
  const findings: Finding[] = [];
  const of = (kind: Kind) => records.filter((r) => r.file.kind === kind && r.record);
  const add = (path: string, message: string) => findings.push({ rule: 'R003', file: path, message });

  const contracts = of('contract');
  if (contracts.length === 0) {
    add(`research/${study}`, 'A study needs an approved contract.v1.json before any other record.');
    return findings;
  }
  const latest = contracts.reduce((a, b) => ((a.file.version ?? 0) > (b.file.version ?? 0) ? a : b)).record!;
  const maxRounds = typeof latest.maxReviewRounds === 'number' ? latest.maxReviewRounds : 2;

  const evidence = new Map(of('evidence').map((r) => [r.file.id, r.record!]));
  const claimVersions = new Map<string, Set<number>>();
  for (const c of of('claim')) {
    const set = claimVersions.get(c.file.id) ?? new Set<number>();
    set.add(c.file.version!);
    claimVersions.set(c.file.id, set);
  }
  const reviews = new Map(of('review').map((r) => [r.file.id, r.record!]));

  for (const [id, versions] of claimVersions) {
    const max = Math.max(...versions);
    for (let v = 1; v <= max; v++) if (!versions.has(v)) add(`research/${study}/claims/${id}.v${v}.json`, `Claim ${id} skips version ${v}; earlier versions are kept, never replaced.`);
  }

  const cited = (r: Json) => (Array.isArray(r.evidence) ? (r.evidence as string[]) : []);
  for (const c of of('claim')) {
    for (const e of cited(c.record!)) if (!evidence.has(e)) add(c.path, `Cites evidence ${e}, which does not exist in this study.`);
  }

  for (const r of of('review')) {
    const rec = r.record!;
    const target = (rec.target ?? {}) as Json;
    if (!claimVersions.get(String(target.claim))?.has(Number(target.version))) add(r.path, `Reviews claim ${String(target.claim)} v${String(target.version)}, which does not exist.`);
    for (const e of cited(rec)) if (!evidence.has(e)) add(r.path, `Cites evidence ${e}, which does not exist in this study.`);
    if (typeof rec.round === 'number' && rec.round > maxRounds) add(r.path, `Round ${rec.round} exceeds the contract's ${maxRounds} review rounds; escalate to the manager instead.`);
    if (rec.disposition === 'established' || rec.disposition === 'contradicted') {
      const own = cited(rec).some((e) => evidence.get(e)?.author === 'reviewer');
      if (!own) add(r.path, `"${String(rec.disposition)}" needs evidence the reviewer checked itself (an evidence record with author "reviewer"). Agreement is not verification.`);
    }
  }

  for (const a of of('response')) {
    const rec = a.record!;
    const review = reviews.get(String(rec.review));
    if (!review) {
      add(a.path, `Responds to review ${String(rec.review)}, which does not exist.`);
      continue;
    }
    if (rec.action === 'revised') {
      const claim = String(((review.target ?? {}) as Json).claim);
      if (!claimVersions.get(claim)?.has(Number(rec.newVersion))) add(a.path, `Says claim ${claim} was revised to v${String(rec.newVersion)}, but that version does not exist.`);
    }
  }
  return findings;
}

/** One line of `git diff --name-status`: a status letter and one or two paths. */
export interface Change {
  status: string;
  path: string;
  /** Source path for renames (R) and copies (C). */
  from?: string;
}

/** Parses `git diff --name-status -z` output. */
export function parseNameStatus(raw: string): Change[] {
  const parts = raw.split('\0').filter((p) => p !== '');
  const changes: Change[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (status.startsWith('R') || status.startsWith('C')) {
      changes.push({ status: status[0], from: parts[i], path: parts[i + 1] });
      i += 2;
    } else {
      changes.push({ status: status[0], path: parts[i++] });
    }
  }
  return changes;
}

/** R001: research records are append-only. Only additions are allowed under research/. */
export function checkAppendOnly(changes: Change[]): Finding[] {
  const inResearch = (p: string | undefined) => p !== undefined && p.startsWith(`${RESEARCH_ROOT}/`);
  const findings: Finding[] = [];
  for (const c of changes) {
    // An addition, or a copy, creates a new file and leaves every existing record untouched.
    if (c.status === 'A' || c.status === 'C') continue;
    if (c.status === 'R') {
      if (inResearch(c.from)) findings.push({ rule: 'R001', file: c.from, message: `Research record was renamed to ${c.path}. Records are append-only; add a new version instead.` });
    } else if (inResearch(c.path)) {
      const verb = c.status === 'D' ? 'deleted' : 'modified';
      findings.push({ rule: 'R001', file: c.path, message: `Research record was ${verb}. Records are append-only; add a new version or a new record instead.` });
    }
  }
  return findings;
}
