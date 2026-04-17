---
{key: glossary-management,summary: Project glossary as single source of truth for domain vocabulary with card cross-validation,status: draft,type: intent,glossary: [card-lock]}
---

## Motivation
Domain-specific terms recur across multiple cards. Without a single source of truth for definitions, different cards may use the same term with different meanings — or worse, agents may interpret terms inconsistently. The glossary system provides a canonical vocabulary file that cards reference, with cross-validation ensuring all referenced terms actually exist.

## Scope
- Covers: glossary CRUD (define, lookup, remove, rename), card glossary field validation, all-or-nothing batch define, rename propagation to DB and files, write serialization via global lock.
- Excludes: card body content validation, brief section structure, drift detection mechanics.
- Assumes: glossary is stored as a single file; card glossary fields reference words by exact match.

## Scenario

### P1: Define new glossary entries
Given a list of word-definition pairs,
When defineGlossary is called,
Then all entries pass validation or the entire batch is rejected (all-or-nothing).

### P1: Card creation requires glossary when glossary exists
Given the project glossary has entries,
When a card is created without a glossary field,
Then creation is rejected with a validation error.

### P1: Card glossary words must exist in project glossary
Given a card declares glossary words,
When any declared word does not exist in the project glossary,
Then the operation is rejected with a validation error.

### P2: Rename propagates to cards
Given a glossary word is renamed,
When renameGlossary is called with oldWord and newWord,
Then the glossary file is updated, all affected cards' DB records are updated, and card files are rewritten with the new word.

### P2: Rename compensates on DB failure
Given glossary file was successfully updated with new name,
When the DB transaction to update cards fails,
Then the glossary file is reverted to the original state.

### P3: Remove leaves affected cards driftable
Given a glossary word is removed,
When removeGlossary is called,
Then the word is deleted from the glossary file, and affected card keys are returned so drift detection can flag them.

## Rule
- R-001: defineGlossary MUST validate all entries before writing any — if one fails, none are written.
- R-002: When the project glossary has entries, every card MUST declare at least one glossary word.
- R-003: Every word in a card's glossary field MUST exist in the project glossary at the time of card creation or update.
- R-004: renameGlossary MUST update glossary file first, then DB. If DB fails, glossary file MUST be reverted.
- R-005: All glossary write operations MUST be serialized through a global lock. Read operations do NOT require the lock.
- R-006: Glossary entries MUST be sorted alphabetically for deterministic output.

## Constraint
- Maximum 500 glossary entries per project.
- Maximum 50 entries per defineGlossary call.
- Glossary file is a shared resource — concurrent writes from multiple processes are not supported.

## Risk
- Removing a glossary word does not immediately drift affected cards — drift is detected on next check_drift cycle.
- Rename updates card DB records and files in separate steps; file write failures leave DB/file inconsistent (tracked as file write failures in result).
- Progressive enforcement (glossary required only when glossary.yaml has entries) means early cards created before any glossary exists have no glossary field.

## Criteria
- SC-001: 0 cards with glossary words not present in the project glossary (after validation).
- SC-002: defineGlossary either creates/updates all entries or none (atomic batch).
- SC-003: renameGlossary leaves glossary file and DB consistent after success or failure.
- SC-004: All glossary write operations are serialized — no interleaved writes.

## Decision
- All-or-nothing batch validation was chosen over partial success because a partially defined glossary creates confusion about which terms are canonical.
- File-first ordering for rename (vs DB-first for card mutations) was chosen because the glossary file is simpler to revert than a multi-card DB transaction.
- A global lock (not per-word) was chosen because glossary operations affect a single shared file.
