---
key: glossary/lifecycle
summary: >-
  Define, lookup, remove, and rename glossary entries with cascading updates to
  cards that reference them.
status: active
type: brief
parent: glossary
glossary:
  - drift
brief:
  context:
    problem: >
      Glossary terms are project-specific design decisions referenced from many
      cards. Without a managed lifecycle, remove leaves orphan references,
      rename forces manual edits across every card, and define without
      uniqueness checks admits duplicates.
    impact:
      - statement: >-
          Orphan references after a remove cause glossary_broken drift across
          many cards at once.
      - statement: >-
          Manual rename of a term across dozens of cards is error-prone and easy
          to skip partially.
  scope:
    goals:
      - id: G-001
        statement: >-
          Provide define, lookup, remove, and rename entry points.
          defineGlossary is all-or-nothing INSIDE the op (any entry that fails
          op-level validation rejects the whole batch and persists zero). The
          CLI command `ed glossary define` pre-validates entries per-entry and
          splits failures into the result `failed[]` — only the surviving
          entries are passed to the op for the all-or-nothing write, so
          user-facing semantics are partial-accept with per-entry failed[]
          reported.
      - id: G-002
        statement: >-
          Cascade renames so the glossary field on every referencing card
          updates safely; the rename is a TWO-STEP sequence — (1) glossary.yaml
          is rewritten first via writeGlossary, then (2) a DB transaction
          updates the indexed glossary fields of every referencing card. If the
          DB transaction throws, glossary.yaml is reverted. Per-file markdown
          rewrites of card bodies are best-effort outside both and surfaced as
          fileWriteFailures[].
      - id: G-003
        statement: >-
          On remove, surface every referencing card key so the operator can
          resolve them; remove does not mutate referencing cards itself.
      - id: G-004
        statement: >-
          Provide resetEmberdeck: a confirmation-gated full wipe of all cards
          and glossary entries. Per-file unlink failures are reported in
          failedFileDeletes[] without aborting the wipe; DB-row and
          glossary-reset failures are best-effort and do not block.
    non_goals:
      - id: NG-001
        statement: Cross-project glossary federation.
      - id: NG-002
        statement: >-
          Auto-suggesting glossary additions (delegated to analysis
          suggestions).
    assumptions:
      - id: A-001
        statement: Glossary persistence is suitable for hundreds of entries per project.
        verification: Inspect glossary/io.ts storage and benchmarks.
        reevaluate_when: A user reports performance issues at scale.
  flow:
    - id: S-H-01
      kind: happy
      given: A define call with ten valid entries.
      when: defineGlossary runs.
      then: All ten are persisted in one batch and lookup returns them.
      covers:
        - G-001
    - id: S-H-02
      kind: happy
      given: A glossary entry referenced by three cards.
      when: renameGlossary runs.
      then: >-
        The glossary store entry is renamed first; then the indexed cache for
        the three cards updates in a DB transaction, with the store rename
        reverted if the DB step fails (two-step, not one transaction); per-card
        markdown file rewrites run best-effort and any per-file failure is
        surfaced in fileWriteFailures[].
      covers:
        - G-002
    - id: S-F-01
      kind: failure
      given: A define batch where one of the entries is invalid.
      when: defineGlossary runs.
      then: >-
        All entries in the batch are rejected (all-or-nothing); no partial
        persistence.
      covers:
        - G-001
    - id: S-F-02
      kind: failure
      given: A remove call without --yes flag.
      when: removeGlossary runs.
      then: The CLI requires confirmation; nothing is removed without --yes.
      covers:
        - G-003
    - id: S-H-03
      kind: happy
      given: A project containing cards and glossary entries.
      when: resetEmberdeck runs with explicit confirmation.
      then: >-
        Every card (cache rows and files) and every glossary entry is removed;
        per-file unlink failures are reported in failedFileDeletes[] without
        aborting the reset.
      covers:
        - G-004
    - id: S-F-03
      kind: failure
      given: A reset request without explicit confirmation.
      when: resetEmberdeck runs.
      then: Nothing is removed; the operator is required to confirm.
      covers:
        - G-004
  design:
    overview: >
      defineGlossary writes the YAML glossary store atomically (tmp file plus
      rename). The store is the source of truth; the indexed cache stores each
      card's own glossary field after sync, not the global glossary itself.
      renameGlossary writes the YAML store FIRST, then updates the indexed
      glossary fields of every referencing card in a DB transaction, reverting
      the YAML write if the DB step fails (two-step, not a single transaction);
      per-card markdown file rewrites are best-effort and any individual failure
      is surfaced in fileWriteFailures[]. removeGlossary requires explicit
      --yes, returns the list of referencing card keys, and does not mutate
      referencing cards itself — the operator decides whether to update their
      glossary fields or to set their status to drifted.
    components:
      - name: defineGlossary
        responsibility: >-
          All-or-nothing batch define capped at fifty entries per call and five
          hundred entries per project; enforces word and definition length
          limits.
        interacts_with:
          - lookupGlossary
      - name: lookupGlossary
        responsibility: Read entries by word or list all.
        interacts_with: []
      - name: removeGlossary
        responsibility: >-
          Confirmation-gated remove that surfaces affected card keys without
          mutating them; status transition to drifted is the operator's explicit
          decision.
        interacts_with:
          - renameGlossary
      - name: renameGlossary
        responsibility: >-
          Two-step rename: write the YAML store first, then update the indexed
          glossary fields of every referencing card in a DB transaction with the
          YAML write reverted on DB failure; card markdown rewrites are
          best-effort with per-file failures surfaced in fileWriteFailures[].
        interacts_with:
          - defineGlossary
    data_flow: []
    invariants:
      - id: DI-001
        statement: >-
          defineGlossary op is all-or-nothing per batch and never persists a
          partial batch. CLI pre-validation runs BEFORE the op and may carve out
          entries into result.failed[] without ever invoking the op for them.
      - id: DI-002
        statement: removeGlossary never runs without explicit --yes confirmation.
      - id: DI-003
        statement: >-
          renameGlossary is TWO-STEP (NOT one transaction): the YAML glossary
          store is written first, then the indexed cache is updated inside a DB
          transaction. On DB transaction failure the YAML write is reverted.
          Per-card markdown rewrites are a third best-effort step outside both —
          failures are reported in fileWriteFailures[] rather than thrown.
  policy:
    - id: R-001
      subject: defineGlossary
      keyword: SHALL
      predicate: >-
        cap each batch at fifty entries and the project total at five hundred
        entries; enforce word ≤100 chars and definition ≤1000 chars; reject the
        whole batch on any single invalid entry.
      governs:
        - S-H-01
        - S-F-01
    - id: R-002
      subject: removeGlossary
      keyword: MUST
      predicate: >-
        require explicit --yes confirmation before any persistence change;
        return affected card keys without mutating them.
      governs:
        - S-F-02
    - id: R-003
      subject: renameGlossary
      keyword: MUST
      predicate: >-
        update the YAML glossary store FIRST, then run a DB transaction to
        update the indexed glossary fields of every referencing card. On
        DB-transaction failure, revert the YAML write. Surface per-card markdown
        rewrite failures via fileWriteFailures[] rather than aborting the
        rename.
      governs:
        - S-H-02
    - id: R-004
      subject: resetEmberdeck
      keyword: MUST
      predicate: >-
        require explicit confirmation before removing any state, and report
        per-file unlink failures in failedFileDeletes[] without aborting the
        wipe.
      governs:
        - S-H-03
        - S-F-03
  external:
    - id: C-001
      statement: >-
        Per-command glossary command shapes (define, lookup, remove, rename) are
        jointly defined with the per-command spec cards under cli-surface.
      reference:
        title: spec cli-surface/command-routing-and-output/commands/glossary-define
        locator: cli-surface/command-routing-and-output/commands/glossary-define
  compatibility:
    guarantees:
      - subject: Glossary store file format
        version_range: 1.x
        breaks_if: A new required field is added without a migration path.
  limits:
    - id: KL-001
      statement: >-
        Define batch size cap is fifty per call and the project total cap is
        five hundred entries; larger imports must be chunked across calls.
    - id: KL-002
      statement: >-
        removeGlossary returns affected card keys but does not transition them
        to drifted; the next check-drift run surfaces them as glossary_broken
        and the operator transitions the status explicitly via card set-status.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          A define batch with one invalid entry leaves zero new persisted
          entries (all-or-nothing).
        method: >-
          Integration test asserting a batch with one bad entry persists
          nothing.
      verifies:
        - S-F-01
    - id: SC-002
      type: binary
      measure:
        predicate: >-
          A rename updates the YAML store first and then the indexed glossary
          field on every referencing card, reverting the store write if the DB
          step fails.
        method: Integration test asserting two-step rename with revert-on-DB-failure.
      verifies:
        - S-H-02
    - id: SC-003
      type: binary
      measure:
        predicate: >-
          A ten-entry define batch persists all ten and a subsequent lookup
          returns each entry.
        method: >-
          Integration test asserting a ten-entry batch is fully persisted and
          retrievable.
      verifies:
        - S-H-01
    - id: SC-004
      type: binary
      measure:
        predicate: removeGlossary without explicit confirmation removes nothing.
        method: Integration test asserting remove without --yes performs no deletion.
      verifies:
        - S-F-02
    - id: SC-005
      type: binary
      measure:
        predicate: >-
          resetEmberdeck with confirmation clears all cards and glossary
          entries; without confirmation it removes nothing.
        method: Integration test asserting full wipe with --yes and no-op without it.
      verifies:
        - S-H-03
        - S-F-03
  rationale:
    alternatives:
      - option: Per-entry define (no batch).
        pros:
          - Simpler atomicity model.
        cons:
          - Bulk imports become slow and partially-applied on failure.
      - option: >-
          Auto-cascade remove (delete references silently and mark cards drifted
          in the same op).
        pros:
          - No manual follow-up required.
        cons:
          - >-
            Hides intent; conflates remove with status transition (which is
            operator-decided per the drift principle).
    chosen:
      option: >-
        Batched all-or-nothing define with explicit size and length caps;
        confirmation-gated remove that surfaces affected cards; two-step rename
        (store write then DB update with revert on failure) with best-effort
        markdown rewrites.
      reasoning: >-
        Matches the all-or-nothing contract documented in the per-command spec
        cards and respects operator agency on destructive operations.
    addresses:
      - KL-001
      - KL-002
---
