---
key: card-lifecycle/mutation-workflows
summary: >-
  Create, update, delete, rename, and bulk-create workflows that own atomic card
  mutations and their parent rules.
status: active
type: brief
parent: card-lifecycle
glossary:
  - 4-tier
brief:
  context:
    problem: >
      Card mutation flows must coordinate validation, parent-existence checks,
      file IO, DB writes, and changelog entries. A naive implementation either
      drops one step (leaving file and DB diverged) or skips parent checks
      (creating orphans that break the four-tier hierarchy).
    impact:
      - statement: >-
          Orphan cards or stale DB rows force expensive validate-cards repair
          sweeps and obscure user intent.
      - statement: >-
          Silent rename failures break code bindings and downstream drift
          detection.
  scope:
    goals:
      - id: G-001
        statement: >-
          Provide createCard, updateCard, deleteCard, renameCard, and
          bulkCreateCards entry points with consistent error semantics.
      - id: G-002
        statement: >-
          Reject mutations that would violate the four-tier hierarchy or
          reference a non-existent parent.
      - id: G-003
        statement: >-
          Cascade renames so indexed references (parent, relations,
          cross_domain_dependencies) update atomically; source @spec annotations
          are reconciled separately by spec-sync.
    non_goals:
      - id: NG-001
        statement: Schema validation itself (delegated to card-model).
      - id: NG-002
        statement: Drift transitions on mutation (delegated to analysis).
    assumptions:
      - id: A-001
        statement: >-
          All mutations go through ops/ entry points, not direct repository
          writes.
        verification: Grep imports of card-repo.ts outside of src/ops.
        reevaluate_when: A new caller imports a repository directly.
  flow:
    - id: S-H-01
      kind: happy
      given: A valid create input for a brief whose parent domain exists.
      when: createCard runs.
      then: >-
        The card is validated, written to file, and persisted to the indexed
        cache within one safe-write boundary. NO changelog row is appended
        (createCard does not write to the changelog repo).
      covers:
        - G-001
        - G-002
    - id: S-H-02
      kind: happy
      given: >-
        A renameCard call from old key to new key with downstream references in
        three other cards.
      when: renameCard runs.
      then: >-
        The target card's key/path rename is atomic; the parent, relations, and
        cross_domain_dependencies entries in the three referencing cards are
        then rewritten as separate file writes, and any reference rewrite that
        fails is recorded in failedReferenceUpdates[] without aborting the
        rename; card bodies and source @spec annotations are not cascaded.
      covers:
        - G-003
    - id: S-F-01
      kind: failure
      given: A createCard input whose parent does not exist.
      when: createCard runs.
      then: >-
        A ParentValidationError is thrown, no file or indexed-cache row is
        written.
      covers:
        - G-002
    - id: S-F-02
      kind: failure
      given: >-
        A bulkCreateCards input where the third of five entries fails
        validation.
      when: bulkCreateCards runs.
      then: >-
        The first two entries remain persisted; the third entry is recorded with
        its inputIndex in failed[]. The remaining entries continue. The result
        reports per-entry success and failure with no rollback of prior
        successes.
      covers:
        - G-001
  design:
    overview: >
      Each entry point composes validation (card-model), parent resolution
      (card-storage), the mutation itself (file plus indexed cache), and
      rollback on failure (safe-write). createCard does NOT write a changelog
      row; updateCard and renameCard do invoke the changelog repo.
      bulkCreateCards orders entries topologically so parents land before
      children, then processes each entry through createCard with independent
      success/failure accounting; later entries proceed even if earlier ones
      fail.
    components:
      - name: createCard
        responsibility: >-
          Validate input, check parent existence, persist file plus indexed
          cache atomically through the safe-write boundary. createCard does NOT
          write a changelog row (changelog repo is invoked only by updateCard
          and renameCard).
        interacts_with:
          - updateCard
          - bulkCreateCards
      - name: updateCard
        responsibility: >-
          Apply field, patch, glossary, and tag updates with replace-namespace
          semantics on patch; re-run activation guard when activation-critical
          fields change on an active card. Writes a changelog row via
          recordUpdateChangelog.
        interacts_with:
          - createCard
      - name: renameCard
        responsibility: >-
          Atomic key rename with cascade over the indexed cache (parent,
          relations, cross_domain_dependencies) and the file move; body wording
          and source @spec annotations are not cascaded.
        interacts_with:
          - updateCard
      - name: deleteCard
        responsibility: >-
          Remove a card; with --force, detach children (parent cleared) and
          remove cross-domain dependents' references; without --force, refuse
          when children or cross-domain dependents exist.
        interacts_with: []
      - name: bulkCreateCards
        responsibility: >-
          Topologically-ordered serial create returning per-entry success in
          created[] and failure in failed[]; no batch rollback. Entries whose
          card row was created but whose relations did not all resolve are
          additionally reported in partialKeys[].
        interacts_with:
          - createCard
    data_flow: []
    invariants:
      - id: DI-001
        statement: >-
          A failed single-card mutation leaves no partial file or indexed-cache
          state for that card; safe-write compensates the cache row when the
          file step fails.
      - id: DI-002
        statement: >-
          Rename cascade rewrites every reference visible from the indexed cache
          (parent, relations, cross_domain_dependencies) as separate post-rename
          writes, surfacing any failure in failedReferenceUpdates[]; source
          @spec annotations are reconciled by spec-sync separately.
  policy:
    - id: R-001
      subject: Every mutation entry point
      keyword: MUST
      predicate: validate input through card-model before invoking storage.
      governs:
        - S-H-01
        - S-F-01
    - id: R-002
      subject: bulkCreateCards
      keyword: SHALL
      predicate: >-
        surface per-entry success and failure independently; entries that
        succeeded before a later failure MUST remain persisted (no batch
        rollback). Failures live in failed[].
      governs:
        - S-F-02
    - id: R-003
      subject: renameCard
      keyword: MUST
      predicate: >-
        cascade reference updates across parent, relations, and
        cross_domain_dependencies as separate writes after the target card's
        atomic key/path rename, recording any failed rewrite in
        failedReferenceUpdates[]; card body wording and source @spec annotations
        are not cascaded.
      governs:
        - S-H-02
  external:
    - id: C-001
      statement: >-
        Mutations participate in the safe-write rollback contract owned by
        card-lifecycle/status-and-safe-write.
      reference:
        title: brief card-lifecycle/status-and-safe-write
        locator: card-lifecycle/status-and-safe-write
  compatibility:
    guarantees:
      - subject: >-
          createCard, updateCard, deleteCard, renameCard, bulkCreateCards public
          signatures
        version_range: 1.x
        breaks_if: A required input field is added without a default.
  limits:
    - id: KL-001
      statement: >-
        Rename cascade only updates references stored in the indexed cache
        (parent, relations, cross_domain_dependencies). Card body wording and
        source @spec annotations are NOT cascaded by rename: body wording stays
        author-owned; annotations are reconciled into the binding cache by ed
        spec sync on the next run.
    - id: KL-002
      statement: >-
        bulkCreateCards is serial; concurrent bulk operations within one process
        are not supported. A failed entry does not roll back successful prior
        entries (see R-002).
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          When the third of five entries in bulkCreateCards fails validation,
          created[].length is 2 and failed[].length is 1 with the failed entry's
          inputIndex preserved; the two prior successes remain persisted.
        method: >-
          Integration test injecting a validation failure on the third entry of
          a five-entry batch and asserting per-entry outcomes plus disk and
          indexed-cache state.
      verifies:
        - S-F-02
    - id: SC-002
      type: binary
      measure:
        predicate: >-
          renameCard updates every cross-domain dependency, parent, and
          relations entry that previously named the old key; card bodies and
          source @spec annotations are left unchanged.
        method: >-
          Integration test creating a graph, renaming, and asserting reference
          counts in the cache plus untouched bodies and annotations.
      verifies:
        - S-H-02
    - id: SC-003
      type: binary
      measure:
        predicate: createCard with a non-existent parent throws and writes nothing.
        method: >-
          Integration test asserting empty disk and empty indexed-cache after
          the error.
      verifies:
        - S-F-01
        - S-H-01
  rationale:
    alternatives:
      - option: Direct repository access from CLI commands.
        pros:
          - Less indirection.
        cons:
          - >-
            Each command would re-implement validation, parent checks, and
            rollback, drifting over time.
      - option: >-
          Atomic batch with rollback of all prior entries on any failure inside
          bulkCreateCards.
        pros:
          - All-or-nothing semantics match a single transaction mental model.
        cons:
          - >-
            Forces the entire batch to be valid before any progress is
            observable; partial progress is exactly what makes large imports
            tractable when a few entries are bad.
    chosen:
      option: >-
        Single ops/ entry per mutation; bulkCreateCards uses per-entry
        independent success/failure (no batch rollback); single-card rollback
        via safe-write.
      reasoning: >-
        Single-user CLI workloads benefit from observable per-entry progress;
        rolling back the whole batch on one validation failure forces avoidable
        rework. Per-card safe-write still guarantees no partial single-card
        state.
    addresses:
      - KL-001
      - KL-002
---
