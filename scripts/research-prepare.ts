// First job of the research pipeline. Reads STUDY, RESUME_RUN, RESUME_AT and
// RUNNER_TEMP; the project is checked out in ./project. Writes rounds and start
// to GITHUB_OUTPUT.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareStudy } from './lib/prepare.ts';

const env = process.env;
try {
  const result = prepareStudy({
    project: env.PROJECT ?? 'project',
    study: env.STUDY ?? '',
    resumeRun: env.RESUME_RUN ?? '',
    resumeAt: env.RESUME_AT ?? '',
    resumeDir: join(env.RUNNER_TEMP ?? '', 'resume'),
  });
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `rounds=${result.rounds}\nstart=${result.start}\n`);
  const from = env.RESUME_RUN ? `resuming run ${env.RESUME_RUN} at ${env.RESUME_AT}` : 'new study';
  console.log(`Study ${env.STUDY}: contract v${result.contractVersion}, ${result.rounds} review round(s), ${from}.`);
} catch (err) {
  console.log(`::error::${(err as Error).message}`);
  process.exit(1);
}
