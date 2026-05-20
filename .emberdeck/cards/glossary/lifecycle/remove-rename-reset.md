---
key: glossary/lifecycle/remove-rename-reset
summary: >-
  removeGlossary and renameGlossary cascade across cards; resetEmberdeck wipes
  both glossary and cards.
status: active
type: spec
parent: glossary/lifecycle
glossary:
  - drift
spec:
  preconditions:
    - id: PRE-001
      condition: Caller passes a word and explicit confirmation flag.
      derives: glossary/lifecycle#G-003
  postconditions:
    - id: POST-001
      guarantee: >-
        renameGlossary persists in TWO STEPS (NOT a single transaction): (1)
        glossary.yaml is rewritten FIRST via writeGlossary, then (2) a DB
        transaction updates the indexed glossary fields of every referencing
        card and writes per-card changelog rows. If the DB transaction throws,
        glossary.yaml is REVERTED to the original entries (best-effort
        rollback). Per-card markdown body rewrites are a third best-effort step
        OUTSIDE both — failures accumulated in `fileWriteFailures[]` on the
        result; the rename itself still commits.
      keyword: MUST
      derives: glossary/lifecycle#G-002
    - id: POST-002
      guarantee: >-
        removeGlossary marks referencing cards as drifted candidates rather than
        auto-editing them.
      keyword: SHALL
      derives: glossary/lifecycle#G-003
    - id: POST-003
      guarantee: >-
        resetEmberdeck attempts to remove all cards and glossary entries; the
        CLI requires destructive confirmation (a --yes flag, or an interactive
        prompt in a TTY; non-TTY without --yes is refused via
        confirmDestructive). Best-effort: per-row DB delete failures, per-file
        unlink failures, and glossary-store reset failures are SILENTLY
        SWALLOWED — they do not abort the reset and are not surfaced on stderr.
        The result object's `failedFileDeletes[]` exposes file-level failures so
        the operator can rerun or repair; DB-row and glossary-reset failures are
        not in the result.
      keyword: MUST
      derives: glossary/lifecycle#G-004
  invariants:
    - id: INV-001
      statement: >-
        Destructive ops (removeGlossary, resetEmberdeck) require explicit
        confirmation at the CLI layer.
      always_holds: per-call
  failures:
    - violation: renameGlossary target word already exists.
      behavior: Throws GlossaryValidationError; no rename performed.
    - violation: >-
        renameGlossary or removeGlossary target word does not exist in the
        glossary store.
      behavior: Throws GlossaryNotFoundError; no rename or removal performed.
    - violation: >-
        renameGlossary cascade write to a referencing card's markdown file
        fails.
      behavior: >-
        The rename still completes; the offending file path is recorded in
        fileWriteFailures[]; no exception is raised.
    - violation: >-
        resetEmberdeck encounters per-row DB delete, per-file unlink, or
        glossary-store reset errors.
      behavior: >-
        File-level unlink failures appear in failedFileDeletes[]. DB-row and
        glossary-store reset failures are swallowed silently and not surfaced in
        the result.
---
