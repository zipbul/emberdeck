---
key: analysis/drift-detection/check-drift
summary: >-
  checkDrift runs the broken_link and glossary_broken detectors per card and
  reports drift as a derived field; it never mutates card status.
status: active
type: spec
parent: analysis/drift-detection
glossary:
  - drift
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes an optional card key (scopes the report) and an optional
        max-depth for graph traversal.
      derives: analysis/drift-detection#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        Cards with detected drift receive a primary `driftType` plus a
        `driftTypes` array enumerating all detected types. Healthy cards (no
        broken_link, no glossary_broken) OMIT both `driftType` and `driftTypes`
        — these fields are present only when the card has at least one detected
        drift.
      keyword: MUST
      derives: analysis/drift-detection#G-001
    - id: POST-002
      guarantee: >-
        checkDrift performs zero writes — neither the card table nor card files
        are modified by detection.
      keyword: MUST
      derives: analysis/drift-detection#G-002
    - id: POST-003
      guarantee: >-
        Source bindings come from the DB code_link cache populated by `ed spec
        sync`; checkDrift never reparses source annotations.
      keyword: MUST
      derives: analysis/drift-detection#G-001
    - id: POST-004
      guarantee: >-
        Aggregate health counts in the response — health.total =
        targetKeys.length (requested keys), health.drifted = count of non-draft
        cards that either carry a non-empty driftType in the response OR have DB
        status=drifted, health.active = remaining non-draft cards, health.draft
        = cards whose DB status=draft. The three categories
        (active/drifted/draft) partition the present cards; missing target keys
        contribute to health.total but not to active/drifted/draft.
      keyword: MUST
      derives: analysis/drift-detection#G-003
  invariants:
    - id: INV-001
      statement: >-
        Repeated invocations on identical project state return equal responses.
        checkDrift is idempotent.
      always_holds: cross-call
    - id: INV-002
      statement: >-
        broken_link is reported whenever a declared link's symbol does not
        resolve in the current gildash result — including when the result is a
        successful empty list. An empty index therefore still increments
        brokenLinks for every unresolved symbol; only individual lookup THROWS
        (transient errors, distinguished from successful-empty) are treated as
        'no information' (see INV-003). Operators relying on 'empty index = no
        drift' must short-circuit checkDrift externally.
      always_holds: per-call
    - id: INV-003
      statement: >-
        Individual gildash lookup failures (THROWS) inside the per-link loop are
        best-effort and never inflate brokenLinks; they are silently skipped so
        a transient gildash hiccup cannot manufacture false drift.
        (Successful-but-empty lookups still count as unresolved — see INV-002.)
      always_holds: per-call
    - id: INV-004
      statement: >-
        checkDrift never writes to the card table or to card files; it is a
        read-only pass.
      always_holds: cross-call
    - id: INV-005
      statement: >-
        Drift is a derived fact reported only via driftType / driftTypes on the
        response; it is never persisted.
      always_holds: cross-call
    - id: INV-006
      statement: >-
        health.drifted equals the number of non-draft cards that either carry a
        driftType in the response or whose stored status is drifted.
        health.active equals the remaining non-draft cards. health.draft equals
        cards whose stored status is draft. The three categories partition every
        targeted card present in storage; a requested key that is missing
        contributes to health.total but to none of active, drifted, or draft.
      always_holds: per-call
  failures:
    - violation: ensureReindexed throws (gildash cannot reindex at all).
      behavior: >-
        The exception propagates up through checkDrift; no per-card output is
        produced and no writes occur (consistent with POST-002).
      id: FAIL-001
    - violation: >-
        An individual symbol lookup throws inside the per-link loop (transient
        gildash error on one query).
      behavior: >-
        That link is skipped — not counted as broken. brokenLinks reflects only
        links whose successful lookup returned no match. driftType is set only
        when at least one link's lookup returned successfully-empty (= confirmed
        missing).
      id: FAIL-002
    - violation: An expected card key (from optional [key] arg) is not in the DB.
      behavior: >-
        The missing key is silently skipped from per-card output (no
        driftType/driftTypes for it). HOWEVER `health.total` is set to
        `targetKeys.length` (the requested keys, INCLUDING missing ones);
        active/drifted/draft counts reflect only present cards. So
        `health.active + health.drifted + health.draft <= health.total`.
      id: FAIL-003
    - violation: loadGlossary (glossary store read) throws inside checkDrift.
      behavior: >-
        The exception propagates up; no per-card output is produced and no
        writes occur (consistent with POST-002). Callers see the underlying I/O
        / parse error; partial results are not emitted.
      id: FAIL-004
---
