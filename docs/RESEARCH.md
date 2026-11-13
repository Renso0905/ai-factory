# Market intelligence and evidence-based review

How the factory checks a feature against competitors, and how each claim gets
reviewed. Projects keep their studies under `research/`. The rules in this
file marked **(enforced)** are checked by `scripts/policy-check.ts`
(`STANDARDS.md`, rules R001 to R003). Everything else is process.

Status: the contract, evidence schema, append-only storage, both agents and
the GitHub Actions pipeline are implemented. The first pilot study has not run
yet.

## Principle

Agent A produces research supported by evidence. Agent B checks that research
against its own evidence. Neither agent may erase the other's work, and two
agents agreeing does not make a claim verified. The full record is kept, and
the human manager decides what is adopted.

Findings are advisory. They become requirements only when the manager adds
them to the project's `docs/REQUIREMENTS.md`.

## Roles

| Role | Agent | May write | May not |
| --- | --- | --- | --- |
| Manager | Human owner | Approves contracts, decides on findings | |
| Researcher (A) | Claude Code, Claude Opus 5.5 | `claims/`, `responses/`, evidence with `author: researcher`, reports | Record a verdict on its own claims |
| Reviewer (B) | Antigravity CLI, Gemini Flash model, free-tier `GEMINI_API_KEY` | `reviews/`, evidence with `author: reviewer` | Edit or delete anything |

Both agents must run on a subscription or a free tier, never a pay-per-token
API (`GOVERNANCE.md`, Spending).

## Modes

- **Focused feature review (default).** One feature, about 3 to 5 competitors
  (`maxCompetitors` in the contract). Unrelated features are out of scope.
- **General competitive review.** Run only when the manager asks for it. It
  covers several feature categories and suggests topics for later focused
  reviews.

Either mode can run **before** development, to inform the requirements, or
**after** it, to compare the finished feature (`stage` in the contract).
Evidence from an earlier study can be cited again while it is still current.

## Study layout

```
research/<study>/                  <study>: lower-case letters, digits, hyphens
  contract.v1.json                 approved scope; contract.v2.json for a manager-approved change
  evidence/E-001.json              one source each, never versioned
  claims/C-001.v1.json             researcher claims; a correction is C-001.v2.json
  reviews/R-001.json               reviewer comment and disposition on one claim version
  responses/A-001.json             researcher reply to a review
  report.v1.md                     management report; a new version for each revision
```

Nothing else may appear under `research/` **(enforced, R002)**.

## Append-only **(enforced, R001)**

A pull request may only **add** files under `research/`. Modifying, deleting
or renaming an existing record fails the `factory / policy` check. Corrections
are new versions, objections are new reviews, and contradicted claims stay in
the record. The `main` ruleset already blocks force pushes, so history that
has merged cannot be rewritten either.

## Records **(enforced, R002 and R003)**

All records are JSON objects with a `kind` field.

### Contract

Written before research starts and approved by the manager. Both agents work
under its latest version.

| Field | Meaning |
| --- | --- |
| `version` | Matches the file name |
| `mode` | `focused` or `general` |
| `stage` | `before` or `after` development |
| `project`, `feature` | What is evaluated |
| `requirements` | Requirement ids or text the feature must meet |
| `objective` | The question the study answers |
| `dimensions` | Comparison criteria |
| `competitorRules` | How competitors are chosen |
| `include`, `exclude` | Topics in and out of scope |
| `deliverables` | What the study must produce |
| `maxCompetitors` | Upper bound on competitors |
| `maxReviewRounds` | Automated review rounds before escalation (start with 2) |
| `approvedBy`, `approvedAt` | The manager's approval |

### Evidence

| Field | Meaning |
| --- | --- |
| `id`, `author` | `E-001`; `researcher` or `reviewer` |
| `source.type`, `source.ref` | `url`, `document`, `app-test` or `measurement`, and where it is |
| `retrievedAt` | ISO timestamp |
| `sha256` | Hash of the retrieved content, so later changes to the source are detectable |
| `excerpt` | Optional quote of at most 300 characters |
| `observation` | What the source actually shows |
| `limitations` | What it cannot establish |

Repositories are public, so full page snapshots are **not** committed. Keep
them outside the repository and record their hash here.

### Claim

`id`, `version`, `author: researcher`, `round`, `claim`, `subject`,
`basis` (`documented`, `observed`, `measured` or `interpretation`),
`evidence` (ids), `limitations`.

- A claim other than an interpretation must cite evidence.
- A claim carries no `status`, `verdict` or `confidence`. Only a review gives
  one, so the researcher cannot grade its own work.
- Subjective judgements (for example, which interface is easier) are
  `interpretation` unless backed by comparative testing.
- No performance numbers, usability scores or comparisons may be invented.

### Review

