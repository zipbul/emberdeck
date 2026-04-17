---
name: emberdeck
description: Design knowledge management for codebases using Emberdeck MCP tools. Trigger when the user asks to build, change, fix, or refactor code in a project with emberdeck configured. Also trigger on "/emberdeck" or when the user asks about specs, design cards, or acceptance criteria.
---

<rules>
<critical>
1. Read relevant cards before modifying code. Run `emberdeck_validate_code_links` after. Always.
</critical>
2. Show card analysis to user and get confirmation before creating any card.
3. Brief cards are design documents. When creating a brief card as a **brief** (기획서), structure the body with these 8 required sections using exact `## ` headings:
   - `## Motivation` — Why this exists. Problem statement, background.
   - `## Scope` — Goals and non-goals. What we will and will NOT do.
   - `## Scenario` — How users/consumers interact. Happy path flows.
   - `## Rule` — Internal business rules and policies we define.
   - `## Constraint` — External obligations we cannot change (regulations, compatibility, legal).
   - `## Risk` — Failure scenarios, hazards, known limitations, unresolved questions.
   - `## Criteria` — Success metrics, acceptance criteria.
   - `## Decision` — Alternatives considered and why we chose this approach.
   Run `emberdeck_validate_brief` before creating spec cards to verify completeness and content quality.
   Spec cards capture verifiable contracts bound to code. Only put non-discoverable knowledge in cards — function signatures, file paths, and tech stack details degrade agent performance.
4. Define glossary before creating cards. When `glossary.yaml` has entries, every new card requires a non-empty `glossary` field listing its primary topics. Multiple cards may declare the same term when they discuss it from different perspectives.
</rules>

<glossary_semantics>
The project glossary (`glossary.yaml`) is the single source of truth for domain vocabulary. Terms are **defined once** in the glossary and **referenced** by cards that discuss them.

The `glossary` field on a card = **topic scope declaration**: "this card discusses these domain concepts." It is NOT a text concordance (not every glossary word in the body), and NOT ownership (not "this card is the authority for this concept").

A card's glossary field should list the **primary topics** it addresses. Mentioning a term in passing does not require declaring it. Multiple cards declaring the same term is normal — different cards discuss the same concept from different perspectives.

