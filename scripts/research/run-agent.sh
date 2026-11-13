#!/usr/bin/env bash
# Runs one research agent step inside a GitHub Actions job, then the guard.
# Usage: run-agent.sh <researcher|reviewer> <research|review|respond|report> <round>
# Environment: FACTORY and PROJECT (absolute paths), STUDY, SNAPSHOTS (directory
# outside the repository), MODEL (optional), REVIEWER_AGENT (gemini or claude,
# reviewer only) and the agent's credential: CLAUDE_CODE_OAUTH_TOKEN for Claude,
# GEMINI_API_KEY for Gemini.
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
if [[ "$TASK" == report && "${REVIEWER_AGENT:-gemini}" == claude ]]; then
  TASK_TEXT="$TASK_TEXT The reviews in this run were made by Claude, the same model family as you, not by an independent model. Say so at the top of the report, so the manager weighs established findings accordingly."
fi

PROMPT="$(sed "s|\$FACTORY|$FACTORY|g" "$FACTORY/worker/research/$ROLE.md")

## This run

- Study folder: research/$STUDY (the contract is the latest contract.vN.json there).
- Task: $TASK_TEXT"

# The agent's full event stream (tool calls, refusals, errors), kept as an artifact.
AGENT_LOG="${AGENT_LOG:-$RUNNER_TEMP/agent-log.jsonl}"
show_log_tail() {
  echo "::group::Last agent events (full log in the agent-log artifact)"
  tail -n 40 "$AGENT_LOG" 2>/dev/null | cut -c1-400 || true
  echo "::endgroup::"
}

cd "$PROJECT"
FETCH="node $FACTORY/scripts/research-fetch.ts"
CHECK="node $FACTORY/scripts/research-guard.ts"

# Which program runs the step. The researcher is always Claude. The reviewer is
# Gemini unless the owner chose Claude for this run (REVIEWER_AGENT=claude).
AGENT=claude
if [[ "$ROLE" == reviewer ]]; then
  AGENT="${REVIEWER_AGENT:-gemini}"
  [[ "$AGENT" == gemini || "$AGENT" == claude ]] || { echo "::error::reviewer-agent must be gemini or claude." >&2; exit 2; }
fi
[[ "$ROLE" == researcher || "$ROLE" == reviewer ]] || { echo "Unknown role $ROLE" >&2; exit 2; }

if [[ "$AGENT" == claude ]]; then
  : "${CLAUDE_CODE_OAUTH_TOKEN:?CLAUDE_CODE_OAUTH_TOKEN secret is missing}"
  if [[ "$ROLE" == reviewer ]]; then
    # Same write limits as the Gemini reviewer: reviews and its own evidence only.
    WRITABLE=("Write(research/$STUDY/reviews/**)" "Write(research/$STUDY/evidence/**)")
    echo "Reviewer: Claude (${MODEL:-claude-opus-5-5}). The review is not independent of the researcher's model family."
  else
    WRITABLE=("Write(research/$STUDY/**)" "Edit(research/$STUDY/**)")
  fi
  npm install --global --no-fund --no-audit "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" >/dev/null
  # dontAsk: anything not listed below is refused, never prompted.
  claude -p "$PROMPT" \
    --model "${MODEL:-claude-opus-5-5}" \
    --permission-mode dontAsk \
    --allowedTools "Read" "Glob" "Grep" "WebSearch" "WebFetch" \
      "${WRITABLE[@]}" \
      "Bash($FETCH:*)" "Bash($CHECK)" \
    --output-format stream-json --verbose > "$AGENT_LOG" || { show_log_tail; exit 1; }
  # The last stream event is the final result; print its text for the job log.
  node -e '
    const lines = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1] || "{}");
    console.log(last.result ?? "(no final result in the agent log)");
    if (last.is_error) process.exit(1);
  ' "$AGENT_LOG" || { show_log_tail; exit 1; }
else
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
  # An unknown model must fail at once, not leave the agent retrying until the timeout.
  MODELS="$(agy models)"
  if [[ -z "${MODEL:-}" ]] || ! cut -f1 <<<"$MODELS" | grep -qxF "$MODEL"; then
    echo "::error::Reviewer model '${MODEL:-}' is not available. Choose one of these (first column):" >&2
    echo "$MODELS" >&2
    exit 1
  fi
  echo "Reviewer model: $MODEL"
  agy -p "$PROMPT" --model "$MODEL" --print-timeout 35m --output-format stream-json > "$AGENT_LOG" \
    || { show_log_tail; exit 1; }
  tail -c 4000 "$AGENT_LOG"; echo
fi

echo "::group::Research guard"
node "$FACTORY/scripts/research-guard.ts"
echo "::endgroup::"
