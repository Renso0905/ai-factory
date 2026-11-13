# Engineering and security standards

Rules with an id are checked by `scripts/policy-check.ts` and fail the
`policy` job. The others are conventions reviewed by a human.

## Automated rules

| Id | Rule |
| --- | --- |
| P001 | Project keeps `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `package-lock.json`, `.github/CODEOWNERS` |
| P002 | Project has a workflow that calls the factory's `project-ci.yml` |
| W001 | Actions are pinned to a full commit SHA. Factory workflows may use a `vN` or `vN.N.N` tag. Docker actions use an `@sha256` digest |
| W002 | `pull_request_target` is not used |
| W003 | Every workflow declares a top-level `permissions` block |
| W004 | `permissions: write-all` is not used |
| S001 | No credential-shaped content (GitHub, Anthropic, AWS, Google API keys, private keys) |
| S002 | No `.env*` (except `.env.example`), `.pem`, `.p12`, `.pfx` or `.key` files |
| A001 | No import that breaks a boundary declared in the project's `factory.config.json` |
| A002 | `factory.config.json`, when present, is valid |
| R001 | Research records are append-only: a change may add files under `research/` but not modify, delete or rename them. Runs when the policy check is given `--base` |
| R002 | Every file under `research/` is a recognised record with valid fields; claims carry no verdict; excerpts are at most 300 characters |
| R003 | Records in a study reference each other correctly: a contract exists, cited evidence and claim versions exist, `established`/`contradicted` cite the reviewer's own evidence, review rounds stay within the contract |

Research records are described in `RESEARCH.md`.

The research pipeline also runs `scripts/research-guard.ts` after every agent
step. Its findings fail that step, not the `policy` job:

| Id | Rule |
| --- | --- |
| G001 | An agent step may only add files to its own study, only record types its role may write, only evidence authored by its role, only claims and reviews for the current round, and only url evidence whose url and sha256 match a retrieval logged by `research-fetch.ts` in the same step. Nothing existing may change |

`factory.config.json` example: files under `src/lib` may not import React.

```json
{ "boundaries": [{ "from": "src/lib", "forbid": ["react", "react-dom"] }] }
```

## Engineering conventions

- Every behaviour change comes with a test. Objective correctness is decided
  by tests, not by an AI review.
- Dependencies are installed with `npm ci` from a committed lockfile.
- Changes reach `main` only through pull requests.
- Each pull request references the issue it implements.
- Keep domain logic free of UI framework imports so it can be tested alone.

## Security conventions

- Credentials live in GitHub secrets or environment secrets, never in the
  repository, issue text or logs.
- Workflows start from `contents: read` and add scopes per job.
- Jobs that run project code get no secrets.
- Agents have retry limits (3 attempts per failing check) and jobs have
  timeouts, so a loop cannot run or spend without bound.
- Written instructions are not a control. Anything important is backed by a
  permission, a ruleset or a required check; see `GOVERNANCE.md`.
