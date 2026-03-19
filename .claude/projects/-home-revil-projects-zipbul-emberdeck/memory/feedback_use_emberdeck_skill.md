---
name: Always use emberdeck skill first
description: Emberdeck-related tasks must use /emberdeck skill, not raw agents or tool searches
type: feedback
---

Always use the `/emberdeck` skill for any Emberdeck-related task, even if the task seems like simple exploration (e.g., checking card types, listing cards).

**Why:** The user explicitly expects the skill to be the entry point for all Emberdeck workflows. Using agents or raw tool searches instead signals that the skill is being ignored or considered insufficient.

**How to apply:** When the user's request involves cards, specs, or any Emberdeck concept, invoke the `/emberdeck` skill first. Only fall back to direct tool calls or agents if the skill genuinely doesn't cover the use case.