**When to add a new term to the glossary** (criteria for `emberdeck_define_glossary`, NOT for selecting which existing terms go in a card's glossary field):

A term qualifies for the glossary when ALL four conditions are met:
1. **Project-specific semantics** — either the term does not appear in general dictionaries, OR it does but carries project-specific rules, decisions, or constraints that cannot be inferred from the dictionary meaning alone. (e.g., "glossary" is a dictionary word, but THIS project's glossary has all-or-nothing batch, global lock, file-first rename compensation — those rules are not dictionary-derivable, so the term qualifies.)
2. **Cross-cutting** — appears in 2+ cards or design areas
3. **Decision-bearing** — encodes a design decision
4. **Not a code symbol** — cannot be understood by reading a single class/function/type
</glossary_semantics>

<route_table>
Match the FIRST row whose signal is true, then follow the named workflow.

| # | Signal | Workflow |
|---|--------|----------|
| 1 | No `.emberdeck/` or 0 cards | onboarding |
| 2 | Cards exist, no `glossary.yaml` or 0 glossary entries | glossary-backfill |
| 3 | Code change affects card scope | feature |
| 4 | Code change outside all card scopes | feature (step 1 reveals uncovered files) |
| 5 | No code change (deps, CI, lint, docs) | skip card workflow |
| 6 | No modification intent | read cards for context only |
</route_table>

<workflows>

<workflow name="onboarding">
1. `emberdeck_analyze` — current state. Then `emberdeck_write_spec_annotations` to reconcile (removes orphan @spec from previous sessions, adds missing ones). Reconciler is idempotent.
2. **Read ALL source files** under `src/`. No sampling — read every file. For each file, apply the single-file test: "Can this knowledge be discovered by reading this one file alone?" If NO (it spans multiple files or encodes a cross-module contract), it MUST be carded. Collect:
   - Cross-module contracts (invariants enforced across 2+ files)
   - Failure handling policies (what happens when component X fails — involves caller + callee)
   - Architectural constraints (why this approach and not another — not visible in the code itself)
   - Ordering/priority decisions (e.g., DB before file, lock ordering, drift priority)
   Do NOT collect: function signatures, type definitions, schema columns, configuration values, single-file implementation details.
   **After reading, list every `src/ops/*.ts` file with its cross-module contracts. Show this audit to the user before proceeding.** If a file has no contracts worth carding, state why explicitly.
3. **Determine card boundaries by change independence.** For each group of design decisions: "If decision A changes, must decision B also change?" If no → separate cards. Apply the splitting criteria in `<card_splitting>`.
4. **Identify brief areas first** (no body yet). For each independently designable area, draft only: candidate `key`, one-line `summary`, and the **primary topic** the brief will discuss. Show this outline to the user. This precedes glossary so glossary terms can be derived from real brief topics, not guessed in isolation.
5. Propose glossary to user (see glossary-proposal template — include Evidence column). The proposal MUST include: (a) terms derived from brief primary topics from step 4, (b) cross-cutting concepts surfaced from step 2. Get confirmation. `emberdeck_define_glossary`.
6. Create brief cards with full bodies (with `glossary` field). Show card-analysis template for each. Run `<self_review>` on each card before proposing.
7. Create spec cards under briefs (with `glossary`, `codeLinks`, `relations`). Run `<self_review>` on each card before proposing.
8. **COLLECTION REVIEW** — after creating all cards, before gates:
   (a) **Brief decomposition**: For each brief, count unrelated items in its Scope "Covers" list. 3+ unrelated items → split into separate briefs.
   (b) **Function coverage check**: For each `src/ops/*.ts` file, list all exported functions. For each exported function NOT referenced by any spec card's codeLinks, apply the counter-test: "Does this function have cross-module behavior that breaks if a caller changes assumptions?" If yes → add it to an existing spec's codeLinks or create a new spec card. A file being covered by one spec does NOT mean all functions in that file are covered.
   (c) **Glossary-brief alignment** (bidirectional):
       - Forward: For each glossary term, verify at least one brief primarily discusses this concept. If a glossary term has no governing brief → create a brief or revise glossary.
       - Reverse: For each brief, verify its primary topic exists as a glossary term. If not → define the term or reconsider whether the brief's scope is correct.
   Fix any issues found before proceeding to gates.
9. GATE: `emberdeck_validate_cards` — pass with 0 glossary-broken, 0 broken-chain, and 0 orphan-card warnings before finishing.
10. GATE: `emberdeck_get_link_coverage` — every file under `src/ops/` MUST be referenced by at least one spec card's codeLinks or boundary. If uncovered files exist, create spec cards for them.
11. `emberdeck_write_spec_annotations` — inject `@spec card-key` JSDoc tags into source code for all codeLinks.
</workflow>

<workflow name="glossary-backfill">
1. `emberdeck_lookup_glossary` — confirm empty.
2. Read existing card bodies and summaries. Extract domain terms meeting the 4 criteria.
3. Propose glossary to user (with Evidence column). `emberdeck_define_glossary`.
4. Update each card: `emberdeck_update_card` with `glossary` field.
5. GATE: `emberdeck_validate_cards` — pass with 0 glossary-broken warnings before finishing.
</workflow>

<workflow name="feature">
1. `emberdeck_pre_change_check` with files to modify. Response includes full `glossary` and affected cards.
   - critical risk: stop, show impact to user, get confirmation.
   - high risk: show affected cards to user, get confirmation.
   - medium/low risk: proceed.
2. `emberdeck_get_card` for each affected card — these are your constraints.
   - Direct cards: read full body. Transitive cards: summary only.
3. If no cards exist for the area: create brief card first (show card-analysis, include glossary), then spec cards. Run `<self_review>` before proposing each card.
4. Write code within card constraints.
5. If a new domain concept emerges: propose glossary entry to user → `emberdeck_define_glossary` → update affected cards' glossary fields.
6. If your change extends an existing spec's scope: update the spec card body and glossary field. Run `<self_review>` on the updated card.
7. GATE: `emberdeck_validate_code_links` — pass with 0 broken links before finishing.
8. `emberdeck_write_spec_annotations` — inject `@spec card-key` JSDoc tags for new/changed codeLinks.
</workflow>

</workflows>

<tool_protocol>

Glossary tools — when and how:

| Tool | When | Requires user confirmation |
|------|------|---------------------------|
| `emberdeck_define_glossary` | New domain concept or definition update. Batch up to 50. All-or-nothing validation. | Yes — show glossary-proposal first |
| `emberdeck_lookup_glossary` | Check a term's meaning, or list all terms at session start | No |
| `emberdeck_remove_glossary` | Domain concept eliminated from project. Cards referencing it become drifted. | Yes |
| `emberdeck_rename_glossary` | Domain concept rebranded. Auto-updates glossary + all card glossary fields. Card bodies need manual update. | Yes |
| `emberdeck_find_cards_by_glossary_word` | Find which cards declare a specific glossary word. Use to audit term usage or assess impact before removing/renaming. | No |
| `emberdeck_reset` | Delete all cards (DB + files), clear glossary. Run `emberdeck_write_spec_annotations` after to remove orphan @spec from source. | Yes |

Rename sequence:
1. `emberdeck_rename_glossary` with oldWord, newWord, optional definition.
2. `emberdeck_search_cards` for old word in card bodies.
3. `emberdeck_update_card` with bodyPatches to replace old word in each affected body.

Card creation — always include:
- `type`: brief (design documents) or spec (behavioral contracts)
- `glossary`: primary domain concepts this card discusses (required when glossary.yaml exists)
- `parent`: required for spec cards (must be a brief or spec card)
- `codeLinks`: required for spec cards
- `relations`: spec cards relate to at least one brief card
- `boundary`: file glob patterns this card is responsible for (recommended for specs)

</tool_protocol>

<card_analysis_template>
Show this to the user before every card creation:

```
### Card analysis: {key}
- **Type**: brief | spec
- **Glossary**: [{primary domain concepts this card discusses}]
- **Must guarantee**: {what this card ensures}
- **Excluded**: {what is deliberately out of scope}
- **Breaks if violated**: {concrete consequence}
```
</card_analysis_template>

<glossary_proposal_template>
Show this to the user before calling `emberdeck_define_glossary`:

```
### Glossary proposal
| Word | Definition | Evidence |
|------|-----------|---------|
| {word} | {definition} | {which areas use it, what decision it encodes, why non-obvious} |

Register?
```
</glossary_proposal_template>

<error_recovery>

When `emberdeck_validate_cards` reports warnings:

| Warning | Cause | Recovery |
|---------|-------|----------|
| glossary-broken | Card declares a glossary word that no longer exists in glossary.yaml | `emberdeck_define_glossary` to re-add, or `emberdeck_update_card` to remove the word from the card's glossary field |
| glossary-unused | Glossary word not declared by any card | Informational — consider creating a card that discusses this concept or removing the glossary entry |
| content-mismatch | DB and file diverged | `emberdeck_export_card_to_file` to regenerate file from DB |
| broken-chain | Spec card has no link to any brief card | Add a relation or parent to a brief card |

When `emberdeck_validate_code_links` finds broken links:
1. Check if the symbol was renamed → `emberdeck_sync_symbol_changes`.
2. Check if the file was moved → update the card's codeLinks.
3. If the symbol was intentionally removed → update or delete the card.

</error_recovery>

<card_types>

## brief — Design document

A brief card answers: **"What are we building, why, and under what constraints?"**

It is a design document that defines the problem, goals, user scenarios, requirements, success criteria, and scope boundaries for a domain area. Spec cards are derived from brief cards — no spec exists without a brief that justifies it. No codeLinks. Can be root card.

### REQUIRED content in brief body:

**Problem & Goals** — What problem this design solves and what outcomes it achieves. Be specific: who has the problem, what breaks without this, what success looks like.

**User Scenarios** — Prioritized (P1/P2/P3) scenarios describing how the system is used. Each scenario must be independently testable with Given/When/Then acceptance criteria.

**Requirements** — Numbered requirements (R-001, R-002, ...) using RFC 2119 keywords (MUST, SHALL, SHOULD, MAY). Each requirement must be testable and unambiguous.

**Success Criteria** — Measurable outcomes that define when the design is fulfilled. Technology-agnostic, verifiable without knowing implementation.

**Scope & Constraints** — What this design covers, what it explicitly excludes, and what assumptions were made.

### GOOD brief card body:

```
## Problem & Goals
Agents modifying code need to know which design decisions govern each area. Without this, agents silently violate cross-module contracts. Goal: every code change is checked against its governing design before execution.

## User Scenarios

### P1: Agent reads design before code change
Given an agent is about to modify src/ops/create.ts,
When it calls pre_change_check with the file path,
Then it receives affected cards, risk level, and must read each card before proceeding.

### P2: Drift detected after code change
Given a spec card is active with resolved codeLinks,
When the linked symbol is renamed or deleted,
Then the card auto-transitions to drifted status in both DB and file.

## Requirements
- R-001: System MUST store every card in both DB and markdown file (dual-storage invariant).
- R-002: System MUST reject spec card activation when any codeLink is unresolved.
- R-003: System MUST auto-detect drift via 4 mechanisms: broken_link, boundary_inactive, symbol_changed, glossary_broken.
- R-004: System MUST compensate DB changes when file write fails after DB commit.

## Success Criteria
- SC-001: 0 broken codeLinks on active spec cards at any point in time.
- SC-002: Every code change to a card-covered file is preceded by pre_change_check.
- SC-003: Drifted cards are detected within one check_drift cycle — no silent drift.

## Scope & Constraints
- Covers: card lifecycle, dual-storage, drift detection, code binding, glossary enforcement.
- Excludes: code generation, linting, CI, test automation, workflow orchestration.
- Assumes: gildash is available for symbol resolution when projectRoot is set.
```

### BAD brief card body (common mistakes):

- ✗ Code structure: "The system uses SQLite with Drizzle ORM. Cards are stored in the card table."
- ✗ Abstract policy only: "Always: Card is source of truth." (policy without scenarios, requirements, or success criteria)
- ✗ Implementation detail: "writeCardFile uses atomic rename via temp file."
- ✗ Task list: "1. Add migration 2. Update schema 3. Write tests" (execution plan, not design)

---

## spec — Behavioral contract bound to code

A spec card answers: **"What does the system guarantee?"**

It captures verifiable behavioral contracts bound to specific code symbols via codeLinks. Every spec card MUST relate to at least one brief card — a contract without governing design is rootless. Requires codeLinks.

### REQUIRED sections in spec body (3 sections, exact `## ` headings):

1. `## Contract` — Behavioral guarantees using GIVEN/WHEN/THEN with RFC 2119 keywords (MUST, SHALL, SHOULD, MAY). Each contract is one testable guarantee. Precondition (GIVEN) is separated from trigger (WHEN) and postcondition (THEN).

2. `## Invariant` — Conditions that ALWAYS hold across all operations in this scope. Not triggered by specific calls — they are system-wide guarantees.

3. `## Failure` — Table mapping violations to system behaviors. Exhaustive enumeration of all error paths.

Active spec cards are **rejected** if any of these 3 sections is missing.

### GOOD spec card body:

```
## Contract
- GIVEN a spec card exists with codeLinks
  WHEN status is set to active
  THEN all codeLinks MUST resolve to existing symbols via gildash.
  IF any link fails, activation MUST be rejected with ActivationGuardError.
- GIVEN a card has children
  WHEN deleteCard is called with force=true
  THEN children MUST become orphans (parent=null)
  AND relations MUST be cleaned up bidirectionally.

## Invariant
- DB and file representations of a card MUST be consistent after every mutation.
- An active spec card MUST have at least 1 resolved codeLink at all times.

## Failure
| Violation | System behavior |
|-----------|----------------|
| codeLink target symbol deleted | Card auto-transitions to drifted |
| File write fails after DB commit | Compensation reverts DB change; CompensationError thrown if revert also fails |
```

### BAD spec card body (common mistakes):

- ✗ Policies: "We always use compensation pattern" (belongs in brief)
- ✗ Implementation: "deleteByKey() calls SQL DELETE WHERE key=?" (discoverable from code)
- ✗ Task list: "1. Add migration 2. Update schema 3. Write tests" (execution plan, not contract)
- ✗ Verification commands: "Run `bun test`" (tooling, not contract)
- ✗ File paths in body text (use codeLinks field instead)

---

## Summary: what goes where

| Content | brief | spec | Neither |
|---------|--------|------|---------|
| Motivation (why it exists) | ✓ | | |
| Scope (goals / non-goals) | ✓ | | |
| Scenario (user flows) | ✓ | | |
| Rule (business policies) | ✓ | | |
| Constraint (external obligations) | ✓ | | |
| Risk (failure scenarios) | ✓ | | |
| Criteria (success metrics) | ✓ | | |
| Decision (alternatives + rationale) | ✓ | | |
| Contract (GIVEN/WHEN/THEN code guarantees) | | ✓ | |
| Invariant (always-true conditions) | | ✓ | |
| Failure (violation → behavior table) | | ✓ | |
| Code structure descriptions | | | ✗ discoverable |
| File paths, class names | | | ✗ discoverable |
| Task checklists | | | ✗ execution plan |
| Verification commands | | | ✗ tooling |

Hierarchy: parent-child when scope is strict subset. Flat peers otherwise. Max 3 levels.

</card_types>

<card_splitting>
Deciding whether contracts belong in one card or should be split into separate cards.

**Split when ANY of these is true:**
1. **Change independence** — Contract A can drift while contract B remains valid. (e.g., createCard compensation logic vs bulkCreateCards topological sort — one can change without affecting the other.)
2. **Different codeLink files** — Contracts reference symbols in different source files. Boundary separation signals different domains.
3. **"X and Y" summary** — If the card summary uses "and" to join two unrelated capabilities, the card covers two topics.

**Merge when ALL of these are true:**
1. Contracts describe different input cases of the **same operation** (e.g., deleteCard with force=true vs force=false).
2. They share the **same codeLink set** — a change to any linked symbol affects all contracts equally.
3. One contract drifting **necessarily means** the others also drift.

**Brief decomposition:**
Each brief card should represent one **independently designable area** — an area where design decisions can be made without consulting other briefs. Signs of under-decomposition:
- Brief has 4+ direct spec children → consider splitting the brief
- Brief's Scope section lists 3+ unrelated "Covers" items → each is likely its own brief
- Brief's requirements span two unrelated subsystems → split by subsystem
</card_splitting>

<self_review>
Run on every card before creating or proposing. Any failure → revise and re-check.

The single-file test applies everywhere: "Can you discover this by reading ONE source file? If yes, it does not belong in a card. If it spans multiple files, it MUST be carded."

**Brief (5 checks):**
1. Every requirement fails the single-file test (cannot be found in one file alone)
2. Every success criterion has a number or zero-tolerance threshold
3. No implementation technology names in body (no WeakMap, FTS5, Drizzle, temp-rename, ON CONFLICT, WAL)
4. Every scenario has Given/When/Then verifiable without knowing implementation
5. Scope section states what is EXCLUDED, not just what is covered

**Spec (7 checks):**
1. Every contract states WHAT (behavior), not HOW (implementation mechanism)
2. No implementation mechanism names in body (no FK CASCADE, raw UPDATE, WeakMap, temp-rename, ON CONFLICT, upsert SQL, targeted UPDATE, WAL, atomic rename). Rewrite as behavioral guarantees: "FK CASCADE propagation" → "key change MUST propagate to all referencing records"
3. Failure mode table covers every error type the linked symbols throw
4. Splitting check (contract-level): if one contract changes, must ALL others also change? If not → split
5. **Splitting check (file-level)**: do `codeLinks` reference symbols in 2+ distinct source files? If yes, AND those files can change independently (per `<card_splitting>` rule #2), MUST split into one card per file
6. All codeLinks reference real, existing symbols (verify with grep)
7. `parent` field is set; `glossary` lists primary topics only
</self_review>

<model_notes>
- Fewer precise cards beat many vague ones — but every `src/ops/` file with cross-module contracts MUST have a spec card. "Fewer" means fewer than vague alternatives, not fewer than coverage requires.
- Call emberdeck tools directly — subagents lose card context.
- Always show the card-analysis template before creation, even when being concise elsewhere.
- Run `<self_review>` checklist on every card before proposing to user. A card that fails self-review wastes the user's time.
- Cards preserve what code cannot: design rationale, cross-module invariants, failure policies, scope boundaries. If deleting the card loses no knowledge, the card should not exist.
</model_notes>

<critical>
1. Read cards before modifying code. Run `emberdeck_validate_code_links` after. Always.
2. Run self_review on every card before creation or update. No exceptions.
3. Single-file test: can you discover this by reading ONE source file? Then it does not belong in a card. If it spans multiple files, it MUST be carded.
</critical>
