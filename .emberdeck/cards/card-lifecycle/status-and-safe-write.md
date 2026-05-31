---
key: card-lifecycle/status-and-safe-write
summary: >-
  Status transitions including activation guard plus the safe-write rollback
  wrapper that protects multi-step writes.
status: active
type: brief
parent: card-lifecycle
glossary:
  - activation-guard
brief:
  context:
    problem: >
      Promoting a card from draft to active without verifying that all required
      fields and (for specs) source `@spec` bindings resolve admits broken
      contracts. Any multi-step write (file plus DB plus changelog) partially
      failing leaves disk and DB diverged, violating the source-of-truth
      promise.
    impact:
      - statement: >-
          A draft promoted to active without satisfied invariants instantly
          enters drifted state on the next check.
      - statement: >-
          A partial write is hard to detect and harder to repair, undermining
          trust in the toolchain.
  scope:
    goals:
      - id: G-001
        statement: >-
          Reject status transitions to active when activation-guard
          preconditions fail.
      - id: G-002
        statement: >-
          Wrap multi-step writes so any failure rolls back the prior steps via a
          caller-provided compensate callback.
    non_goals:
      - id: NG-001
        statement: Drift state computation (delegated to analysis).
      - id: NG-002
        statement: Distributed transactions across processes.
    assumptions:
      - id: A-001
        statement: >-
          The DB engine supports per-connection transaction rollback for the
          DB-side action.
        verification: >-
          Inspect connection.ts for journal-mode configuration and how dbAction
          wraps transactions.
        reevaluate_when: The DB engine is swapped.
  flow:
    - id: S-H-01
      kind: happy
      given: A draft brief whose required fields and cross-references all resolve.
      when: updateCardStatus is called with active.
      then: The activation guard passes and the card transitions to active.
      covers:
        - G-001
    - id: S-H-02
      kind: happy
      given: >-
        A multi-step write where the DB action commits and the file action
        completes.
      when: All steps succeed.
      then: >-
        Both side effects are observable; the compensate callback is not
        invoked.
      covers:
        - G-002
    - id: S-F-01
      kind: failure
      given: >-
        A draft spec whose cached binding rows include a symbol that no longer
        resolves in the code index.
      when: updateCardStatus is called with active.
      then: ActivationGuardError is thrown and the card stays draft.
      covers:
        - G-001
    - id: S-F-02
      kind: failure
      given: >-
        A multi-step write where the DB action committed and the file action
        then throws.
      when: safeWriteOperation runs.
      then: >-
        The caller-provided compensate callback runs once with the DB result; if
        it succeeds, the original file-action error is re-raised; if it throws,
        a CompensationError aggregating both is raised.
      covers:
        - G-002
  policy:
    - id: R-001
      subject: Status transition to active
      keyword: MUST
      predicate: >-
        re-run schema validation and (for specs) source-binding resolution
        before allowing the transition.
      governs:
        - S-H-01
        - S-F-01
    - id: R-002
      subject: Multi-step writes
      keyword: SHALL
      predicate: >-
        be wrapped in safeWriteOperation when they touch more than one
        persistence target and provide a compensate callback that reverts the DB
        side effect.
      governs:
        - S-H-02
        - S-F-02
  external:
    - id: C-001
      statement: >-
        Per-connection transaction rollback semantics of the underlying embedded
        store engine provide the recovery primitive the dbAction relies on.
      reference:
        title: SQLite documentation - Atomic Commit
        locator: https://www.sqlite.org/atomiccommit.html
  limits:
    - id: KL-001
      statement: >-
        safeWriteOperation runs the caller-provided compensate callback exactly
        once when fileAction throws; bugs in the compensate callback itself
        surface as CompensationError but are not self-healed.
    - id: KL-002
      statement: >-
        Cross-process safety is not provided; concurrent writes from another
        process can corrupt state.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: A spec with a broken source binding cannot be transitioned to active.
        method: >-
          Integration test asserting set-status active throws
          ActivationGuardError when a bound symbol is missing.
      verifies:
        - S-F-01
    - id: SC-002
      type: binary
      measure:
        predicate: >-
          A simulated fileAction throw triggers the compensate callback exactly
          once and re-raises the original error.
        method: >-
          Unit test injecting a fileAction throw and asserting compensate call
          count is 1 and the original error propagates.
      verifies:
        - S-F-02
    - id: SC-003
      type: binary
      measure:
        predicate: >-
          A card meeting every activation precondition transitions to active and
          is persisted with status=active.
        method: Integration test asserting a fully-bound card reaches status=active.
      verifies:
        - S-H-01
    - id: SC-004
      type: binary
      measure:
        predicate: >-
          A successful multi-step write leaves both side effects observable and
          never invokes the compensate callback.
        method: >-
          Integration test asserting both writes are observable and compensate
          call count is 0.
      verifies:
        - S-H-02
  rationale:
    alternatives:
      - option: Optimistic active transition without re-validation.
        pros:
          - Faster transition.
        cons:
          - Cards enter active with stale state
          - immediately becoming drifted.
      - option: Two-phase commit with on-disk journal for the compensate step.
        pros:
          - Survives process crash mid-compensate.
        cons:
          - >-
            Significant complexity for the single-user CLI; in practice the next
            ed validate run repairs any divergence.
    chosen:
      option: >-
        Re-validate on active transition; use safeWriteOperation with a single
        compensate callback for multi-step writes.
      reasoning: >-
        Matches the single-process invocation model and keeps recovery semantics
        simple while letting callers express the exact reverse of their DB
        action.
    addresses:
      - KL-001
      - KL-002
  approach: >-
    Status transitions are governed by a transition matrix, and the transition
    into the active state triggers an activation guard that re-runs schema
    validation and, for spec cards, source-binding resolution. Persistence that
    spans both the database and the filesystem goes through a safe-write
    boundary: a synchronous database action runs first, then an asynchronous
    file action; if the file action fails, a single compensation callback
    reverts the database side effect exactly once and the original error is
    re-raised. Should the compensation itself fail, a CompensationError carrying
    both the original and the compensation failure is raised in its place.
---
