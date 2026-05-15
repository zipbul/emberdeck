#!/usr/bin/env bash
# UserPromptSubmit hook: inject emberdeck CORE.md as additionalContext
# when the user prompt touches card-system intent. Detects with a keyword
# regex over the prompt. Output schema per Claude Code hooks docs:
#   {hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: "..."}}
# additionalContext is wrapped in a system-reminder block by the harness.

set -euo pipefail

input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt // ""')

# Keywords that indicate card-system intent. Conservative (avoid false-positive
# on every Korean prompt) — must contain at least one of the explicit emberdeck
# concepts or an ed CLI invocation pattern.
keyword_re='카드|spec|brief|domain|principle|glossary|emberdeck|\.emberdeck|ed card|ed bulk|ed validate|ed check|ed spec|ed glossary|ed analyze|ed init|ed reset|Phase 1\.|Phase 2\.|Phase 3\.|Phase 4\.'

if ! echo "$prompt" | grep -qE "$keyword_re"; then
  # Not card-related — no injection.
  echo "{}"
  exit 0
fi

# Card-related — inject CORE.md verbatim.
core_path="/home/revil/projects/zipbul/emberdeck/.claude/skills/emberdeck/CORE.md"
if [ ! -f "$core_path" ]; then
  echo "{}"
  exit 0
fi

core_content=$(cat "$core_path")

jq -nc --arg ctx "$core_content" '
{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: ("emberdeck card-system intent detected in this prompt. The following CORE rules MUST be checked BEFORE deciding how to execute. Do NOT bypass via script generation (Python/node/etc) — card data SoT is the YAML body, not generated output.\n\n" + $ctx)
  }
}
'
