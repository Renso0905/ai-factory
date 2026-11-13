# Market intelligence and evidence-based review

How the factory checks a feature against competitors, and how each claim gets
reviewed. Projects keep their studies under `research/`. The rules in this
file marked **(enforced)** are checked by `scripts/policy-check.ts`
(`STANDARDS.md`, rules R001 to R003). Everything else is process.

Status: the research contract, the evidence schema and append-only storage
are implemented. The agent workflows and GitHub orchestration come next.

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

1. The manager asks for a study. The researcher drafts `contract.v1.json`, and
   the manager approves it by merging the pull request that adds it.
2. The researcher adds evidence and claims (round 1) and opens a pull request.
3. The reviewer adds evidence and one review per claim in the same pull request.
4. The researcher responds, adding new claim versions where it revises (round 2).
5. The reviewer reviews the new versions. Stop after `maxReviewRounds`.
6. The researcher writes `report.v1.md`: established findings, disagreements,
   unknowns, gaps and recommendations, each citing claim ids.
7. The manager merges the study and decides which recommendations to adopt.

If the researcher finds something valuable outside the contract, it notes it
in the report as a possible future study. It does not investigate it.

## What is not enforced yet

- `author` is declared by the agent itself. V1 has one GitHub identity, so a
  rule cannot tell which agent wrote a file. When the agents run in separate
  workflow jobs, each job will only be able to write its own record types.
- Whether a source really supports a claim is judged by the reviewer and the
  manager, not by a script.
