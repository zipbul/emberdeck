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
      derives: glossary/lifecycle#G-002
  postconditions:
    - id: POST-001
      guarantee: >-
        renameGlossary updates the glossary store and indexed glossary fields of
        every referencing card in one transaction. Per-card markdown body
        rewrites are best-effort and NOT atomic — failures are accumulated in
        `failedFileWrites[]` on the result; the rename itself still commits. The
        op returns successfully whether or not all file writes succeed.
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
        resetEmberdeck attempts to remove all cards and glossary entries; CLI
        requires --yes. Best-effort: per-row DB delete failures, per-file unlink
        failures, and glossary-store reset failures are SILENTLY SWALLOWED —
        they do not abort the reset and are not surfaced on stderr. The result
        object's `failedFileDeletes[]` exposes file-level failures so the
        operator can rerun or repair; DB-row and glossary-reset failures are not
        in the result.
      keyword: MUST
      derives: glossary/lifecycle#G-001
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
        renameGlossary cascade write to a referencing card's markdown file
        fails.
      behavior: >-
        The rename still completes; the affected file is recorded in
        failedFileWrites[]; no exception is raised.
    - violation: >-
        resetEmberdeck encounters per-row DB delete, per-file unlink, or
        glossary-store reset errors.
      behavior: >-
        File-level unlink failures appear in failedFileDeletes[]. DB-row and
        glossary-store reset failures are swallowed silently and not surfaced in
        the result.
---
