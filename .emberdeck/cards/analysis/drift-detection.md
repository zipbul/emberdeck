---
key: analysis/drift-detection
summary: >-
  broken_link / glossary_broken drift classification as a derived, read-only
  report — status mutation is the user's responsibility.
status: active
type: brief
parent: analysis
glossary:
  - drift
brief:
  context:
    problem: >-
      Cards make claims about code (cached code_link rows that mirror source
      `@spec` annotations) and about the project glossary. Without a single
      drift query that classifies divergence into stable categories, fixes are
      reactive and inconsistent and CI cannot enforce a regression threshold.
      Earlier iterations of this domain mutated card status as a side-effect of
      detection, which conflated a derived signal (drift) with a user
      declaration (status) and made `check drift` non-idempotent.
    impact:
      - statement: Without classified drift the user does not know which fix to apply.
      - statement: >-
          Without separation between detection and mutation the same `check`
          call returns different results on repeat invocations.
  scope:
    goals:
      - id: G-001
        statement: >-
          Detect the two drift types in scope: `broken_link` (a cached code_link
          no longer resolves against gildash) and `glossary_broken` (a card
          declares a glossary word the glossary no longer defines).
      - id: G-002
        statement: >-
          Surface drift exclusively as a derived field (`driftType`) on the
          response; never mutate the card's stored status as part of detection.
      - id: G-003
        statement: >-
          Report aggregate health counts (active / drifted / draft) that reflect
          the union of live drift detection and user-declared status, so a
          single response answers "what is currently drifted from the user's
          point of view" without a second query.
    non_goals:
      - id: NG-001
        statement: Applying drift fixes (delegated to card-lifecycle).
      - id: NG-002
        statement: Drift across non-source artifacts (e.g. configs).
      - id: NG-003
        statement: >-
          Mutating card status. Status is a user declaration owned by
          card-lifecycle (`ed card set-status`, `ed card update`).
    assumptions:
      - id: A-001
        statement: >-
          The two drift types currently in scope are sufficient — source
          bindings live entirely in `@spec` annotations so symbol rename and
          removal both surface as broken_link on the cache.
        verification: Inspect checkDrift() in src/ops/context.ts.
        reevaluate_when: A new authoring surface for bindings is added.
  flow:
    - id: S-H-01
      kind: happy
      given: >-
        An active spec whose cached code_link rows all resolve in gildash and
        whose declared glossary terms are all present.
      when: checkDrift runs.
      then: No driftType is set on the response card; the card stays active.
      covers:
        - G-001
    - id: S-H-02
      kind: happy
      given: A repeated `ed check drift` invocation on the same project state.
      when: The second call runs immediately after the first.
      then: The two responses are identical; no DB writes occurred between calls.
      covers:
        - G-002
    - id: S-H-03
      kind: happy
      given: >-
        Two cards in one project: one active with broken_link drift detected,
        one with DB status='drifted' but no current drift.
      when: checkDrift runs over all cards.
      then: >-
        Both are counted in health.drifted (union of live detection and stored
        declaration); health.active counts the remaining non-draft cards.
      covers:
        - G-003
    - id: S-F-01
      kind: failure
      given: An active spec whose cached code_link target was removed from source.
      when: checkDrift runs.
      then: >-
        broken_link drift is reported on the response card; the card's stored
        status remains unchanged.
      covers:
        - G-001
        - G-002
  policy:
    - id: R-001
      subject: Every detector
      keyword: MUST
      predicate: produce one of the documented driftTypes.
      governs:
        - S-F-01
    - id: R-002
      subject: checkDrift
      keyword: MUST NOT
      predicate: mutate any persisted state (DB rows or card files) as part of detection.
      governs:
        - S-F-01
        - S-H-02
    - id: R-003
      subject: checkDrift
      keyword: MUST
      predicate: >-
        omit driftType / driftTypes on the response card when every code_link
        resolves and every declared glossary term is present.
      governs:
        - S-H-01
    - id: R-004
      subject: checkDrift health aggregation
      keyword: MUST
      predicate: >-
        count a non-draft card as drifted when the card has either a non-empty
        driftType in the response or a DB status of 'drifted'; otherwise count
        it as active.
      governs:
        - S-H-03
  external:
    - id: C-001
      statement: >-
        The two driftType values (broken_link, glossary_broken) are defined by
        this domain's drift-detection specs, not by an external system.
      reference:
        title: spec analysis/drift-detection/check-drift
        locator: analysis/drift-detection/check-drift
  limits:
    - id: KL-001
      statement: >-
        Drift detection does not propose fixes; that is the user's
        responsibility.
    - id: KL-002
      statement: >-
        Drift is never stored. A consumer that wants a persistent "currently
        drifted" set must run checkDrift each time it asks the question.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          A removed source `@spec` target produces broken_link on the next
          checkDrift after `ed spec sync`.
        method: Integration test mutating source then running checkDrift.
      verifies:
        - S-F-01
    - id: SC-002
      type: binary
      measure:
        predicate: >-
          Two consecutive checkDrift invocations on the same project state
          return equal responses and produce no DB or file writes.
        method: Integration test snapshotting card table + file mtimes around calls.
      verifies:
        - S-H-02
    - id: SC-003
      type: binary
      measure:
        predicate: >-
          A spec with all code_link rows resolving and all glossary terms
          present yields a response card with driftType undefined.
        method: Integration test with a healthy fixture.
      verifies:
        - S-H-01
    - id: SC-004
      type: binary
      measure:
        predicate: >-
          Given one active card with detected broken_link and one card with DB
          status='drifted' but no current drift, health.drifted equals 2 and
          health.active equals 0 in the checkDrift response.
        method: Integration test in test/ops/context.test.ts using a mixed fixture.
      verifies:
        - S-H-03
  rationale:
    alternatives:
      - option: Single binary drift / no-drift signal.
        pros:
          - Simpler API.
        cons:
          - User cannot tell which kind of fix to apply
          - slowing repair loops.
      - option: Auto-transition active cards to drifted when drift is detected.
        pros:
          - Status field appears to reflect current detection state.
        cons:
          - Conflates a derived signal (drift) with a user declaration (status).
          - >-
            Makes `check drift` non-idempotent — repeat calls return different
            results.
          - >-
            Read-shaped command (`check`) silently writes, breaking CI
            reproducibility.
    chosen:
      option: >-
        Classified drift types reported exclusively as a derived field on the
        response; status mutation is delegated to explicit card-lifecycle
        commands; health counts use the union of live detection and stored
        declaration for a meaningful aggregate view.
      reasoning: >-
        Keeps `check` truly read-only and idempotent; preserves the clean
        separation between user-declared status and system-detected drift; gives
        one response that answers "what is currently drifted" without forcing
        the caller to merge two queries.
    addresses:
      - KL-001
      - KL-002
  approach: >-
    Drift detection is read-only. For each card it reads the cached code
    bindings and the declared glossary, verifies each binding against the code
    index and each word against the glossary, and classifies any divergence into
    drift types — a primary type plus the full set. A broken link is reported
    whenever a declared binding does not resolve, including against a
    successfully empty index, while transient lookup failures are skipped so
    they cannot manufacture false drift. Drift is a derived fact carried only on
    the response; it is never written back to the card row or file, and repeated
    runs over identical state are idempotent. Aggregate health counts partition
    the targeted cards into draft, drifted, and active, where drifted is the
    union of a live-detected drift type and a stored drifted status; a requested
    key absent from storage counts toward the total but toward none of the three
    categories.
---
