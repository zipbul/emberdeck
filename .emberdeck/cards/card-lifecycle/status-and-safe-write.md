---
key: card-lifecycle/status-and-safe-write
summary: >-
  Status transitions including activation guard plus the safe-write rollback
  wrapper that protects multi-step writes.
status: draft
type: brief
parent: card-lifecycle
glossary:
  - activation-guard
brief:
  context:
    problem: >
      Promoting a card from draft to active without verifying that all
      required fields and (for specs) source `@spec` bindings resolve
      admits broken contracts. Any multi-step write (file plus DB plus
      changelog) partially failing leaves disk and DB diverged, violating
      the source-of-truth promise.
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
        statement: Wrap multi-step writes so any failure rolls every prior step back.
    non_goals:
      - id: NG-001
        statement: Drift state computation (delegated to analysis).
      - id: NG-002
        statement: Distributed transactions across processes.
    assumptions:
      - id: A-001
        statement: SQLite supports the rollback semantics needed by safeWriteOperation.
        verification: Inspect connection.ts for journal_mode and transaction usage.
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
      given: A multi-step write involving file plus DB.
      when: All steps succeed.
      then: All artifacts are committed atomically.
      covers:
        - G-002
    - id: S-F-01
      kind: failure
      given: >-
        A draft spec whose cached code_link rows include a symbol that no
        longer resolves in gildash.
      when: updateCardStatus is called with active.
      then: ActivationGuardError is thrown, the card stays draft.
      covers:
        - G-001
    - id: S-F-02
      kind: failure
      given: >-
        A multi-step write where the DB write succeeds but the file write
        throws.
      when: safeWriteOperation runs.
      then: The DB write is rolled back; no file change persists.
      covers:
        - G-002
  design:
    overview: >
      updateCardStatus runs a status-transition matrix; the active transition
      triggers the activation

      guard which re-runs validation and link resolution. safeWriteOperation
      accepts a sequence of

      compensating actions and a forward action; on throw it executes
      compensations in reverse order.
    components:
      - name: updateCardStatus
        responsibility: >-
          Validate the requested transition and run activation guard when target
          is active.
        interacts_with:
          - safeWriteOperation
      - name: safeWriteOperation
        responsibility: >-
          Execute a forward action with registered compensations executed in
          reverse on failure.
        interacts_with: []
    data_flow: []
    invariants:
      - id: DI-001
        statement: >-
          No card reaches active state with unresolved required fields or
          broken source bindings.
      - id: DI-002
        statement: >-
          Any thrown error inside safeWriteOperation results in zero observable
          side effects.
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
        persistence target.
      governs:
        - S-H-02
        - S-F-02
  external:
    - id: C-001
      statement: >-
        SQLite WAL mode and transaction semantics provide the per-connection
        rollback contract relied on here.
      reference:
        title: SQLite documentation - Atomic Commit
        locator: https://www.sqlite.org/atomiccommit.html
  compatibility:
    guarantees:
      - subject: updateCardStatus and safeWriteOperation public signatures
        version_range: 1.x
        breaks_if: The compensation registration shape changes.
  limits:
    - id: KL-001
      statement: >-
        safeWriteOperation only protects compensations registered before the
        throw; bugs in compensation logic itself are not detected.
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
          Integration test that removes the source `@spec` target symbol
          then calls set-status active.
      verifies:
        - S-F-01
    - id: SC-002
      type: binary
      measure:
        predicate: >-
          A simulated failure mid-write leaves zero observable changes on disk
          and in DB.
        method: Integration test injecting a throw between DB write and file write.
      verifies:
        - S-F-02
  rationale:
    alternatives:
      - option: Optimistic active transition without re-validation.
        pros:
          - Faster transition.
        cons:
          - Cards enter active with stale state
          - immediately becoming drifted.
      - option: Two-phase commit with on-disk journal.
        pros:
          - Survives process crash.
        cons:
          - >-
            Significant complexity; SQLite already provides per-process
            transaction safety which is sufficient for the single-user CLI.
    chosen:
      option: >-
        Re-validate on active transition; use SQLite-backed safeWriteOperation
        for multi-step writes.
      reasoning: >-
        Matches the actual deployment model (single-user CLI) without
        overengineering.
    addresses:
      - KL-001
      - KL-002
---
