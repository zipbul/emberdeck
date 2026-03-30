---
name: emberdeck
description: Design knowledge management for codebases using Emberdeck MCP tools. Trigger when the user asks to build, change, fix, or refactor code in a project with emberdeck configured. Also trigger on "/emberdeck" or when the user asks about specs, design cards, or acceptance criteria.
---

<rules>
1. Read relevant cards before modifying code. Run `emberdeck_validate_code_links` after. Always.
2. Show card analysis to user and get confirmation before creating any card.
3. Intent cards are design documents: problem, goals, user scenarios, requirements, success criteria, scope. Spec cards capture verifiable contracts bound to code. Only put non-discoverable knowledge in cards — function signatures, file paths, and tech stack details degrade agent performance.
4. Define glossary before creating cards. When `glossary.yaml` has entries, every new card requires a non-empty `glossary` field. Use canonical glossary words in card bodies, summaries, and code symbol names.
</rules>

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
2. Read codebase. Identify domain concepts and design decisions not visible in code.
3. Propose glossary to user (see glossary-proposal template). Get confirmation. `emberdeck_define_glossary`.
4. Create intent cards (with `glossary` field). Show card-analysis template for each.
5. Create spec cards under intents (with `glossary`, `codeLinks`, `relations`).
6. GATE: `emberdeck_validate_cards` — pass with 0 glossary-broken and 0 broken-chain warnings before finishing.
7. `emberdeck_write_spec_annotations` — inject `@spec card-key` JSDoc tags into source code for all codeLinks.
</workflow>

<workflow name="glossary-backfill">
1. `emberdeck_lookup_glossary` — confirm empty.
2. Read existing card bodies and summaries. Extract domain terms.
3. Propose glossary to user. `emberdeck_define_glossary`.
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
3. If no cards exist for the area: create intent card first (show card-analysis, include glossary), then spec cards.
4. Write code within card constraints.
5. If a new domain concept emerges: propose glossary entry to user → `emberdeck_define_glossary` → update affected cards' glossary fields.
6. If your change extends an existing spec's scope: update the spec card body and glossary field.
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
- `glossary`: words from project glossary this card uses (required when glossary.yaml exists)
- `type`: intent (decisions) or spec (contracts)
- `codeLinks`: required for spec cards
- `relations`: spec cards relate to at least one intent card

</tool_protocol>

<card_analysis_template>
Show this to the user before every card creation:

```
### Card analysis: {key}
- **Type**: intent | spec
- **Glossary**: [{words from project glossary}]
- **Must guarantee**: {what this card ensures}
- **Excluded**: {what is deliberately out of scope}
- **Breaks if violated**: {concrete consequence}
```
</card_analysis_template>

<glossary_proposal_template>
Show this to the user before calling `emberdeck_define_glossary`:

```
### Glossary proposal
| Word | Definition |
|------|-----------|
| {word} | {definition} |

Register?
```
</glossary_proposal_template>

<error_recovery>

When `emberdeck_validate_cards` reports warnings:

| Warning | Cause | Recovery |
|---------|-------|----------|
| glossary-broken | Card references a glossary word that was removed | `emberdeck_define_glossary` to re-add, or `emberdeck_update_card` to remove the word from the card's glossary field |
| glossary-unused | Glossary word not referenced by any card | Informational — consider creating a card for this concept or removing the glossary entry |
| glossary-undeclared-usage | Card body mentions a glossary word not in its glossary field | `emberdeck_update_card` to add the word to the card's glossary field |
| glossary-phantom-declaration | Card declares a glossary word absent from its body/summary | Remove from glossary field, or add the term to the card body |
| content-mismatch | DB and file diverged | `emberdeck_export_card_to_file` to regenerate file from DB |
| broken-chain | Spec card has no link to any intent card | Add a relation or parent to an intent card |

When `emberdeck_validate_code_links` finds broken links:
1. Check if the symbol was renamed → `emberdeck_sync_symbol_changes`.
2. Check if the file was moved → update the card's codeLinks.
3. If the symbol was intentionally removed → update or delete the card.

</error_recovery>

<card_types>

## intent — Design document

An intent card answers: **"What are we building, why, and under what constraints?"**

It is a design document (기획서) that defines the problem, goals, user scenarios, requirements, success criteria, and scope boundaries for a domain area. Spec cards are derived from intent cards — no spec exists without an intent that justifies it. No codeLinks. Can be root card.

### REQUIRED content in intent body:

**Problem & Goals** — What problem this design solves and what outcomes it achieves. Be specific: who has the problem, what breaks without this, what success looks like.

