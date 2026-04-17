---
{key: drift-detection,summary: Four drift detection mechanisms and automatic active-to-drifted transition with compensation,status: draft,type: intent,glossary: [drift,code-link,boundary]}
---

## Motivation
When source code changes, existing spec cards may no longer accurately describe the system. Silent drift — where specs claim guarantees the code no longer provides — is the highest-risk failure mode. The system must proactively detect four categories of drift and automatically transition affected cards from active to drifted, ensuring agents never trust stale specs.

## Scope
- Covers: four drift detection mechanisms (broken_link, boundary_inactive, symbol_changed, glossary_broken), automatic status transition (active → drifted), per-card and project-wide drift checks, compensation when auto-transition file write fails.
- Excludes: how activation guard works (see card-lifecycle), card creation rules, glossary define/rename/remove operations.
- Assumes: gildash provides symbol index and change tracking; glossary.yaml is the vocabulary source of truth.

## Scenario

### P1: Broken link drift
Given an active spec card with code links,
When a linked symbol no longer resolves in the symbol index,
Then the card is detected as drifted with type broken_link.

### P1: Automatic transition to drifted
Given drift is detected on an active card,
When autoTransition is enabled (default),
Then the card's status is updated to drifted in both DB and file.

### P1: Transition file write failure is compensated
Given drift auto-transition updates DB to drifted,
When the file write to update status fails,
Then the DB change is reverted to the previous status.

### P2: Boundary inactive drift
Given an active card with boundary glob patterns,
When no files on disk match any of the boundary patterns,
Then the card is detected as drifted with type boundary_inactive.

### P2: Symbol changed drift
Given an active card with boundary patterns,
When symbols in boundary-matching files changed after the card's last update,
Then the card is detected as drifted with type symbol_changed.

### P3: Glossary broken drift
Given a card declares glossary words,
When a declared word no longer exists in the project glossary,
Then the card is detected as drifted with type glossary_broken.

## Rule
- R-001: Drift detection MUST check all four types in priority order: broken_link > boundary_inactive > symbol_changed > glossary_broken. First match wins.
- R-002: Auto-transition MUST only occur when drift is confirmed AND the symbol index was available. Transient index failures MUST NOT cause false drift.
- R-003: Draft cards MUST be excluded from drift detection entirely.
- R-004: Project-wide drift check MUST process all non-draft cards.
- R-005: Scoped drift check MUST use BFS traversal to include related cards up to a configurable depth.

## Constraint
- Symbol index availability depends on external tooling. The system must gracefully degrade when the index is unavailable.
- Drift detection is eventually consistent — there is a window between code change and next drift check where specs may be stale.

## Risk
- If the symbol index has transient failures, healthy cards could be incorrectly marked as drifted.
- Large boundary patterns matching many files increase drift check latency.
- symbol_changed detection depends on accurate timestamps — clock skew between symbol index and card updates could cause missed drift.

## Criteria
- SC-001: 0 active cards with broken code links after a drift check cycle.
- SC-002: Drift detection MUST NOT produce false positives when the symbol index is transiently unavailable.
- SC-003: All four drift types MUST be detectable independently.
- SC-004: Auto-transition MUST leave DB and file consistent (either both drifted, or both reverted).

## Decision
- Four drift types were defined rather than a single "drifted" flag because the remediation action differs: broken_link needs code link update, boundary_inactive needs boundary pattern fix, symbol_changed needs spec review, glossary_broken needs glossary/card update.
- Priority ordering (broken_link first) was chosen because code link breakage is the most concrete and actionable signal.
- Auto-transition is enabled by default because manual drift marking creates a maintenance burden that leads to permanently stale specs.
