// Decides where a study run starts: a new study from its contract, or a resumed
// study from the saved records of an earlier run.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Pipeline steps in order. A resumed run starts at one of them. */
export const RESUME_STEPS: Readonly<Record<string, number>> = { 'review-1': 2, respond: 3, 'review-2': 4, report: 5 };

export interface PrepareInput {
  /** Directory of the project checkout. */
  project: string;
  study: string;
  /** Directory holding the saved study of the run being resumed, or '' for a new study. */
  resumeDir: string;
  resumeRun: string;
  resumeAt: string;
}

export interface PrepareResult {
  rounds: 1 | 2;
  /** First pipeline step to run: 1 research, 2 review 1, 3 respond, 4 review 2, 5 report. */
  start: number;
  contractVersion: number;
}

function files(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(root, join(e.parentPath, e.name)).replaceAll('\\', '/'))
    .sort();
}

/**
 * Validates the request and, when resuming, replaces the study folder with the
 * saved one. Throws with a message for the run log when the run must not start.
 */
export function prepareStudy(input: PrepareInput): PrepareResult {
  const { project, study, resumeDir, resumeRun, resumeAt } = input;
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(study)) throw new Error(`Invalid study id "${study}". Use lower-case letters, digits and hyphens only.`);
  if (Boolean(resumeRun) !== Boolean(resumeAt)) throw new Error('Give both resume-run and resume-at, or neither.');
  if (resumeAt && !(resumeAt in RESUME_STEPS)) throw new Error(`resume-at must be one of: ${Object.keys(RESUME_STEPS).join(', ')}.`);
  if (resumeRun && !/^\d+$/.test(resumeRun)) throw new Error('resume-run must be a run id (digits only).');
  const start = resumeAt ? RESUME_STEPS[resumeAt] : 1;

  const dir = join(project, 'research', study);
  if (!existsSync(dir)) throw new Error(`No study folder research/${study} on the default branch.`);

  if (resumeRun) {
    if (!existsSync(resumeDir)) throw new Error(`Run ${resumeRun} has no saved study to resume.`);
    // Everything merged must be in the saved study, byte for byte: records are append-only.
    for (const f of files(dir)) {
      const saved = join(resumeDir, f);
      if (!existsSync(saved) || !readFileSync(saved).equals(readFileSync(join(dir, f)))) {
        throw new Error(`The saved study from run ${resumeRun} does not contain research/${study}/${f} as merged.`);
      }
    }
    rmSync(dir, { recursive: true });
    cpSync(resumeDir, dir, { recursive: true });
  }

  const list = files(dir);
  const versions = list.map((f) => /^contract\.v(\d+)\.json$/.exec(f)).filter((m) => m !== null).map((m) => Number(m[1]));
  if (versions.length === 0) throw new Error(`No approved contract in research/${study}. Merge contract.v1.json first.`);
  if (!resumeRun && list.some((f) => f.startsWith('claims/'))) {
    throw new Error(`research/${study} already has claims. Start a new study, or resume an earlier run.`);
  }
  if (resumeRun && start > 1 && !list.some((f) => f.startsWith('claims/'))) {
    throw new Error(`The saved study from run ${resumeRun} has no claims yet; start a new run instead of resuming.`);
  }

  const contractVersion = Math.max(...versions);
  const contract = JSON.parse(readFileSync(join(dir, `contract.v${contractVersion}.json`), 'utf8')) as { maxReviewRounds?: unknown };
  const rounds = Number(contract.maxReviewRounds) >= 2 ? 2 : 1;
  if (rounds === 1 && (start === 3 || start === 4)) throw new Error('This contract allows one review round; resume at review-1 or report.');
  return { rounds, start, contractVersion };
}
