---
key: card-lifecycle/mutation-workflows/update-card
summary: >-
  updateCard applies summary, field, patch, glossary, and tag updates with
  replace-namespace semantics on patch; there is no body update field — body is
  derived from the namespace.
status: active
type: spec
parent: card-lifecycle/mutation-workflows
glossary:
  - activation-guard
spec:
  preconditions:
    - id: PRE-001
      condition: Caller passes a UpdateCardFields with at least one mutation field set.
      derives: card-lifecycle/mutation-workflows#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        A namespace patch fully replaces the prior namespace value with the new
        payload. The result reports failedRelationTargets — relation targets
        that did not persist; empty on a clean update.
      keyword: MUST
      derives: card-lifecycle/mutation-workflows#G-001
    - id: POST-002
      guarantee: >-
        Updates apply atomically across file and DB. updateCard writes a
        changelog row capturing the diff of changed fields, per the changelog
        contract.
      keyword: SHALL
      derives: card-lifecycle/mutation-workflows#G-001
  invariants:
    - id: INV-001
      statement: >-
        updateCard re-validates inputs BEFORE merging into the existing card
        (pre-merge validation). The merged result is not re-run through
        validateCardInput after the merge; persistence relies on the per-field
        invariants enforced at the type-validator layer.
      always_holds: per-call
  failures:
    - violation: Card key not found.
      behavior: updateCard throws CardNotFoundError.
      id: FAIL-001
    - violation: Patch produces invalid card.
      behavior: updateCard throws CardValidationError; no persistence.
      id: FAIL-002
    - violation: >-
        Card key is malformed (invalid slug, reserved characters, or
        normalization-rules violation).
      behavior: updateCard throws CardKeyError; no persistence.
      id: FAIL-003
    - violation: >-
        Patch attempts a parent change that violates the four-tier hierarchy or
        points to a non-existent parent; or a type change orphaning children.
      behavior: updateCard throws ParentValidationError; no persistence.
      id: FAIL-004
      case_of: card-lifecycle/mutation-workflows#S-F-01
    - violation: >-
        Patch triggers a status transition to 'active' whose activation guard's
        preconditions are not met.
      behavior: >-
        updateCard throws ActivationGuardError with details.unmetConditions; no
        persistence.
      id: FAIL-005
    - violation: >-
        The DB transaction for the patch fails (constraint violation,
        store-level error) before any file write.
      behavior: >-
        updateCard propagates the underlying DB error; neither the on-disk card
        file nor the indexed cache is modified. The card remains in its prior
        state.
      id: FAIL-006
    - violation: >-
        The DB transaction succeeds but the on-disk file write fails (I/O error,
        permission denied, disk full) inside the safe-write boundary.
      behavior: >-
        updateCard invokes safe-write compensation to roll back the DB row to
        its prior value. On compensation success the original file I/O error is
        thrown; on compensation failure updateCard throws CompensationError
        carrying `details.{originalError, compensationError}` and leaves the
        card in an inconsistent state that the next `ed bulk sync` reconciles.
      id: FAIL-007
    - violation: The changelog row write fails.
      behavior: >-
        The changelog row is written inside the same DB transaction (dbAction
        step) as the card row, before any file write. A changelog-write failure
        therefore aborts that DB transaction atomically — no card row and no
        file change are committed — and updateCard propagates the underlying
        error; there is nothing to compensate.
      id: FAIL-008
---
