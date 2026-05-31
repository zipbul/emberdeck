---
key: card-lifecycle/mutation-workflows/create-card
summary: >-
  createCard composes validation, parent resolution, file write, DB write, and
  changelog within a safe-write boundary.
status: active
type: spec
parent: card-lifecycle/mutation-workflows
glossary:
  - activation-guard
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes a CreateCardInput with key, type, summary and (for brief
        or spec) parent.
      derives: card-lifecycle/mutation-workflows#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        On success the card persists to file and DB atomically via the
        safe-write boundary. No changelog row is written by createCard (the
        changelog repo is not invoked in the success path). The result reports
        failedRelationTargets — declared relation targets that did not resolve
        at create time; the card is still persisted (an unresolved relation is
        not a create-time failure).
      keyword: MUST
      derives: card-lifecycle/mutation-workflows#G-001
    - id: POST-002a
      guarantee: >-
        On parent-not-found, hierarchy violation, key collision,
        glossary-validation failure, activation-guard failure, or any
        pre-storage validation failure, no file or indexed-cache row is written.
        The mutation is rejected before the forward action completes.
      keyword: SHALL
      derives: card-lifecycle/mutation-workflows#G-002
    - id: POST-002b
      guarantee: >-
        When the forward action (file or indexed-cache write) succeeded but the
        compensation/rollback step itself fails afterward (rare: e.g. file write
        succeeded then a downstream cleanup throws), createCard throws
        CompensationError and MAY leave partial state on disk or in the indexed
        cache. Both errors (originalError, compensationError) are surfaced on
        the CompensationError instance so the operator can repair.
      keyword: MUST
      derives: card-lifecycle/mutation-workflows#G-002
  invariants:
    - id: INV-001
      statement: createCard validates input through card-model before any storage call.
      always_holds: per-call
    - id: INV-002
      statement: >-
        A failed single-card mutation leaves no partial file or indexed-cache
        state for that card; safe-write compensates the cache row when the file
        step fails.
      always_holds: per-call
  failures:
    - violation: >-
        Input fails validation — including a frontmatter top-level key outside
        the closed CardFrontmatter set (e.g. a legacy codeLinks/boundary field,
        or unknown keys spread in from a `--from` JSON document).
      behavior: >-
        createCard throws CardValidationError naming the offending field(s); no
        file or DB row written. createCard delegates to validateCardInput, so
        closed-schema rejection applies to every input path (positional flags
        and `--from`) — unknown keys are never silently dropped.
      id: FAIL-001
    - violation: Card key already exists.
      behavior: createCard throws CardAlreadyExistsError.
      id: FAIL-002
    - violation: Parent key does not exist or violates the four-tier rule.
      behavior: createCard throws ParentValidationError.
      id: FAIL-003
      case_of: card-lifecycle/mutation-workflows#S-F-01
    - violation: >-
        Glossary field references a word that is not defined in the glossary
        store.
      behavior: createCard throws GlossaryValidationError; no file or DB row written.
      id: FAIL-004
    - violation: >-
        Card key is malformed (invalid slug, reserved characters, or
        normalization rules violation).
      behavior: createCard throws CardKeyError; no file or DB row written.
      id: FAIL-005
    - violation: >-
        Card created with status='active' but the activation guard's
        preconditions are not met (e.g. spec without @spec annotation).
      behavior: >-
        createCard throws ActivationGuardError with details.unmetConditions; no
        file or DB row written.
      id: FAIL-006
    - violation: >-
        Forward action succeeded but the compensation/rollback step itself fails
        (rare — DB write succeeded but a downstream cleanup throws).
      behavior: >-
        createCard throws CompensationError carrying both originalError and
        compensationError details; system may be in partial state requiring
        operator intervention.
      id: FAIL-007
---