**User Scenarios** — Prioritized (P1/P2/P3) scenarios describing how the system is used. Each scenario must be independently testable with Given/When/Then acceptance criteria.

**Requirements** — Numbered functional requirements (FR-001, FR-002, ...) using RFC 2119 keywords (MUST, SHALL, SHOULD, MAY). Each requirement must be testable and unambiguous.

**Success Criteria** — Measurable outcomes that define when the design is fulfilled. Technology-agnostic, verifiable without knowing implementation.

**Scope & Constraints** — What this design covers, what it explicitly excludes, and what assumptions were made.

### GOOD intent card body:

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
- FR-001: System MUST store every card in both DB and markdown file (dual-storage invariant).
- FR-002: System MUST reject spec card activation when any codeLink is unresolved.
- FR-003: System MUST auto-detect drift via 4 mechanisms: broken_link, boundary_inactive, symbol_changed, glossary_broken.
- FR-004: System MUST compensate DB changes when file write fails after DB commit.

## Success Criteria
- SC-001: 0 broken codeLinks on active spec cards at any point in time.
- SC-002: Every code change to a card-covered file is preceded by pre_change_check.
- SC-003: Drifted cards are detected within one check_drift cycle — no silent drift.

## Scope & Constraints
- Covers: card lifecycle, dual-storage, drift detection, code binding, glossary enforcement.
- Excludes: code generation, linting, CI, test automation, workflow orchestration.
- Assumes: gildash is available for symbol resolution when projectRoot is set.
```

### BAD intent card body (common mistakes):

- ✗ Code structure: "The system uses SQLite with Drizzle ORM. Cards are stored in the card table."
- ✗ Abstract policy only: "Always: Card is source of truth." (policy without scenarios, requirements, or success criteria)
- ✗ Implementation detail: "writeCardFile uses atomic rename via temp file."
- ✗ Task list: "1. Add migration 2. Update schema 3. Write tests" (execution plan, not design)

---

## spec — Behavioral contract bound to code

A spec card answers: **"What does the system guarantee?"**

It captures verifiable behavioral contracts bound to specific code symbols via codeLinks. Every spec card MUST relate to at least one intent card — a contract without governing policy is rootless. Requires codeLinks.

### REQUIRED content in spec body:

**Given/When/Then contracts** — Use RFC 2119 keywords (MUST, SHALL, SHOULD, MAY). Each contract is one testable guarantee.

**Failure modes** — Table: what violation occurs → what the system does. Agents need explicit failure behavior, not just happy paths.

### GOOD spec card body:

```
## Contracts
- WHEN a spec card status is set to active, THEN all codeLinks MUST resolve to existing symbols via gildash. IF any link fails, activation MUST be rejected with ActivationGuardError.
- WHEN a card is deleted with force=true AND it has children, THEN children MUST become orphans (parent=null) AND relations MUST be cleaned up bidirectionally.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| codeLink target symbol deleted | Card auto-transitions to drifted |
| File write fails after DB commit | Compensation reverts DB change; CompensationError thrown if revert also fails |
```

### BAD spec card body (common mistakes):

- ✗ Policies: "We always use compensation pattern" (belongs in intent)
- ✗ Implementation: "deleteByKey() calls SQL DELETE WHERE key=?" (discoverable from code)
- ✗ Task list: "1. Add migration 2. Update schema 3. Write tests" (execution plan, not contract)
- ✗ Verification commands: "Run `bun test`" (tooling, not contract)
- ✗ File paths in body text (use codeLinks field instead)

---

## Summary: what goes where

| Content | intent | spec | Neither |
|---------|--------|------|---------|
| Problem & Goals | ✓ | | |
| User Scenarios (P1/P2/P3) | ✓ | | |
| Functional Requirements (FR-001...) | ✓ | | |
| Success Criteria (measurable) | ✓ | | |
| Scope & Constraints | ✓ | | |
| Given/When/Then contracts (code-bound) | | ✓ | |
| Failure mode table | | ✓ | |
| Code structure descriptions | | | ✗ discoverable |
| File paths, class names | | | ✗ discoverable |
| Task checklists | | | ✗ execution plan |
| Verification commands | | | ✗ tooling |

Hierarchy: parent-child when scope is strict subset. Flat peers otherwise. Max 3 levels.

</card_types>

<model_notes>
- Fewer precise cards beat many vague ones.
- Call emberdeck tools directly — subagents lose card context.
- Always show the card-analysis template before creation, even when being concise elsewhere.
- When `pre_change_check` returns glossary warnings, address them before proceeding.
</model_notes>

Read cards before modifying code. Validate code links after. Run glossary backfill when glossary is empty.
