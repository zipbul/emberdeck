---
key: card-model/round-trip/parse-and-serialize
summary: >-
  parseCardMarkdown and serializeCardMarkdown form the canonical round-trip used
  by sync, export, and bulk-create.
status: active
type: spec
parent: card-model/round-trip
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Input text is a UTF-8 markdown document with YAML frontmatter delimited
        by triple-dash.
      derives: card-model/round-trip#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        serializeCardMarkdown applied to parseCardMarkdown output is idempotent
        on the second pass.
      keyword: MUST
      derives: card-model/round-trip#G-001
    - id: POST-002
      guarantee: >-
        parseCardMarkdown rejects malformed frontmatter rather than returning a
        partial CardFile or silently dropping fields: syntactically invalid YAML
        throws a parse error, and well-formed YAML carrying top-level
        frontmatter keys outside the closed CardFrontmatter set (key, summary,
        status, type, parent, relations, tags, glossary, principle, domain,
        brief, spec) throws a validation error naming the unknown key(s).
        Unknown keys are never silently discarded.
      keyword: SHALL
      derives: card-model/round-trip#G-002
  invariants:
    - id: INV-001
      statement: >-
        serializeCardMarkdown emits a canonical key ordering per type so
        equivalent inputs produce identical bytes.
      always_holds: per-call
    - id: INV-002
      statement: >-
        serializeCardMarkdown(parseCardMarkdown(text)) is idempotent after the
        first pass.
      always_holds: per-call
    - id: INV-003
      statement: >-
        Partial parse results never escape parseCardMarkdown when an error
        occurs.
      always_holds: per-call
  failures:
    - violation: YAML frontmatter is syntactically invalid.
      behavior: >-
        parseCardMarkdown throws a parse error identifying the offending
        position; no CardFile is returned.
      id: FAIL-001
      case_of: card-model/round-trip#S-F-01
    - violation: >-
        Frontmatter is well-formed YAML but the structured frontmatter object
        fails serialize-side validation (e.g. missing required namespace,
        malformed field).
      behavior: >-
        serializeCardMarkdown throws CardValidationError identifying the
        offending field; no markdown is produced.
      id: FAIL-002
    - violation: >-
        Frontmatter is well-formed YAML but contains one or more top-level keys
        outside the closed CardFrontmatter set (e.g. legacy codeLinks or
        boundary, or a typo'd field).
      behavior: >-
        parseCardMarkdown throws a validation error enumerating the unknown
        key(s); no CardFile is returned. The unknown keys are NOT silently
        dropped — this is the enforcement boundary that upholds
        source-as-binding-sot (codeLinks/boundary must never live in
        frontmatter).
      id: FAIL-003
---
