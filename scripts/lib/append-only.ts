import { spawnSync } from 'node:child_process';
import { checkAppendOnly, parseNameStatus } from './research.ts';
import type { Finding } from './types.ts';

/**
 * R001 for a git checkout: compares HEAD with `base` and reports any change to
 * an existing research record. A base git cannot resolve is itself a finding,
 * so a shallow checkout cannot silently skip the rule.
 */
export function checkAppendOnlyInGit(target: string, base: string): Finding[] {
  if (!/^[0-9a-f]{7,64}$/.test(base)) {
    return [{ rule: 'R001', message: `--base must be a commit SHA (got "${base}").` }];
  }
  const res = spawnSync('git', ['-C', target, '-c', 'core.quotePath=false', 'diff', '--name-status', '-z', '-M', base, 'HEAD'], { encoding: 'utf8' });
  if (res.status !== 0) {
    return [{ rule: 'R001', message: `Could not compare with base ${base}: ${res.stderr.trim() || 'git failed'}. Check out full history.` }];
  }
  return checkAppendOnly(parseNameStatus(res.stdout));
}
