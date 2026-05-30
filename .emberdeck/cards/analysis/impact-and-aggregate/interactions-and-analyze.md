---
key: analysis/impact-and-aggregate/interactions-and-analyze
summary: >-
  checkInteractions detects shared-symbol, shared-file, import-dependency, and
  potential-conflict relationships; analyze aggregates health, coverage,
  drifted, glossary, and unlinkedSymbols in one call.
status: active
type: spec
parent: analysis/impact-and-aggregate
glossary:
  - drift
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes two or more card keys to checkInteractions (unknown keys
        produce empty entries rather than throwing). A single key is rejected —
        interactions require a pair.
      derives: analysis/impact-and-aggregate#G-003
    - id: PRE-002
      condition: >-
        The analyze op takes no arguments; it aggregates over the whole card
        set. (CLI-layer pagination flags --drifted-limit/--drifted-offset are
        applied after the op.)
      derives: analysis/impact-and-aggregate#G-004
  postconditions:
    - id: POST-001
      guarantee: >-
        checkInteractions returns { interactions: CardInteraction[],
        undefinedRelations: UndefinedRelation[] }. CardInteraction = { pair:
        [string, string], sharedSymbols: { file: string, symbol: string }[],
        sharedFiles: string[], importDependencies: { from: string, to: string,
        file: string }[], hasRelation: boolean, potentialConflicts: string[] }.
        UndefinedRelation = { pair: [string, string], suggestion: string }. Both
        nested types are concrete — every field name and type listed above is
        part of the op contract and the CLI command-spec stdout matches this
        shape (see cli-surface/.../commands/check-interactions POST-001).
      keyword: MUST
      derives: analysis/impact-and-aggregate#G-003
    - id: POST-002
      guarantee: >-
        analyze returns an object with FLAT top-level keys: { health (counts
        follow checkDrift's union rule — drifted = non-draft cards with a live
        driftType or DB status=drifted): { total, active, drifted, draft,
        brokenLinks, codeStats?: { files, symbols }, codeCycles?: { count,
        samples: string[][] } }, coverage: { totalSymbols, coveredSymbols,
        coverageRatio: number | null }, driftedCards: { key, summary,
        driftType?, brokenLinks, totalLinks }[], driftedCardsTotal, glossary: {
        unusedWords: string[], entries: { word, definition }[] },
        unlinkedSymbols: { file: string, symbol: string, kind: string }[] }. The
        CLI surface (ed analyze) restructures driftedCards/driftedCardsTotal
        into a nested drifted: { cards, total, limit, offset, hasMore } envelope
        for stdout (pagination is applied at the CLI layer). The full CLI shape
        is defined in cli-surface/.../commands/analyze POST-001. As a hygiene
        side effect, code-index changelog entries older than the configured
        retention window are pruned during the call.
      keyword: SHALL
      derives: analysis/impact-and-aggregate#G-004
  invariants:
    - id: INV-001
      statement: >-
        analyze read paths share the same code-index snapshot for the duration
        of the call (ensureReindexed is invoked at most once per context
        lifetime).
      always_holds: per-call
  failures:
    - violation: A target card key in checkInteractions does not exist.
      behavior: >-
        The unknown key is treated as empty (no symbols, no files, no imports)
        and the call continues; no exception is raised.
      id: FAIL-001
    - violation: code-index unavailable during analyze.
      behavior: >-
        analyze calls checkDrift and getUncoveredSymbols which both await
        ensureReindexed without a local catch; code-index initialization failure
        THROWS up through the analyze op. The caller (CLI runner) maps the
        thrown class via toCliError (GildashInitError → gildash-init-failed →
        exit 6; otherwise → internal-error → exit 1). No card-only fallback is
        returned on a code-index failure path.
      id: FAIL-002
---
