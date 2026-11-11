import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkBoundariesInText, parseBoundaries } from './boundaries.ts';
import type { Boundary } from './boundaries.ts';
import { readText, walk } from './files.ts';
import { checkSecretFileName, checkSecretsInText } from './secrets.ts';
import type { Finding, PolicyOptions } from './types.ts';
import { callsFactoryCi, checkWorkflowText } from './workflows.ts';

/** Files every project repository must keep. */
export const REQUIRED_PROJECT_FILES = [
  'docs/REQUIREMENTS.md',
  'docs/ARCHITECTURE.md',
  'package-lock.json',
  '.github/CODEOWNERS',
];

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;

/** Runs every policy check against one repository and returns all findings. */
export function runPolicy(opts: PolicyOptions): Finding[] {
  const { target, mode, factoryRepo } = opts;
  const findings: Finding[] = [];
  const files = walk(target);

  let boundaries: Boundary[] = [];
  if (mode === 'project') {
    for (const required of REQUIRED_PROJECT_FILES) {
      if (!files.includes(required)) {
        findings.push({ rule: 'P001', file: required, message: 'Required project file is missing.' });
      }
    }
    const configPath = join(target, 'factory.config.json');
    if (existsSync(configPath)) {
      try {
        boundaries = parseBoundaries(readFileSync(configPath, 'utf8'));
      } catch (err) {
        findings.push({ rule: 'A002', file: 'factory.config.json', message: `Invalid factory.config.json: ${(err as Error).message}` });
      }
    }
  }

  let callsFactory = false;
  for (const file of files) {
    findings.push(...checkSecretFileName(file));
    const text = readText(target, file);
    if (text === null) continue;

    findings.push(...checkSecretsInText(file, text));
    findings.push(...checkBoundariesInText(file, text, boundaries));
    if (WORKFLOW.test(file)) {
      findings.push(...checkWorkflowText(file, text, factoryRepo));
      if (callsFactoryCi(text, factoryRepo)) callsFactory = true;
    }
  }

  if (mode === 'project' && !callsFactory) {
    findings.push({ rule: 'P002', file: '.github/workflows', message: `No workflow calls ${factoryRepo}/.github/workflows/project-ci.yml.` });
  }
  return findings;
}
