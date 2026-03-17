---
name: emberdeck
description: Design knowledge management for codebases using Emberdeck MCP tools. Trigger when the user asks to build, change, fix, or refactor code in a project with emberdeck configured. Also trigger on "/emberdeck" or when the user asks about specs, design cards, or acceptance criteria.
---

# Emberdeck

Emberdeck keeps design knowledge linked to code. Before changing code, check what design decisions constrain it. After changing code, verify nothing broke. Skipping this leads to silent invariant violations that compound over time.

**Never** directly read/write `.emberdeck/cards/*.card.md` files. Use `emberdeck_*` MCP tools only.

## Principle

Check before change. Verify after change.

## When to act

### User asks to build a feature

1. `emberdeck_search_cards` / `emberdeck_find_affected_cards` — find related cards
2. If cards exist: `emberdeck_get_card` — read design intent, acceptance criteria, constraints
3. If no card covers this feature: create one first
   - Read relevant code and ask the user about policies, constraints, non-goals
   - `emberdeck_create_card` with substantive body (see body guide below)
4. Write code within the card's constraints
5. `emberdeck_validate_code_links` — verify consistency
6. If acceptance criteria are satisfied: `emberdeck_verify_acceptance`

### User asks to fix a bug

1. `emberdeck_find_affected_cards` — check if the buggy code has a card
2. If card exists: read it. Fix within the card's invariants.
3. `emberdeck_validate_code_links` after fix
4. If the bug reveals a design flaw: update the card body and acceptance criteria

### Bug escalates to structural problem

1. `emberdeck_get_relation_graph` — map the blast radius through card dependencies
2. `emberdeck_pre_change_check` — identify all at-risk acceptance criteria
3. `emberdeck_check_interactions` — find cross-card conflicts
4. Update or recreate affected cards before rewriting code
5. Refactor code, then `emberdeck_validate_code_links` on all affected cards

### User asks to refactor

1. `emberdeck_find_affected_cards` on files being refactored
2. `emberdeck_pre_change_check` — understand impact
3. If invariants change: update card body and acceptance criteria first
4. If invariants don't change: refactor code, then verify links

### Trivial change (typo, formatting, comments)

No card action needed.

### User asks about spec health

1. `emberdeck_check_drift` — overall or per-card staleness
2. `emberdeck_validate_cards` — DB-file consistency
3. `emberdeck_sync_spec_annotations` — sync @spec comments
4. `emberdeck_list_unverified` — outstanding acceptance criteria
5. Report findings and suggest actions

## Creating cards

### When to create

- New module, feature, or significant component — always
- Bug fix that reveals a design flaw — create or update
- Refactor that changes invariants — update existing card

### When NOT to create

- Trivial fixes, formatting, dependency bumps
- Changes fully covered by an existing card

### Body guide

The body captures knowledge that code cannot express. Include:

- **Why** — design rationale, rejected alternatives, trade-offs
- **Invariants** — conditions that must hold across changes
- **Scope boundaries** — what this deliberately does NOT do
- **Edge cases** — boundary behavior, failure modes
- **Failure history** — past bugs and why they happened

Do NOT put file paths or function signatures in the body — use `codeLinks` for that.

### Before creating

1. `emberdeck_search_cards` — check for duplicates
2. Read existing related cards — no contradictions with new card
3. Understand the relation graph — what depends on what
4. For existing code: read the source, infer invariants
5. For new features: ask the user about policies, constraints, non-goals
6. Draft the body in free-form reasoning first, then structure it

### Fields

- `slug` — short identifier
- `summary` — one line
- `type` — feature / bug / refactor / spike / decision
- `priority` — critical / high / medium / low
- `body` — design knowledge (see guide above)
- `acceptance` — 3-5 testable criteria, `{id, description, verified}`
- `relations` — `{type, target}` linking to other cards
- `codeLinks` — `{kind, file, symbol}` linking to code
- `keywords`, `tags`, `constraints` — as needed
