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
      then: >-
        The CLI requires confirmation; nothing is removed without --yes or an
        accepted interactive prompt.
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
        require explicit confirmation (a --yes flag, or an accepted interactive
        prompt in a TTY; non-TTY without --yes is refused) before any
        persistence change; return affected card keys without mutating them.
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
  approach: >-
    The glossary store is a YAML file that is the source of truth; each card
    keeps its own glossary field, synced into the indexed cache, rather than a
    copy of the global store. Defining entries is an all-or-nothing batch capped
    per call and per project, with word and definition length limits; CLI
    pre-validation may set aside individual entries before the batch runs, but
    the batch itself never persists partially. Lookup reads entries by word or
    lists all. Removal is confirmation-gated: it returns the referencing card
    keys and never mutates them, leaving the operator to update their glossary
    fields or mark them drifted. Rename is a two-step write — the YAML store
    first, then the indexed glossary fields of every referencing card in a
    database transaction, reverting the YAML write if the database step fails —
    with per-card markdown rewrites as a best-effort third step whose individual
    failures are reported rather than thrown.
---