`id`, `author: reviewer`, `round`, `target` (`claim` id and `version`),
`disposition`, `comment`, `evidence` (ids).

| Disposition | Meaning |
| --- | --- |
| `established` | Adequate evidence supports the claim |
| `contradicted` | Evidence materially conflicts with the claim |
| `unknown` | Evidence is missing, insufficient, inaccessible, outdated or inconclusive |
| `needs-change` | The claim goes further than its evidence; narrow it or add evidence |
| `out-of-scope` | The claim is outside the contract |

`established` and `contradicted` must cite at least one evidence record with
`author: reviewer`, meaning the reviewer checked a source itself. A review
round above the contract's `maxReviewRounds` fails; escalate to the manager
instead.

### Response

`id`, `author: researcher`, `review`, `action` (`revised`, `withdrawn` or
`disputed`), `comment`, and `newVersion` when revised. The new claim version
must exist.

### Status of a claim

A claim's current status is the disposition of the latest review of its
latest version. A claim with no review is unreviewed. Unresolved disputes
and anything still `unknown` after the last round go to the manager.

## Process

1. The manager asks for a study. A `contract.v1.json` is drafted, and the
   manager approves it by merging the pull request that adds it.
2. The manager starts the project's **Research** workflow (Actions tab → Run
   workflow) with the study id. Nothing runs automatically.
3. The pipeline in `.github/workflows/research.yml` runs, one job per step:
   1. Researcher, round 1: evidence and claims.
   2. Reviewer, round 1: its own evidence and one review per claim.
   3. Researcher, round 2: responses, and new claim versions where it revises.
   4. Reviewer, round 2: reviews of the new versions and disputed claims.
   5. Researcher: `report.v1.md` with established findings, disagreements,
      unknowns, gaps and recommendations, each citing claim ids.

   Steps 3 and 4 run only when the contract's `maxReviewRounds` is 2. The
   pipeline supports at most 2 rounds.
4. The publish job pushes a branch `research/<study>-<run id>`, and the run
   summary links to open it as a pull request. The pull request runs the normal
   factory checks.
5. The manager reads the report, merges the study and decides which
   recommendations to adopt.

**When a step fails**, start the workflow again with `resume-run` set to the
failed run's id and `resume-at` set to the step to retry (`review-1`,
`respond`, `review-2` or `report`). The run continues from that run's saved
study, so earlier agent steps are not repeated. The saved study must still
contain every merged record unchanged. Each agent job keeps its full event
stream (tool calls, refusals, errors) as an `agent-log-*` artifact for 30
days.

The reviewer's model must be an id that Antigravity CLI lists (for example
`gemini-3.8-flash-medium`). An unknown id fails the step at once and prints
the available ones.

If the researcher finds something valuable outside the contract, it notes it
in the report as a possible future study. It does not investigate it.

## How the pipeline enforces the rules

| Control | How |
| --- | --- |
| Each agent writes only its own record types | After each agent, `scripts/research-guard.ts` compares the study with a snapshot taken before the run. The researcher may only add claims, responses, reports and `author: researcher` evidence. The reviewer may only add reviews and `author: reviewer` evidence. Any change to an existing file fails the job (G001) |
| Sources are really retrieved | Agents fetch pages only through `scripts/research-fetch.ts`, which saves the bytes outside the repository and logs url and sha256. Every url evidence record must match a retrieval logged in the same job (G001) |
| Records are valid | The guard also runs R002 and R003. The agents run the guard themselves before finishing |
| Agents cannot change the judge | The factory checkout is made read-only before an agent runs. Tool permissions only allow writing in the study folder and running the fetch and guard tools |
| Credentials are separated | Researcher jobs get only the Claude token, reviewer jobs only the Gemini key. Agent jobs have a read-only `GITHUB_TOKEN` |
| History is preserved | Only the publish job can push. It runs no agent, pushes a new branch, never `main`, and re-runs the full policy check (R001 to R003) first |
| Bounded effort | Each agent job has a time limit (45 minutes). Two review rounds at most |

Raw page snapshots are kept as workflow artifacts for 30 days, not in the
repository.

## Credentials

| Secret (in the project) | For | Cost |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Researcher, from `claude setup-token` | Counts against the owner's Claude subscription. Keep extra usage off |
| `GEMINI_API_KEY` | Reviewer, Antigravity CLI | Free tier. The key's project must have no billing account |

When a quota runs out, the job fails and the study stops. Nothing is billed.

## What is not enforced yet

- Whether a source really supports a claim is judged by the reviewer and the
  manager, not by a script.
- Prompt injection: a competitor page could contain instructions aimed at an
  agent. The tool limits and the guard confine the damage to records in the
  study, and the manager reviews the pull request before anything merges.
- The reviewer's model is whatever the `reviewer-model` input names. Each
  reviewer run lists the models the key can use.
