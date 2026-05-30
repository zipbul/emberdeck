---
key: code-binding/link-and-coverage/resolve-and-validate
summary: >-
  ensureReindexed, resolveCardCodeLinks, and findCardsBySymbol read the cached
  code_link rows and ask gildash to verify each symbol still exists.
status: active
type: spec
parent: code-binding/link-and-coverage
glossary:
  - codeLink
  - gildash
spec:
  preconditions:
    - id: PRE-001
      condition: Runtime context includes a gildash adapter.
      derives: code-binding/link-and-coverage#G-001
  postconditions:
    - id: POST-001
      guarantee: Every link query refreshes gildash via ensureReindexed before lookup.
      keyword: MUST
      derives: code-binding/link-and-coverage#G-001
    - id: POST-002
      guarantee: >-
        resolveCardCodeLinks returns per-link valid, broken, or ioFailed status
        without partial omission (ioFailed marks a transient gildash lookup
        failure, distinct from a resolved-but-missing broken link).
      keyword: SHALL
      derives: code-binding/link-and-coverage#G-001
  invariants:
    - id: INV-001
      statement: >-
        All link reads see a consistent gildash snapshot for the duration of the
        call.
      always_holds: per-call
    - id: INV-002
      statement: >-
        The cached code_link rows are the sole input to resolution; the card
        frontmatter never carries codeLinks.
      always_holds: cross-call
  failures:
    - violation: The card has no rows in the code_link cache.
      behavior: >-
        resolveCardCodeLinks returns an empty array; validateCodeLinks returns
        declared=0 / valid=0 / broken=[] / planned=[].
      id: FAIL-001
    - violation: >-
        gildash is unavailable at op entry (binary missing, projectRoot not
        configured, backing-index open error).
      behavior: >-
        ensureReindexed(ctx) — called at the top of validateCodeLinks,
        resolveCardCodeLinks, and getUncoveredSymbols — throws. The throw
        propagates up through the op (no internal catch); callers see the
        original gildash error class, which the runner maps via toCliError
        (GildashInitError → gildash-init-failed → exit 6; otherwise →
        internal-error → exit 1). Per-symbol resolution failures during the loop
        are still distinguished — those produce per-link `gildash-unavailable`
        BrokenLink reasons; only the bootstrap failure propagates.
      id: FAIL-002
    - violation: >-
        gildash throws transiently while resolving an individual symbol
        (per-link lookup).
      behavior: >-
        That specific link is recorded as ioFailed (not as a broken link).
        validateCodeLinks continues with the remaining links; the result
        envelope reports `ioFailed` counts alongside `valid`/`broken` so callers
        can distinguish transient failure from real symbol absence.
      id: FAIL-003
    - violation: >-
        gildash reindex completes with a non-zero exit code or returns a
        malformed manifest (ensureReindexed cannot trust the index).
      behavior: >-
        ensureReindexed throws; the op aborts before any per-link work runs. No
        card receives partial resolution output. Callers observe the underlying
        gildash error and retry after reindexing the project.
      id: FAIL-004
    - violation: >-
        A card frontmatter still carries the legacy `codeLinks` or `boundary`
        field (violates source-as-binding-sot).
      behavior: >-
        This input is rejected by upstream schema validation (card-model) with
        `validation-error` (exit 2) before resolve-and-validate is invoked.
        resolve-and-validate itself never sees such a card; if it did (e.g.
        through an unsynced DB row), it would still ignore the frontmatter field
        — the code_link cache is the only binding source.
      id: FAIL-005
---
