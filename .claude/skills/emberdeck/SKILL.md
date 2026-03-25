---
name: emberdeck
description: Design knowledge management for codebases using Emberdeck MCP tools. Trigger when the user asks to build, change, fix, or refactor code in a project with emberdeck configured. Also trigger on "/emberdeck" or when the user asks about specs, design cards, or acceptance criteria.
---

# Emberdeck

Never directly read/write `.emberdeck/cards/*.card.md` files. Use `emberdeck_*` MCP tools only.

## Critical rules

These three rules are non-negotiable. Every other section is reference material.

1. **intent cards capture decisions not visible in code; spec cards capture verifiable contracts bound to code.** Intent cards do not need codeLinks. Spec cards require codeLinks and must relate to at least one intent card (enforced by `validate_cards`). Do not put discoverable information (function signatures, directory layout, tech stack) in any card — it degrades agent performance (ETH Zurich ICSE JAWs 2026: -2-3%).

2. **Before creating any card, show your analysis to the user and get confirmation.** Use this exact template:

```
### Card analysis: {key}
- **Must guarantee**: {what this card ensures}
- **Excluded**: {what is deliberately out of scope}
- **Breaks if violated**: {concrete consequence}
```

Do not create cards without this output. Do not skip fields. Applies to every card in `emberdeck_bulk_create_cards`.

3. **Read relevant cards before modifying code. Run `emberdeck_validate_code_links` after.** This is also in CLAUDE.md so it applies even when this skill is not loaded. Do not modify code without checking cards. Do not skip validation after changes.

## Route your task first

Before starting work, determine your task type:

| Signal | Task type | Workflow |
|--------|-----------|----------|
| No `.emberdeck/` or 0 cards | **Onboarding** | Analyze codebase → create intent cards → create spec cards |
| Cards exist, code change affects card scope | **Feature / Bug fix / Refactor** | Read cards → work within constraints → validate |
| Cards exist, code change is outside all card scopes | **Uncovered area** | `emberdeck_pre_change_check` → decide if new cards needed |
| No code change (deps, CI, lint, docs) | **Chore** | Skip card workflow entirely — no card reads or validation needed |
| No modification intent | **Exploration** | Read cards for context only — no validation needed |

Do not run the full card workflow for chores. Do not skip card reads for code changes that touch card scopes.

## Card types

### intent — upstream decisions (why, what, what not)

Content that gets lost between conversations because it is not in the code:
- Why this exists (problem, need, motivation)
- What is in scope and what is deliberately excluded
- Decisions and constraints, with reasoning
- Policies (always/never rules)

No codeLinks needed. No boundary needed. Can be a root card (no parent).

### spec — downstream contracts (verifiable behaviors)

Contracts that code must satisfy, written so an agent can verify compliance:
- Verifiable behaviors (WHEN condition THEN expected result)
- Known failure modes (symptom, cause, resolution)
- Hidden cross-module contracts that reading one file alone would not reveal

codeLinks required. Must relate to at least one intent card (via relation or parent chain).

### Hierarchy guidance

- Create a **parent-child** relationship when one card's scope is a strict subset of another (e.g., `auth` intent → `auth-token-validation` spec).
- Keep cards **flat** (no parent, just relations) when they are peers at the same abstraction level.
- Do not nest deeper than 3 levels — deeper hierarchies add navigation cost without value.

## Body content examples

### Good intent body

```markdown
## Why
Users need in-app communication without switching to external tools.

## Scope
- 1:1 text messaging only. Group chat deferred to v2.
- Real-time delivery via persistent connection. No offline queue.

## Decisions
- WebSocket chosen over polling: latency under 100ms required for "real-time" feel. Polling at 1s interval was tested and felt sluggish.
- No end-to-end encryption: internal enterprise tool, network is trusted.

## Excluded
- File attachments — separate feature if needed
- Read receipts — not requested, adds complexity
```

### Bad intent body — do not write like this

```markdown
## Overview
The chat module is in src/chat/ and has 3 files. It uses WebSocket
via the ws library and stores messages in SQLite using drizzle-orm.

## Functions
- sendMessage(content: string): Promise<void>
- onMessage(handler: MessageHandler): void
```

Why bad: everything here is discoverable by reading code. Wastes tokens and degrades performance.

