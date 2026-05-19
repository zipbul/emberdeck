#!/usr/bin/env bash
# emberdeck Skill gate enforcer (PreToolUse Bash hook).
# Blocks ed CLI mutating commands unless a structured, fresh, single-use marker exists.
# Design: simple+strong (key-value marker, content validation, 5-min TTL, single-use).
# See SKILL.md HC-0.

set -euo pipefail

input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id // "default"')
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# Mutating ed commands (read-only ones skip the gate).
mutating_re='(^|[[:space:];&|]+)([^[:space:];&|]*/)?ed[[:space:]]+(card[[:space:]]+(create|update|delete|rename|set-status)|bulk[[:space:]]+(create|sync)|glossary[[:space:]]+(define|remove|rename)|spec[[:space:]]+(sync|sync-symbols)|reset)([[:space:]]|$)'

# Script-bypass: interpreters touching .emberdeck/cards/ or piping into bulk create --from.
bypass_re='^[[:space:]]*(python[0-9.]*|node|deno|bun|ruby|perl|awk|sed)[[:space:]].*(\.emberdeck/cards|ed[[:space:]]+bulk[[:space:]]+create.*--from)'

deny() {
  jq -nc --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

if echo "$cmd" | grep -qE "$bypass_re"; then
  deny "emberdeck script-bypass blocked. Scripting language touching .emberdeck/cards/ or piping into ed bulk create --from. Card SoT is the YAML body; generating it via script breaks per-card review (HC-3). Write staging JSON manually with Write tool, then ed bulk create --from <staging>.json directly."
fi

if ! echo "$cmd" | grep -qE "$mutating_re"; then
  echo "{}"; exit 0
fi

marker="/tmp/claude-emberdeck-gate-${session_id}"

unlock_help="To unlock (per mutation):
1. Skill(emberdeck) invoke (if returning from non-card work)
2. Emit <card_analysis> for the card(s), receive user confirm
3. Emit <self_review> with all HC1..HC4 PASS
4. Write structured marker to ${marker} with these EXACT lines:
   SKILL: emberdeck
   KEY: <card-key-or-BATCH>
   ANALYSIS_LEN: <integer >=500>
   SELFREVIEW: HC1=ok HC2=ok HC3=ok HC4=ok
   USER_CONFIRMED: yes
5. Re-run the ed command. Marker is SINGLE-USE (deleted on pass) + 5-min TTL."

[ -f "$marker" ] || deny "emberdeck HC-0: marker missing. ${unlock_help}"

age=$(( $(date +%s) - $(stat -c %Y "$marker") ))
[ "$age" -lt 300 ] || deny "emberdeck HC-0: marker stale (age ${age}s > 300s TTL). ${unlock_help}"

grep -q "^SKILL: emberdeck$" "$marker" || deny "emberdeck HC-0: marker missing 'SKILL: emberdeck' line."
grep -q "^KEY: " "$marker" || deny "emberdeck HC-0: marker missing 'KEY: <card-key-or-BATCH>' line."
grep -q "^SELFREVIEW: HC1=ok HC2=ok HC3=ok HC4=ok$" "$marker" || deny "emberdeck HC-0: 'SELFREVIEW: HC1=ok HC2=ok HC3=ok HC4=ok' line missing or has a non-ok item. Fix the failing HC and retry."
grep -q "^USER_CONFIRMED: yes$" "$marker" || deny "emberdeck HC-0: 'USER_CONFIRMED: yes' line missing. Get explicit user confirm on the <card_analysis> table before writing the marker."
analysis_len=$(grep "^ANALYSIS_LEN: " "$marker" | sed 's/^ANALYSIS_LEN: //' | head -1)
[ "${analysis_len:-0}" -ge 500 ] 2>/dev/null || deny "emberdeck HC-0: ANALYSIS_LEN must be >=500 (got '${analysis_len:-missing}'). A hollow <card_analysis> means HC-2 was skipped."

# Single-use: consume the marker so the next mutation must re-engage HC-1..4.
rm -f "$marker"
echo "{}"
exit 0
