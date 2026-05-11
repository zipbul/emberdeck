---
key: code-binding
summary: >-
  codeLinks resolution, gildash delegation, spec annotation round-trip, and
  coverage measurement.
status: draft
type: domain
glossary:
  - codeLink
  - boundary
  - gildash
  - spec-annotation
domain:
  overview: >
    Owns the bridge between cards and source code. Resolves spec codeLinks
    against the gildash code

    index, evaluates boundary globs to scope code-pattern checks, and maintains
    the round-trip between

    database codeLinks and the @spec JSDoc annotations injected into source
    files. Also produces

    coverage views (which symbols are covered by which spec, which are
    uncovered) and

    suggestion output for proposing new card scope.
  scope: >
    IN: codeLink resolution, broken-link detection, boundary glob evaluation,
    spec annotate

    (additive plus prune), spec sync from source, sync-symbols on rename or
    move, getLinkCoverage,

    getUncoveredSymbols, suggestCardScope, gildash adapter usage policy.


    OUT: drift classification (delegated to analysis), card mutations (delegated
    to card-lifecycle),

    CLI output formatting.
  cross_domain_dependencies:
    - domain: card-storage
      relationship: reads codeLinks and writes back changelog entries through repositories.
---
