# Governance

Who may do what, and what actually enforces it. The verified state of each
setting is recorded in `ACCEPTANCE-M1.md`; this file describes the intent.

## Repository settings for every project

| Setting | Value |
| --- | --- |
| Ruleset on the default branch | No direct pushes (pull request required), no force push, no deletion |
| Required status checks | `factory / quality`, `factory / policy` |
| Ruleset bypass list | Empty, so it applies to the owner and admins too |
| Actions allowed | GitHub-owned actions and `Renso0905/ai-factory` only |
| Default `GITHUB_TOKEN` | Read-only; Actions may not approve pull requests |
| `production` environment | Required reviewer: the human owner |

The factory repository uses the same branch rules with the check `test`.

## Sensitive changes

These need the human owner, never an agent acting alone:

- Anything under `.github/`, `factory.config.json`, `.claude/`
- Repository settings, rulesets, secrets, environments
- Moving a factory version tag
- Production releases

## What V1 does not enforce

V1 has one GitHub identity. The AI developer runs locally with the owner's
credentials, and GitHub does not let an author approve their own pull request.
Requiring an approving review would therefore block every merge, so the
ruleset requires a pull request and passing checks but zero approvals.

The consequence: nothing technical stops the worker from merging a green pull
request or changing a ruleset. That is covered only by the worker's deny-list
and instructions, which are advisory. Machine checks are enforced; human
approval is a convention.

Closing this gap is the first V2 item: give the worker its own identity (a
GitHub App or bot account with write access limited to branches and pull
requests), then require one approving review and code-owner review.

## Spending and retries

- V1 uses no paid service. Public repositories run Actions for free.
- No API key is stored anywhere. Adding one is a sensitive change.
- AI agents run only on the owner's existing subscriptions or on free tiers
  that cannot bill: Claude through a subscription token
  (`claude setup-token`, with extra usage turned off on the account), and
  Gemini through a free-tier key from a Google Cloud project with no billing
  account. When a quota runs out, the run fails; it never moves to
  pay-per-token billing. A paid API key or plan needs the owner's explicit
  approval.
- Every job has a timeout. The worker stops after 3 failed attempts per check.
