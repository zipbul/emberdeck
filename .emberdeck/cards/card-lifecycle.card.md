---
{key: card-lifecycle,summary: "Card status state machine and activation guard rules for draft, active, and drifted transitions",status: draft,type: intent,glossary: [activation-guard,drift]}
---

## Motivation
Cards progress through lifecycle states: draft (work in progress), active (code and spec aligned), and drifted (code diverged). Without enforced preconditions at each transition, invalid cards could be marked active — misleading agents into trusting outdated or incomplete specs. The activation guard ensures only structurally sound cards reach active status.

## Scope
- Covers: status state machine (draft/active/drifted), activation guard conditions per card type, parent-type hierarchy enforcement, section validation for active cards, type change impact on status.
- Excludes: how drift is detected (see drift-detection brief), code-link resolution mechanics, glossary management.
- Assumes: card type is either brief or spec; parent hierarchy is max 3 levels deep.

## Scenario

### P1: Spec card activation requires resolved code links
Given a spec card in draft status with code links,
When status is set to active,
Then all code links MUST resolve to existing symbols, otherwise activation is rejected.

### P1: Brief card activation requires 8 sections
Given a brief card in draft status,
When status is set to active,
Then the body MUST contain all 8 required brief sections (Motivation, Scope, Scenario, Rule, Constraint, Risk, Criteria, Decision).

### P1: Spec card activation requires 3 sections
Given a spec card in draft status,
When status is set to active,
Then the body MUST contain all 3 required spec sections (Contract, Invariant, Failure).

### P2: Type change on active card may force status to draft
Given an active card,
When its type is changed and the new type's activation conditions are unmet,
Then the card's status is forced to draft with a warning.

### P2: Parent hierarchy is enforced
Given a card creation or update,
When a parent is specified,
Then brief cards MUST have brief parents; spec cards MUST have brief or spec parents.

### P3: Circular parent references are detected
Given a card update setting parent to another card,
When the ancestor chain forms a cycle,
Then the update is rejected with a ParentValidationError.

## Rule
- R-001: Draft cards have no activation constraints — they represent work in progress.
- R-002: Active brief cards MUST have all 8 required sections present and non-empty.
- R-003: Active spec cards MUST have at least 1 code link that resolves AND all 3 required sections.
- R-004: Brief cards MUST have null or brief parent. Spec cards MUST have brief or spec parent.
- R-005: Changing a card's type MUST re-validate children's parent-type hierarchy.
- R-006: Parent chain depth MUST NOT exceed 20 levels (cycle detection guard).

## Constraint
- Status values are limited to exactly three: draft, active, drifted. No custom states.
- Card types are limited to brief and spec. The type determines which activation rules apply.

## Risk
- If activation guard is bypassed, active cards may reference nonexistent symbols, causing false confidence.
- Type change on a card with many children could cascade validation failures.
- Section validation checks structural presence only — content quality requires separate L2 checks.

## Criteria
- SC-001: 0 active spec cards with unresolved code links at any point.
- SC-002: 0 active brief cards missing any of the 8 required sections.
- SC-003: 0 active spec cards missing any of the 3 required sections.
- SC-004: 0 parent-type hierarchy violations in the card tree.

## Decision
- Three-state machine (draft/active/drifted) was chosen over more granular states because the key distinction is trust: can an agent rely on this spec? Draft = no, Active = yes, Drifted = was yes, now uncertain.
- Section validation was split into L1 (structural) and L2 (lexical quality) to allow activation on L1 pass while flagging L2 warnings for improvement.
- Activation guard runs at creation and update time, not as a background job, to prevent invalid cards from ever reaching active status.
