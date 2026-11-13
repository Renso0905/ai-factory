# Architecture

## Shape

```
ai-factory (this repo)            gym-app, future projects
  reusable workflows   <--------  .github/workflows/ci.yml  (calls @v1)
  policy scripts                  application code and tests
  standards, governance           docs/REQUIREMENTS.md, docs/ARCHITECTURE.md
  worker configuration            factory.config.json (architecture rules)
```

The factory supplies machinery. A project supplies product knowledge,
requirements and tests. A project never copies factory code; it references a
versioned tag.

## How a change is checked

A pull request in a project triggers the project's `ci.yml`, which calls
`project-ci.yml` here. Two jobs run:

- **quality** runs the project's own code: `npm ci`, typecheck, lint (if
  present), tests, build. This code is treated as untrusted, so the job has a
  read-only token and no secrets.
- **policy** checks out the factory at the pinned tag and runs
  `scripts/policy-check.ts` over the project's files. Project code is read,
  never executed, so a project cannot alter the checker that judges it.

Both must pass before a merge; the project's branch ruleset requires the
checks `factory / quality` and `factory / policy` by name. Deleting the
workflow does not help: a required check that never reports blocks the merge.

## Separation of authority

| Authority | Held by | Enforced by |
| --- | --- | --- |
| Propose code | AI developer | Pull requests only; ruleset blocks direct pushes |
| Judge code | Factory workflows at a tag | Required status checks; checker lives in another repo |
| Change the judge | Human owner | Factory ruleset, CODEOWNERS |
| Merge and release | Human owner | Worker deny-list (advisory in V1, see `GOVERNANCE.md`) |

## The seven long-term systems

| System | V1 status |
| --- | --- |
| AI workforce | One developer worker (Claude Code, run locally by the owner) |
| Task orchestration | Deferred. Tasks are GitHub Issues picked up by hand |
| Quality control | Implemented: tests, typecheck, build, policy checks |
| Governance | Implemented: rulesets, required checks, Actions restrictions |
| Project templates | Deferred. `gym-app` is the reference to copy from |
| Operations | Deferred, except a `production` environment gate in `gym-app` |
| Monitoring | GitHub Actions run history only |

## Market intelligence

A separate capability from quality control: a researcher agent compares a
feature with competitors, and a reviewer agent checks each claim against its
own evidence. Studies live in the project under `research/` and are advisory.
They never run on every commit and never block routine CI. The policy check
only ensures the records are well formed and append-only (R001 to R003). See
`RESEARCH.md`.

## Adding a project

1. Create the repository with a `package-lock.json`, `npm test`, and the
   required files from `STANDARDS.md`.
2. Add the caller workflow from the README.
3. Copy `worker/claude/CLAUDE.project.md` to `CLAUDE.md` and
   `worker/claude/settings.json` to `.claude/settings.json`.
4. Apply the repository settings listed in `GOVERNANCE.md`.

No factory change is needed to add a project.

## Known limits of V1

- Policy rules read workflow files line by line; they are not a YAML parser.
- `factory.config.json` lives in the project, so the project can propose
  loosening its own architecture rules. The change is visible in the pull
  request and the file is on the worker's deny-list.
- Factory workflow changes are only exercised end to end once a project runs
  them. Test risky changes on a pre-release tag first (`VERSIONING.md`).
