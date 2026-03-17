---
name: emberdeck
description: Design knowledge management for codebases using Emberdeck MCP tools. Trigger when the user asks to build, change, fix, or refactor code in a project with emberdeck configured. Also trigger on "/emberdeck" or when the user asks about specs, design cards, or acceptance criteria.
---

# Emberdeck

Check design knowledge before changing code. Verify consistency after changing code.
Never directly read/write `.emberdeck/cards/*.card.md` files. Use `emberdeck_*` MCP tools only.

## Before every call to emberdeck_create_card

You MUST first output your analysis to the user showing:

1. **Most fragile invariant** — what condition in this code is easiest to accidentally break?
2. **Why this approach** — what alternative was considered and why was it rejected?
3. **Uninformed agent risk** — what mistake would an agent make if they modified this code without reading this card?
4. **Scope boundary** — what does this code deliberately NOT do?

If you cannot answer these from the code you've read, you have not analyzed deeply enough — go back and read more. For new features where code doesn't exist yet, ask the user about policies, constraints, and non-goals instead.

After outputting the analysis, ask yourself before proceeding:
- What am I **most uncertain about** in this analysis?
- What did I **initially dismiss** that deserves a second look?

Revise if reflection reveals gaps. Then get user confirmation before calling `emberdeck_create_card`.

## When to act

### Building a feature

1. `emberdeck_find_affected_cards` — find related cards
2. If cards exist: `emberdeck_get_card` — read design intent, acceptance criteria, constraints. Work within them.
3. If no card covers this feature: analyze the code, then create a card (the rule above applies).
4. Write code within the card's constraints
5. `emberdeck_validate_code_links` — verify consistency
6. If acceptance criteria are satisfied: `emberdeck_verify_acceptance`

### Fixing a bug

1. `emberdeck_find_affected_cards` — check if the buggy code has a card
2. If card exists: read it. Fix within the card's invariants.
3. `emberdeck_validate_code_links` after fix
4. If the bug reveals a design flaw: update the card body and acceptance criteria

### Bug escalates to structural problem

1. `emberdeck_get_relation_graph` — map the blast radius through card dependencies
2. `emberdeck_pre_change_check` — identify all at-risk acceptance criteria
3. `emberdeck_check_interactions` — find cross-card conflicts
4. Update or recreate affected cards before rewriting code (the create rule above applies to each new card)
5. Refactor code, then `emberdeck_validate_code_links` on all affected cards

### Refactoring

1. `emberdeck_find_affected_cards` on files being refactored
2. `emberdeck_pre_change_check` — understand impact
3. If invariants change: update card body and acceptance criteria first
4. If invariants don't change: refactor code, then verify links

### Trivial change (typo, formatting, comments)

No card action needed.

### Checking spec health

1. `emberdeck_check_drift` — overall or per-card staleness
2. `emberdeck_validate_cards` — DB-file consistency
3. `emberdeck_sync_spec_annotations` — sync @spec comments
4. `emberdeck_list_unverified` — outstanding acceptance criteria
5. Report findings and suggest actions

## Before every call to emberdeck_update_card (body change)

When updating a card's body, apply the same analysis as creation: re-read the code, verify your 4-point analysis still holds, and show the revised analysis to the user before calling `emberdeck_update_card`.

## Body guide

The body captures knowledge that code cannot express:

- **Why** — design rationale, rejected alternatives, trade-offs
- **Invariants** — conditions that must hold across changes
- **Scope boundaries** — what this deliberately does NOT do
- **Edge cases** — boundary behavior, failure modes
- **Failure history** — past bugs and why they happened

Do NOT put file paths or function signatures in the body — use `codeLinks` for that.

## Card fields

- `slug` — short identifier
- `summary` — one line
- `type` — feature / bug / refactor / spike / decision
- `priority` — critical / high / medium / low
- `body` — design knowledge (see body guide)
- `acceptance` — 3-5 testable criteria, `{id, description, verified}`
- `relations` — `{type, target}` linking to other cards
- `codeLinks` — `{kind, file, symbol}` linking to code
- `keywords`, `tags`, `constraints` — as needed

## When to create cards

- New module, feature, or significant component — always
- Bug fix that reveals a design flaw — create or update
- Refactor that changes invariants — update existing card
- Trivial fixes, formatting, dependency bumps — no card needed
