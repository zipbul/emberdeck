---
key: card-model/round-trip
summary: >-
  Symmetric parse and serialize of card markdown files so on-disk and in-memory
  representations are interchangeable.
status: draft
type: brief
parent: card-model
glossary:
  - card-key
brief:
  context:
    problem: >
      Cards live both in SQLite and as on-disk markdown files (`*.card.md` with
      YAML frontmatter

      plus optional body). Bulk-sync, export, and direct user edits all rely on
      the round-trip

      between these two forms being lossless. If serialization drops a field or
      parsing accepts

      malformed frontmatter, files and DB diverge, breaking the source-of-truth
      promise.
    impact:
      - statement: >-
          Lost round-trip fidelity causes silent data loss on bulk-sync from
          files; user edits get reverted by the next sync.
      - statement: >-
          Inconsistent key encoding between filename and frontmatter produces
          key-mismatch warnings that block validation.
  scope:
    goals:
      - id: G-001
        statement: >-
          Parse and serialize every supported card type with byte-stable
          round-trip after re-serialization.
      - id: G-002
        statement: >-
          Reject malformed frontmatter with a clear error rather than silently
          dropping fields.
    non_goals:
      - id: NG-001
        statement: >-
          Preserving comments or original key ordering in YAML (round-trip is
          canonical, not textual).
    assumptions:
      - id: A-001
        statement: All cards on disk use UTF-8 with LF line endings.
        verification: Inspect existing card files in .emberdeck/cards/.
        reevaluate_when: A user reports cross-platform CRLF problems.
  flow:
    - id: S-H-01
      kind: happy
      given: A markdown card file with valid frontmatter for a brief card.
      when: >-
        parseCardMarkdown is called and serializeCardMarkdown is then called on
        the parsed CardFile.
      then: >-
        The re-serialized output equals the canonical form (idempotent on second
        pass).
      covers:
        - G-001
    - id: S-F-01
      kind: failure
      given: A markdown file whose YAML frontmatter is syntactically invalid.
      when: parseCardMarkdown is called.
      then: >-
        A descriptive parse error is thrown identifying line and column without
        partial card construction.
      covers:
        - G-002
  design:
    overview: >
      parseCardMarkdown splits the document at the frontmatter delimiter, parses
      YAML into a typed

      frontmatter object, and validates type-specific body fields.
      serializeCardMarkdown emits a

      canonical YAML form (sorted keys per type, fixed delimiter style) and
      re-attaches the body.
    components:
      - name: parseCardMarkdown
        responsibility: >-
          Read raw markdown and produce a CardFile object with typed frontmatter
          and body.
        interacts_with:
          - serializeCardMarkdown
      - name: serializeCardMarkdown
        responsibility: Render a CardFile back to canonical markdown ready for disk write.
        interacts_with:
          - parseCardMarkdown
    data_flow: []
    invariants:
      - id: DI-001
        statement: >-
          serializeCardMarkdown(parseCardMarkdown(text)) is idempotent after the
          first pass.
      - id: DI-002
        statement: >-
          Partial parse results never escape parseCardMarkdown when an error
          occurs.
  policy:
    - id: R-001
      subject: Card serialization
      keyword: MUST
      predicate: >-
        emit a canonical key ordering so two equivalent CardFile objects produce
        identical output bytes.
      governs:
        - S-H-01
    - id: R-002
      subject: Frontmatter parsing
      keyword: MUST
      predicate: >-
        throw on syntactically invalid YAML rather than returning a partial
        CardFile.
      governs:
        - S-F-01
  external:
    - id: C-001
      statement: >-
        YAML semantics follow the YAML 1.2 specification as implemented by the
        runtime YAML library.
      reference:
        title: YAML 1.2 specification
        locator: https://yaml.org/spec/1.2.2/
  compatibility:
    guarantees:
      - subject: Card file format
        version_range: 1.x
        breaks_if: >-
          A new required frontmatter field is added without a migration path for
          existing files.
  limits:
    - id: KL-001
      statement: >-
        Round-trip is canonical, not byte-preserving for arbitrary input —
        comments and key order are normalized.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          Round-trip is idempotent across all four card types in the integration
          suite.
        method: >-
          Property test that fuzzes valid frontmatter and asserts
          serialize(parse(serialize(parse(x)))) equals serialize(parse(x)).
      verifies:
        - S-H-01
    - id: SC-002
      type: binary
      measure:
        predicate: Malformed YAML never produces a partially constructed CardFile.
        method: Unit test on parseCardMarkdown with broken frontmatter inputs.
      verifies:
        - S-F-01
  rationale:
    alternatives:
      - option: Store cards only in SQLite and never on disk.
        pros:
          - No round-trip required.
        cons:
          - Loses the design goal that cards are user-editable source of truth.
      - option: Preserve original textual formatting verbatim.
        pros:
          - Friendlier to manual edits.
        cons:
          - Requires a CST-style YAML library and complicates merge tooling.
    chosen:
      option: Canonical YAML round-trip with type-aware key ordering.
      reasoning: >-
        Cards are the source of truth conceptually but tooling owns the file
        format; canonical output supports diffability without comment fidelity
        overhead.
    addresses:
      - KL-001
---