### Good spec body

```markdown
## Contracts
- WHEN a message is sent THEN it is persisted before delivery confirmation
- WHEN the connection drops THEN reconnection resumes from the last received message sequence number
- WHEN two messages are sent in sequence THEN they arrive in the same order

## Failure modes
| Symptom | Cause | Resolution |
|---------|-------|------------|
| Messages arrive out of order | Sequence number not checked on reconnect | Compare server sequence with client last-seen |

## Cross-module contracts
- MessageService depends on ConnectionManager for transport — if reconnect behavior changes, this spec must be re-verified
```

### Bad spec body — do not write like this

```markdown
## Description
MessageService handles message sending and receiving. It has methods
for creating, reading, and deleting messages. The service ensures
messages are delivered properly.
```

Why bad: no WHEN/THEN contracts, no failure modes, no cross-module contracts. A description, not a specification.

## Workflows

### Building a feature

1. `emberdeck_pre_change_check` with the files you plan to modify. This tells you which cards are affected and at what risk level — use the result to decide which cards to read.
   - If risk is **critical**: stop and ask the user before proceeding.
   - If risk is **high**: show affected cards to the user, get confirmation.
   - If risk is **medium/low**: proceed.
2. `emberdeck_get_card` for each affected card — these contracts are your implementation constraints.
   - For directly affected cards: read full body.
   - For transitive cards: read summary only (they are context, not constraints).
3. If no cards exist for the area: create intent card first (rule 2 applies), then spec cards with relations to it.
4. Write code **within card constraints**. Do not violate WHEN/THEN contracts.
5. If your feature extends an existing spec's scope (new behavior, new contract), update the spec card to reflect the new contract before finishing.
6. `emberdeck_validate_code_links` — this confirms your changes did not break any spec-to-code links. If broken links found, fix code or update cards before finishing.

Do not skip step 1. Do not skip step 6. Do not write code before reading affected cards.

### Fixing a bug

1. `emberdeck_find_cards_by_symbol` for the buggy symbol/file. This tells you if there is a spec governing this code — a bug is often a contract violation.
2. If card exists: `emberdeck_get_card` — read the contracts to understand what the code must satisfy.
3. Fix the bug **within card constraints**.
4. `emberdeck_validate_code_links` — this confirms the fix did not break spec links.
5. If the bug reveals a missing contract: update the card to add it (prevents recurrence in future conversations).

Do not fix bugs without checking if the affected code has a spec card.

### Refactoring

1. `emberdeck_pre_change_check` with all files in refactoring scope. This tells you every card that could be affected — refactoring must preserve all their contracts.
   - If risk is **critical/high**: show full impact to user, get confirmation.
2. `emberdeck_get_card` for all affected cards — these contracts are your invariants. Every WHEN/THEN must still hold after refactoring.
3. Refactor code within those invariants.
4. If the refactoring changes a module's responsibility or contract (not just internal structure), update the affected spec cards to reflect the new contract.
5. `emberdeck_validate_code_links` — this catches broken links from renamed/moved symbols.
6. `emberdeck_sync_symbol_changes` — this updates card codeLinks to match the new symbol names/locations.

Do not refactor without running impact analysis first. Do not skip steps 5-6 after renames.

### Onboarding (new project or uncovered area)

1. `emberdeck_analyze` — understand current coverage.
2. Read the codebase to identify design decisions not visible in code.
3. Create intent cards first (top-level decisions, scope, constraints).
4. Create spec cards under intents (verifiable contracts with codeLinks).
5. `emberdeck_validate_cards` — check structural integrity.

Do not create spec cards without a parent or related intent card.

### Checking spec health

1. `emberdeck_analyze` — full project health report.
2. `emberdeck_validate_cards` — structural warnings (broken chains, orphans).
3. If drifted cards found: read each, determine if code or card needs updating.

## Model-specific notes

- You tend to over-engineer cards. Fewer, precise cards are better than many vague ones.
- You tend to spawn subagents for card operations. Call emberdeck tools directly — subagents lose the card context.
- The system prompt tells you to be concise. Rule 2 (show analysis before creating) is an exception — show the full template even when being concise elsewhere.

---

**REMINDER: Read cards before modifying code. Validate code links after. Do not skip these steps.**
