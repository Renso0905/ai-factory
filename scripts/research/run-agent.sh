#!/usr/bin/env bash
# Runs one research agent step inside a GitHub Actions job, then the guard.
# Usage: run-agent.sh <researcher|reviewer> <research|review|respond|report> <round>
# Environment: FACTORY and PROJECT (absolute paths), STUDY, SNAPSHOTS (directory
# outside the repository), MODEL (optional), and the role's credential:
# CLAUDE_CODE_OAUTH_TOKEN for the researcher, GEMINI_API_KEY for the reviewer.
set -euo pipefail

ROLE="$1" TASK="$2" ROUND="$3"
CLAUDE_CODE_VERSION="2.1.323"

[[ "$STUDY" =~ ^[a-z0-9][a-z0-9-]{2,79}$ ]] || { echo "Invalid study id." >&2; exit 2; }
[[ "$ROUND" =~ ^[1-9]$ ]] || { echo "Invalid round." >&2; exit 2; }

export RESEARCH_PROJECT="$PROJECT" RESEARCH_STUDY="$STUDY" RESEARCH_ROLE="$ROLE" RESEARCH_ROUND="$ROUND"
export RESEARCH_SNAPSHOTS="$SNAPSHOTS" RESEARCH_MANIFEST="$RUNNER_TEMP/research-manifest.json"
mkdir -p "$SNAPSHOTS"

# The agent can read the factory but must not be able to change the checker that judges it.
chmod -R a-w "$FACTORY"

node "$FACTORY/scripts/research-guard.ts" --snapshot

case "$TASK" in
  research) TASK_TEXT="Round 1: research the feature in the contract and add evidence and claims (round 1). Then stop.";;
  review)   TASK_TEXT="Round $ROUND: review the claims due for review in this round, as your instructions describe. Then stop.";;
  respond)  TASK_TEXT="Round $ROUND: respond to the reviewer's round $((ROUND - 1)) reviews of your claims, adding new claim versions (round $ROUND) where you revise. Then stop.";;
  report)   TASK_TEXT="Write the management report research/$STUDY/report.v1.md (or the next unused version). Cover: the question, competitors examined, established findings, contradicted or withdrawn claims, unknowns, unresolved disagreements for the manager, gaps in our implementation, and recommendations. Cite claim ids for every statement. Add no claims or evidence. Then stop.";;
  *) echo "Unknown task $TASK" >&2; exit 2;;
esac

PROMPT="$(sed "s|\$FACTORY|$FACTORY|g" "$FACTORY/worker/research/$ROLE.md")

## This run

- Study folder: research/$STUDY (the contract is the latest contract.vN.json there).
- Task: $TASK_TEXT"

cd "$PROJECT"
FETCH="node $FACTORY/scripts/research-fetch.ts"
CHECK="node $FACTORY/scripts/research-guard.ts"

if [[ "$ROLE" == researcher ]]; then
  : "${CLAUDE_CODE_OAUTH_TOKEN:?CLAUDE_CODE_OAUTH_TOKEN secret is missing}"
  npm install --global --no-fund --no-audit "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" >/dev/null
  # dontAsk: anything not listed below is refused, never prompted.
  claude -p "$PROMPT" \
    --model "${MODEL:-claude-opus-5-5}" \
    --permission-mode dontAsk \
    --allowedTools "Read" "Glob" "Grep" "WebSearch" "WebFetch" \
      "Write(research/$STUDY/**)" "Edit(research/$STUDY/**)" \
      "Bash($FETCH:*)" "Bash($CHECK)" \
    --output-format text
elif [[ "$ROLE" == reviewer ]]; then
  : "${GEMINI_API_KEY:?GEMINI_API_KEY secret is missing}"
  curl -fsSL https://antigravity.google/cli/install.sh | bash >/dev/null
  export PATH="$HOME/.local/bin:$PATH"
  mkdir -p "$HOME/.gemini/antigravity-cli"
  # Free-tier API key only; the reviewer may write reviews and its own evidence, nothing else.
  cat > "$HOME/.gemini/antigravity-cli/settings.json" <<JSON
{
  "modelProvider": "gemini",
  "permissions": {
    "allow": [
      "read_file($PROJECT)",
      "read_file($FACTORY/docs)",
      "write_file($PROJECT/research/$STUDY/reviews/)",
      "write_file($PROJECT/research/$STUDY/evidence/)",
      "command($FETCH)",
      "command($CHECK)",
      "read_url(*)"
    ],
    "deny": [
      "write_file($FACTORY)",
      "write_file($PROJECT/.git)",
      "execute_url(*)"
    ]
  }
}
JSON
  echo "Models available to the reviewer:"; agy models || true
  agy -p "$PROMPT" ${MODEL:+--model "$MODEL"} --print-timeout 40m --output-format text
else
  echo "Unknown role $ROLE" >&2; exit 2
fi

echo "::group::Research guard"
node "$FACTORY/scripts/research-guard.ts"
echo "::endgroup::"
