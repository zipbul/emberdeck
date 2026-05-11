---
key: card-model
summary: >-
  Card schema, type-specific validation, and markdown serialization that defines
  what a valid card is.
status: draft
type: domain
glossary:
  - 4-tier
  - card-key
domain:
  overview: >
    Defines the data model that every card in emberdeck must conform to. Owns
    the four card types

    (principle, domain, brief, spec), their required and optional fields, the
    cross-reference rules

    that bind list items together (covers, governs, verifies, derives),
    and the on-disk

    markdown frontmatter representation. This is the grammar of cards: any
    card-shaped value crossing

    a system boundary is checked against rules defined here before persistence
    is attempted.
  scope: >
    IN: type discriminant, frontmatter schema, type-specific body validators
    (principle/domain/brief/spec),

    list-item id formats, cross-reference resolution within a single card,
    markdown frontmatter

    parse/serialize, card-key slug grammar, integrity rules across the four-tier
    hierarchy.


    OUT: persistence to SQLite, file IO, link resolution against gildash, drift
    detection, CLI surface.
  cross_domain_dependencies:
    - domain: glossary
      relationship: >-
        validates that glossary words declared on cards exist in the project
        glossary.
---
