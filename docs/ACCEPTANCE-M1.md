# Milestone 1 acceptance record

Date: 2026-11-11. Factory version: `v1.0.0` (commit `7bd7cc5`).
Every row below was observed, not assumed. Links are the evidence.

## Factory acceptance test

| # | Step | Result | Evidence |
| --- | --- | --- | --- |
| 1 | A development task is created | Pass | [gym-app issue #1](https://github.com/Renso0905/gym-app/issues/1) |
| 2 | An AI coding worker proposes a change | Pass | Branch `task/1-workout-volume`, commit `05f4bd8`, written by Claude Code running locally |
| 3 | A pull request is created | Pass | [gym-app PR #2](https://github.com/Renso0905/gym-app/pull/2) |
| 4 | Shared factory workflows execute against the project | Pass | Runs below executed `ai-factory/.github/workflows/project-ci.yml@v1`; checks reported as `factory / quality` and `factory / policy` |
| 5 | A deliberately defective change fails | Pass | [Run 43104377557](https://github.com/Renso0905/gym-app/actions/runs/43104377557): `factory / quality` failed, 4 of 10 tests failed (`expected 105 to be 500`); `factory / policy` passed |
| 6 | A corrected change passes | Pass | [Run 43105517890](https://github.com/Renso0905/gym-app/actions/runs/43105517890) on commit `0d1915f`: 10 of 10 tests passed, build succeeded, policy 0 findings |
| 7 | Unapproved changes cannot enter the protected branch | Pass for machine checks; see limits | Direct push to `main` rejected with `GH013 ... Changes must be made through a pull request` and `2 of 2 required status checks are expected`. `gh pr merge` on the PR before checks passed: `the base branch policy prohibits the merge` (merge state `BLOCKED`). After run 43105517890 the state became `CLEAN` |

The defect: `totalVolume` added reps and weight instead of multiplying them.
The tests were written from the acceptance criteria in the issue and were not
changed between the failing and the passing commit.

The pull request was left open for the human owner to merge.

## Local verification

| Check | Result |
| --- | --- |
| ai-factory `npm run typecheck` | Pass |
| ai-factory `npm test` | 24 of 24 pass |
| ai-factory `npm run policy:self` | 0 findings |
| gym-app typecheck, test, build | Pass (10 of 10 tests on the corrected commit) |
| Policy check run locally against gym-app | 0 findings |

## Repository configuration, read back from the GitHub API

gym-app:

| Setting | Verified value |
| --- | --- |
| Ruleset `protect-main` (id 27065816) | Active on the default branch; rules: deletion, non_fast_forward, pull_request, required_status_checks |
| Required checks | `factory / quality`, `factory / policy` |
| Bypass actors | None |
| Required approving reviews | 0 (see limits) |
| Actions allowed | `selected`: GitHub-owned plus `Renso0905/ai-factory/*` |
| Default workflow token | `read`; may not approve pull requests |
| Environment `production` | Required reviewer `Renso0905`; protected branches only |
| Secret scanning and push protection | Enabled (GitHub default for public repositories) |

ai-factory:

| Setting | Verified value |
| --- | --- |
| Ruleset `protect-main` (id 27070270) | Active on the default branch; rules: deletion, non_fast_forward, pull_request, required_status_checks |
| Required check | `test` (the `Factory CI` job) |
| Bypass actors | None |
| Default workflow token | `read`; may not approve pull requests |
| Direct push to `main` | Rejected with `GH013 ... Changes must be made through a pull request` (attempted with this very file) |

The ruleset was applied after the initial commit and the `v1` tags, so the
`v1.0.0` tree itself never went through a pull request. This record entered
through ai-factory PR #1, whose `test` check is the first `Factory CI` run to
complete (the run on the initial push was lost to the incident below).

## Incident during the test

The first three workflow runs (one in ai-factory, two in gym-app) stayed
`queued` with no jobs for over an hour, while GitHub's status page reported
Actions as operational. Runs created after about 21:35 UTC started normally.
The cause was not identified from the API. The owner pushed an empty commit
(`9bce1e4`) to re-trigger the pull request run. The stuck runs could not be
cancelled or re-run through the API.

## Limits of what was shown

- **Human approval is not technically enforced.** One GitHub identity is
  shared by the owner and the worker, and an author cannot approve their own
  pull request, so the ruleset requires 0 approvals. The same credentials
  could merge a green pull request or edit the ruleset. See `GOVERNANCE.md`.
- The worker ran locally under human supervision, not autonomously in Actions.
- The `production` environment gate is configured but untested: there is no
  deploy workflow yet. Whether its "protected branches" policy recognises a
  ruleset (rather than classic branch protection) is also untested.
- Only the test-failure path of `factory / quality` and the passing path of
  `factory / policy` ran in CI. Policy failures are covered by unit tests only.
- The worker deny-list in `.claude/settings.json` was not exercised.
- Actions allow-list was not tested with a disallowed action.

## Recommendations for Factory V2

1. Give the worker its own identity (GitHub App or bot account), then require
   one approving review and code-owner review. This closes the main gap.
2. Protect version tags with a tag ruleset so only the owner can move `v1`.
3. Add a factory end-to-end test: a fixture project that must pass, and
   fixtures that must fail each policy rule, run through `project-ci.yml`.
4. Add the gym-app deploy workflow (GitHub Pages) behind the `production`
   environment and test the approval gate.
5. Add `actionlint` and dependency review to the shared pipeline; enable
   Dependabot for npm and for pinned actions.
6. Extract a project template repository from gym-app.
7. Only then consider running the worker in Actions on labelled issues, with
   a spend cap and attempt limit.
