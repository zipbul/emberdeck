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
        resolveCardCodeLinks returns per-link valid or broken status without
        partial omission.
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
---
