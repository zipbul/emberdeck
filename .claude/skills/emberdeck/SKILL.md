---
name: emberdeck
description: Spec-driven development workflows using Emberdeck MCP tools. Orchestrates design cards — scanning for affected specs, creating new specs, pre-commit validation, and health checks. Use this skill when the user says "/emberdeck", wants to scan specs before coding, create a design spec, review specs before commit, check spec health, or any workflow involving emberdeck cards. Also trigger when the user mentions spec-driven development, design cards, acceptance criteria tracking, or code-spec synchronization — even if they don't say "emberdeck" explicitly.
---

# Emberdeck — Spec-Driven Development Workflows

Emberdeck maintains design specs (cards) synchronized with code through MCP tools (`emberdeck:emberdeck_*`). This skill defines four workflows that orchestrate those tools. Each workflow specifies a goal and completion criteria — use whatever combination of emberdeck tools best achieves the goal.

**Cardinal rule:** Never directly read/write `.emberdeck/cards/*.card.md` files. The MCP layer guarantees DB-file consistency — direct edits break it.

## Sub-commands

| Invocation | Workflow |
|------------|----------|
| `/emberdeck` | Scan — start-of-work context |
| `/emberdeck spec` | Create a new design card |
| `/emberdeck review` | Pre-commit validation gate |
| `/emberdeck sync` | Health check & drift dashboard |

**Examples:**
- `/emberdeck` — scan before starting work
- `/emberdeck spec add WebSocket support for real-time card sync` — create spec with description
- `/emberdeck spec` — create spec interactively
- `/emberdeck review` — validate before committing
- `/emberdeck sync` — check overall spec health
- `check if there are specs for the files I changed` — triggers scan
- `I need to write a design card for the new export feature` — triggers spec

---

## Scan (`/emberdeck`)

**Goal:** Before starting work, understand what specs exist for the files being changed and identify coverage gaps.

**Completion criteria:**
- All affected cards identified (by file path and by symbol)
- Each affected card's status, acceptance criteria, constraints, and link health reported
- Relation graph shown for context
- Changed files without spec coverage listed
- Actionable next steps suggested (e.g., create missing specs, update stale ones)

**Output format:**
```
## Scan Results

### Affected Cards
- **card-key** (status) — summary
  - Unverified: [criteria list]
  - Constraints: [if any]
  - Link coverage: N resolved, N broken

### Relation Graph
[upstream/downstream dependencies]

### Interactions
[If multiple cards: shared symbols, conflicts]

### Coverage Gaps
[Changed files not covered by any card]

### Suggested Actions
- [actionable recommendations]
```

---

## Spec (`/emberdeck spec`)

**Goal:** Create a design card that captures knowledge code cannot express — rationale, invariants, scope boundaries, domain rules.

**Pipeline (do not skip steps):**

1. **Search** — check existing cards to avoid duplicates. If a related card exists, offer to update it instead.
2. **Gather** — collect design knowledge before writing the card. Done when all of:
   - Related cards' acceptance criteria and constraints reviewed (no contradictions with new card)
   - Relation graph of neighboring cards understood (what depends on what)
   - For existing code: source read, behavior analyzed, invariants inferred
   - For new features: user asked about policies, constraints, business rules, non-goals
   - Design rationale captured: what decision was made, what alternatives were rejected and why
3. **Draft** — assemble the card in free-form first. Reason about what an agent modifying this code would need to know that isn't visible in the code itself.
4. **Create** — call `emberdeck_create_card` with all fields:
   - `slug`, `summary`, `type`, `priority`
   - `body` — the design knowledge from step 2-3 (see body guide below)
   - `acceptance` — 3-5 testable criteria (`{id, description, verified}`)
   - `keywords`, `tags`, `relations`, `codeLinks`, `constraints`
5. **Confirm** — show the draft to the user before creation. Show how it fits the relation graph. Optionally transition to `accepted`.

**Body guide — what to write:**

The body captures knowledge that code alone cannot provide. It should contain some or all of:
- **Why** — design rationale, rejected alternatives, trade-offs made
- **Invariants** — conditions that must always hold across changes
- **Scope boundaries** — what this deliberately does NOT do (non-goals)
- **Domain rules** — business logic, regulatory constraints, formulas
- **Edge cases** — boundary behavior, failure modes, concurrency concerns
- **Failure history** — past bugs and why they happened (prevents recurrence)

**What NOT to put in body:** file paths, function signatures, symbol names — these belong in `codeLinks`.

**Example of a good body** (from the `card-model` card):
```markdown
## Invariants
- A card key is always a normalized slug: lowercase alphanumeric, hyphens, dots, underscores, slashes.
- `parseCardMarkdown(serializeCardMarkdown(card))` round-trips without data loss.

## Contracts
### card-key.ts
- `normalizeSlug(slug)`: Throws CardKeyError on empty string, `..` paths, consecutive separators.

## Edge Cases
- Slugs with mixed path separators (`foo\bar/baz`) normalize to `foo/bar/baz`.
- Empty body after frontmatter is valid (body = empty string).
```

**Output format:**
```
Created **slug**: "summary"
Type: feature | Status: draft/accepted | Criteria: N | Relations: [list]
```

---

## Review (`/emberdeck review`)

**Goal:** Validate code-spec consistency before committing. This is a quality gate — present a clear pass/fail verdict.

**Completion criteria:**
- Impact analysis run on changed files (affected cards, risk level)
- Code links validated and resolved for each affected card
- Drift checked for each affected card (>0.5 = stale, needs attention)
- Cross-card interactions analyzed if multiple cards affected
- Unverified acceptance criteria cross-referenced with changes — if changes satisfy criteria, mark them verified
- Regression guard run as final gate
- Stale specs offered for update, completed implementations offered for status transition

**Output format:**
```
## Pre-Commit Review: PASS / FAIL

### Impact: low/medium/high — N affected cards

### Code Links
- card-key: valid / broken (details)

### Drift
- card-key: score (fresh/stale)

### Acceptance Criteria
- card-key: "criterion" — verified / unverified

### Regression Guard: PASS / FAIL

### Actions Required
- [specific fixes needed]
```

---

## Sync (`/emberdeck sync`)

**Goal:** Full health check of the entire spec system. Detect and fix inconsistencies, report drift, coverage, and outstanding work.

**Completion criteria:**
- DB-file consistency validated (inconsistencies auto-fixed if possible)
- All cards inventoried by status
- Drift scores calculated for active cards (accepted/implementing)
- Code link coverage checked per card (resolved vs broken)
- @spec annotations in source code synced
- Symbol renames/moves synced
- Unverified acceptance criteria listed
- Recent change history shown for active cards
- Prioritized recommendations generated

**Output format:**
```
## Spec Health Dashboard

### Inventory
| Status | Count |
|--------|-------|
| draft | N |
| accepted | N |
| implementing | N |
| implemented | N |
| deprecated | N |

### Consistency: all synced / N issues

### Drift (active cards)
- card-key: score

### Link Coverage
[per-card breakdown]

### Spec Annotations
- N new links from @spec

### Unverified Criteria: N across M cards

### Recommendations
- [prioritized actions]
```
