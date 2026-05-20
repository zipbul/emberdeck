---
key: card-lifecycle
summary: >-
  CRUD plus status transitions plus safe-write rollback that govern how cards
  change over time.
status: active
type: domain
glossary:
  - activation-guard
  - 4-tier
domain:
  overview: >
    Owns the workflows that mutate cards: create, update, delete, rename,
    bulk-create, bulk-sync from

    files, and status transitions (draft to active to drifted). Enforces
    parent-child rules

    at write time, runs the activation guard when promoting a card to active,
    and wraps multi-step

    writes (file plus DB) in a rollback-capable safe-write boundary so partial
    failures

    cannot leave the system in an inconsistent state.
  scope: >
    IN: createCard, updateCard, deleteCard, renameCard, bulkCreateCards,
    bulkSyncCards, status transition

    rules including activation guard, parent reassignment cascade, rename
    reference cascade, safe-write rollback

    wrapper, conflict and not-found error mapping.


    OUT: schema validation itself (delegated to card-model), low-level
    repository SQL (delegated to

    card-storage), code-link resolution (delegated to code-binding).
  cross_domain_dependencies:
    - domain: card-model
      relationship: invokes type-specific validators before any write reaches storage.
    - domain: card-storage
      relationship: >-
        persists mutations through repositories and triggers file-DB
        synchronization.
---
