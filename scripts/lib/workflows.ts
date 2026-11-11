import type { Finding } from './types.ts';

const SHA = /^[0-9a-f]{40}$/;
const FACTORY_TAG = /^v\d+(\.\d+\.\d+)?$/;
const USES = /^\s*(?:-\s*)?uses:\s*['"]?([^'"\s]+)/;

function stripComment(line: string): string {
  if (/^\s*#/.test(line)) return '';
  return line.replace(/\s+#.*$/, '');
}

/**
 * Line-based checks of one GitHub Actions workflow file.
 * This is deliberately not a YAML parser: the rules are simple enough to
 * check per line, and it keeps the factory free of third-party dependencies.
 */
export function checkWorkflowText(file: string, text: string, factoryRepo: string): Finding[] {
  const findings: Finding[] = [];
  const factoryPrefix = `${factoryRepo.toLowerCase()}/`;
  let hasTopLevelPermissions = false;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = stripComment(raw);
    const lineNo = i + 1;
    if (!line.trim()) return;

    if (/^permissions:/.test(line)) hasTopLevelPermissions = true;

    if (/^\s*permissions:\s*write-all\s*$/.test(line)) {
      findings.push({ rule: 'W004', file, line: lineNo, message: 'permissions: write-all is forbidden; grant individual scopes.' });
    }

    if (/\bpull_request_target\b/.test(line)) {
      findings.push({ rule: 'W002', file, line: lineNo, message: 'pull_request_target is forbidden: it runs with write access against untrusted code.' });
    }

    const uses = USES.exec(line);
    if (!uses) return;
    const spec = uses[1];
    if (spec.startsWith('./')) return;

    if (spec.startsWith('docker://')) {
      if (!spec.includes('@sha256:')) {
        findings.push({ rule: 'W001', file, line: lineNo, message: `Docker action "${spec}" must be pinned by @sha256 digest.` });
      }
      return;
    }

    const at = spec.lastIndexOf('@');
    const name = at === -1 ? spec : spec.slice(0, at);
    const ref = at === -1 ? '' : spec.slice(at + 1);
    if (SHA.test(ref)) return;
    if (name.toLowerCase().startsWith(factoryPrefix) && FACTORY_TAG.test(ref)) return;

    findings.push({
      rule: 'W001',
      file,
      line: lineNo,
      message: `"${spec}" must be pinned to a full 40-character commit SHA (factory workflows may use a vN or vN.N.N tag).`,
    });
  });

  if (!hasTopLevelPermissions) {
    findings.push({ rule: 'W003', file, message: 'Workflow must declare a top-level permissions block (least privilege).' });
  }
  return findings;
}

/** True when the workflow calls the factory's shared project CI. */
export function callsFactoryCi(text: string, factoryRepo: string): boolean {
  const needle = `${factoryRepo.toLowerCase()}/.github/workflows/project-ci.yml@`;
  return text
    .split(/\r?\n/)
    .map(stripComment)
    .some((line) => USES.test(line) && line.toLowerCase().includes(needle));
}
