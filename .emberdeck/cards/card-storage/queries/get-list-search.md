---
key: card-storage/queries/get-list-search
summary: >-
  getCard, getCards, listCards, and searchCards form the read entry points for
  single, batch, filtered, and full-text retrieval.
status: active
type: spec
parent: card-storage/queries
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: Caller supplies a key, a filter object, or a search query string.
      derives: card-storage/queries#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        listCards composes filter inputs as conjunction returning the
        intersection.
      keyword: MUST
      derives: card-storage/queries#G-002
    - id: POST-002
      guarantee: >-
        searchCards validates FTS query syntax before execution and throws on
        failure.
      keyword: SHALL
      derives: card-storage/queries#G-003
    - id: POST-003
      guarantee: >-
        getCard performs a single lookup and throws CardNotFoundError when the
        key is absent. getCards performs a batch lookup, returning the found
        cards and collecting unknown keys in notFound[] rather than throwing.
      keyword: MUST
      derives: card-storage/queries#G-001
    - id: POST-004
      guarantee: >-
        findCardsByGlossaryWord and findCardsBySymbol are filtered-list reads
        returning the matching cards as a list; listCardRelations returns the
        card's forward and reverse relation rows (two directional lists). All
        three never throw on no match — an empty result is returned, sharing
        listCards' conjunctive-filter, empty-on-no-match semantics.
      keyword: MUST
      derives: card-storage/queries#G-001
  invariants:
    - id: INV-001
      statement: >-
        Read entries return typed result shapes without leaking raw repository
        rows.
      always_holds: per-call
  failures:
    - violation: A getCard target key does not exist.
      behavior: getCard throws CardNotFoundError.
    - violation: searchCards receives a malformed FTS query.
      behavior: searchCards throws FtsSyntaxError; CLI exit code 2.
---
