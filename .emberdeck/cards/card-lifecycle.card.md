---
{key: card-lifecycle,summary: Card mutation operations maintain dual-storage consistency and enforce lifecycle rules,status: draft,type: intent,glossary: [card,dual storage,activation guard,compensation]}
---

## Problem & Goals
Agents create, update, delete, and rename design cards. Each mutation must keep DB and file representations in sync. If either storage fails, the other must be compensated. Parent-child hierarchy, relation targets, and activation conditions must be validated before any mutation commits.

Goal: every card mutation either fully succeeds (DB + file) or fully rolls back, with no partial state.

## User Scenarios

### P1: Agent creates a card
Given an agent provides a valid card key, summary, and type,
When it calls createCard,
Then the card is atomically stored in both DB and file,
And if the file write fails after DB commit, the DB change is compensated.

### P1: Agent updates a card with status change
Given a draft card exists,
When the agent sets status to active,
Then the activation guard validates all conditions before the status change commits.

### P2: Agent deletes a card with children
Given a card has child cards,
When the agent calls deleteCard with force=true,
Then children become orphans (parent set to null) and referencing cards' relation fields are cleaned up.

### P2: Agent renames a card
Given a card is referenced by other cards' relations and parent fields,
When the agent renames it,
Then all referencing cards' files are updated to the new key,
And body references to the old key are reported for manual update.

## Requirements
- R-001: Every card mutation MUST write to DB first, then file. On file failure, DB MUST be compensated.
- R-002: Concurrent mutations to the same card key MUST be serialized in FIFO order.
- R-003: Parent validation MUST check existence, type hierarchy, and circular references before commit.
- R-004: Relation targets MUST exist in DB at the time of creation or update.
- R-005: Activation guard MUST reject status=active when conditions are unmet for the card type.
- R-006: Type change on an active card MUST re-validate activation and force to draft if conditions are unmet.
- R-007: Card rename MUST use FK cascade to propagate key changes to all referencing tables.

## Success Criteria
- SC-001: 0 cases where DB and file diverge after any single mutation.
- SC-002: 0 cases where an active spec card has unresolved codeLinks.
- SC-003: 0 circular parent references in the card hierarchy.

## Scope & Constraints
- Covers: createCard, updateCard, updateCardStatus, deleteCard, renameCard, safe write pattern, card lock, retry.
- Excludes: drift detection, code link resolution, glossary enforcement logic, impact analysis, bulk operations.
- Assumes: SQLite with WAL mode and foreign keys enabled.
