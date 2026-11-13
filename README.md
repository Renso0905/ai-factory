# ai-factory

Central factory for AI-assisted software development. It holds the machinery
shared by every project: quality-control workflows, policy checks, engineering
standards and the AI developer configuration. Each application lives in its own
repository (a "mini-factory") and calls this one.

First project: [gym-app](https://github.com/Renso0905/gym-app).

## What is here

| Path | Purpose |
| --- | --- |
| `.github/workflows/project-ci.yml` | Reusable pipeline projects call: build, typecheck, test, policy check |
| `.github/workflows/research.yml` | Reusable market-research pipeline: researcher and reviewer agents, started by hand (`docs/RESEARCH.md`) |
| `.github/workflows/ci.yml` | The factory's own tests |
| `scripts/policy-check.ts` | Security and architecture validation (rules in `docs/STANDARDS.md`) |
| `scripts/lib/` | Policy rules and their tests |
| `worker/claude/` | AI developer instructions and denied-permission settings for projects |
| `worker/research/` | Researcher and reviewer agent instructions |
| `scripts/research-*.ts`, `scripts/research/` | Source fetch tool, research guard and agent runner |
| `docs/` | Architecture, standards, governance, versioning, acceptance evidence |

## Using the factory from a project

```yaml
# .github/workflows/ci.yml in the project
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  factory:
    uses: Renso0905/ai-factory/.github/workflows/project-ci.yml@v1
```

The project needs `npm test`, a committed `package-lock.json`, and the files
listed in `docs/STANDARDS.md`. See `docs/ARCHITECTURE.md` for onboarding a new
project.

## Working on the factory

Requires Node 24 or newer. Scripts are TypeScript run directly by Node; there
is no build step and no runtime dependency.

```bash
npm ci
npm run typecheck
npm test
npm run policy:self
```
