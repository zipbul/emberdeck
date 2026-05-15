#!/usr/bin/env bash
# emberdeck Skill gate enforcer (PreToolUse Bash hook).
# Blocks ed CLI mutating commands unless a turn-local marker exists.
# Marker is written by Claude AFTER:
#   (1) Skill(emberdeck) invoke
#   (2) <card_analysis> + user confirm
#   (3) <self_review> passes
# See SKILL.md HC-0.

set -euo pipefail

input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id // "default"')
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# Match emberdeck mutating ed commands only. Read-only ones (get/list/search/tree/
# context/relations/export-to-stdout/validate/check/analyze/glossary lookup/init)
# do NOT need the gate.
mutating_re='(^|[[:space:];&|]+)ed[[:space:]]+(card[[:space:]]+(create|update|delete|rename|set-status)|bulk[[:space:]]+(create|sync)|glossary[[:space:]]+(define|remove|rename)|spec[[:space:]]+(sync|sync-symbols)|reset)([[:space:]]|$)'

if ! echo "$cmd" | grep -qE "$mutating_re"; then
  # Not a card-mutating ed invocation. Allow.
  echo "{}"
  exit 0
fi

marker="/tmp/claude-emberdeck-gate-${session_id}"

if [ -f "$marker" ]; then
  # Marker fresh if modified within the last hour.
  age=$(( $(date +%s) - $(stat -c %Y "$marker") ))
  if [ "$age" -lt 3600 ]; then
    echo "{}"
    exit 0
  fi
fi

# Deny. Tell Claude exactly how to unlock.
jq -nc --arg sid "$session_id" --arg cmd "$cmd" '
{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: (
      "emberdeck SKILL HC-0 violation — card-mutating ed command (`" +
      ($cmd | split(" ")[0:4] | join(" ")) +
      " ...`) blocked because the Skill gate marker is missing or stale.\n\n" +
      "To unlock (this session):\n" +
      "  1. Invoke the emberdeck Skill (Skill tool with skill=\"emberdeck\")\n" +
      "  2. Emit <card_analysis> table for the N cards being touched, get explicit user confirm\n" +
      "  3. Run <self_review>; if any item fails, fix first\n" +
      "  4. Write the marker: `touch /tmp/claude-emberdeck-gate-" + $sid + "` (Bash tool)\n" +
      "  5. Re-run the ed command. The marker stays valid for 1 hour (multiple ed calls OK).\n\n" +
      "Skipping these steps invites SSOT-DB divergence — the whole purpose of HC-1/2/3/4."
    )
  }
}'
