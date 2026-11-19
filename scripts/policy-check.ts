// Factory policy check CLI.
// Usage: node scripts/policy-check.ts --target <dir> --mode project|factory [--factory-repo owner/name]
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runPolicy } from './lib/policy.ts';
import type { Mode } from './lib/types.ts';

const { values } = parseArgs({
  options: {
    target: { type: 'string', default: '.' },
    mode: { type: 'string', default: 'project' },
    'factory-repo': { type: 'string', default: 'Renso0905/ai-factory' },
  },
});

if (values.mode !== 'project' && values.mode !== 'factory') {
  console.error(`Unknown --mode "${values.mode}" (expected project or factory).`);
  process.exit(2);
}

const findings = runPolicy({
  target: resolve(values.target),
  mode: values.mode as Mode,
  factoryRepo: values['factory-repo'],
});

const inActions = process.env.GITHUB_ACTIONS === 'true';
for (const f of findings) {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '(repository)';
  console.log(`${f.rule} ${where} ${f.message}`);
  if (inActions) {
    const props = [f.file && `file=${f.file}`, f.line && `line=${f.line}`, `title=Factory policy ${f.rule}`].filter(Boolean).join(',');
    console.log(`::error ${props}::${f.message}`);
  }
}

const summary = findings.length === 0
  ? `Factory policy (${values.mode}): passed, 0 findings.`
  : `Factory policy (${values.mode}): FAILED, ${findings.length} finding(s).`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);

process.exit(findings.length === 0 ? 0 : 1);
