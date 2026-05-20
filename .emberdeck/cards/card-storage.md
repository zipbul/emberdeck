---
key: card-storage
summary: >-
  Indexed cache schema, repositories, file-DB synchronization, and read-side
  queries for cards.
status: active
type: domain
glossary:
  - card-key
domain:
  overview: >
    Owns persistence: the indexed cache schema (cards, relations,
    classifications, code links, changelog),

    the repository layer that mediates SQL access, bidirectional synchronization
    between markdown

    card files on disk and database rows, and all read-side query surfaces (get,
    list, search via

    full-text index, tree, context, relation graph). The storage layer is the
    single source for any

    card-shaped read in the system.
  scope: >
    IN: schema migrations, repository interfaces and implementations,
    syncCardFromFile,

    bulkSyncCards, exportCardToFile, validateCards integrity sweep, getCard,
    listCards, searchCards,

    getCardTree, getCardContext, listCardRelations, getRelationGraph, JSON field
    encoding/decoding.


    OUT: business rules around when to mutate (delegated to card-lifecycle),
    code-link resolution

    against gildash (delegated to code-binding), drift detection.
  cross_domain_dependencies:
    - domain: card-model
      relationship: >-
        serializes and parses cards through the markdown frontmatter contract
        owned by card-model.
---
