---
key: glossary
summary: Domain term lifecycle and cross-card glossary validation.
status: active
type: domain
glossary:
  - drift
domain:
  overview: >
    Owns the project glossary: defining terms with definitions, looking them up,
    removing

    and renaming with cascading updates to cards that reference them, and
    validating that

    glossary words declared on cards still exist. A glossary entry encodes a
    project-specific

    design decision and is the canonical place to look up what a domain term
    means.
  scope: >
    IN: defineGlossary, lookupGlossary, removeGlossary, renameGlossary with
    card-glossary-field

    cascade, validateCardGlossaryField, glossary-broken drift signal
    contribution, persistent

    storage of glossary entries.


    OUT: free-text indexing of card bodies, NLP, suggesting which terms to add
    (delegated to

    analysis suggestions).
---
