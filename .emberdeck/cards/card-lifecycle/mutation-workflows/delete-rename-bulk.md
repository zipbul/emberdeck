---
key: card-lifecycle/mutation-workflows/delete-rename-bulk
summary: >-
  deleteCard, renameCard, and bulkCreateCards complete the mutation set with
  cascade and rollback semantics.
status: active
type: spec
parent: card-lifecycle/mutation-workflows
glossary:
  - 4-tier
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes a card key for delete or rename, or a list of inputs for
        bulkCreateCards; for delete, optionally a force flag.
      derives: card-lifecycle/mutation-workflows#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        renameCard atomically updates key/path and writes the changelog row
        within a single DB transaction. The cross-domain dependency and relation
        rewrites of REFERENCING cards happen LATER as separate file writes
        followed by syncCardFromFile() — they are NOT in the same transaction as
        the rename itself. Card body wording and source `@spec` annotations are
        not cascaded. Per-reference file rewrite failures are surfaced via
        failedReferenceUpdates[] on the result rather than thrown.
      keyword: MUST
      derives: card-lifecycle/mutation-workflows#G-003
    - id: POST-002
      guarantee: >-
        bulkCreateCards processes entries independently: each entry is committed
        via createCard with its own safe-write boundary. Successful entries
        appear in created[]; failures appear in `failed[]` preserving
        inputIndex. Earlier successes are NOT rolled back when a later entry
        fails. Phase-2 relation updates that fail mark their card key in
        partialKeys[] AND append a row to failed[] (with the relation-update
        message and the same inputIndex); the card row itself remains persisted
        (in created[]), but the unresolved relation surfaces as a failed[] entry
        so the batch exits non-zero — consistent with card-create surfacing
        failedRelationTargets as a non-zero exit.
      keyword: SHALL
      derives: card-lifecycle/mutation-workflows#G-001
    - id: POST-003
      guarantee: >-
        deleteCard with --force detaches children (their parent field is
        cleared) and removes the deleted key from referencing cards'
        cross_domain_dependencies; the children themselves are NOT
        cascade-deleted. Without --force, deletion is refused when children
        exist or any domain card lists the target in cross_domain_dependencies.
        detachedChildren[], removedCrossDomainRefs[], failedChildUpdates[],
        failedRelationUpdates[], and failedCrossDomainUpdates[] on the result
        expose post-mutation state.
      keyword: MUST
      derives: card-lifecycle/mutation-workflows#G-001
  invariants:
    - id: INV-001
      statement: >-
        Each single-card op (deleteCard, renameCard, and each individual
        createCard inside bulkCreateCards) leaves no partial cache plus file
        state for that card on failure; bulkCreateCards does not roll back
        successful earlier entries when a later entry fails.
      always_holds: per-call
  failures:
    - violation: deleteCard or renameCard target key does not exist.
      behavior: Throws CardNotFoundError; no removal or rename performed.
    - violation: deleteCard target has children and --force is not passed.
      behavior: Throws CardValidationError; no removal performed.
    - violation: >-
        deleteCard target is referenced via cross_domain_dependencies by ≥1
        domain card and --force is not passed.
      behavior: >-
        Throws CardValidationError listing the referencing domains; no removal
        performed.
    - violation: renameCard target key already exists.
      behavior: Throws CardAlreadyExistsError; no rename performed.
    - violation: renameCard old key equals new key.
      behavior: Throws CardRenameSamePathError; no rename performed.
    - violation: bulkCreateCards mid-batch failure on entry N.
      behavior: >-
        Returns a result with entry N in failed[] (preserving inputIndex), prior
        successes in created[], and continues processing remaining entries. No
        rollback of prior entries.
    - violation: renameCard cascade write to a referencing card's file fails.
      behavior: >-
        The rename still completes; the affected reference is recorded in
        failedReferenceUpdates[] with its cardKey and the error reason; no
        exception is raised.
---
