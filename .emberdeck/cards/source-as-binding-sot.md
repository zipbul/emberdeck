---
key: source-as-binding-sot
summary: >-
  Spec card source bindings live only in @spec JSDoc annotations, not in card
  frontmatter.
status: active
type: principle
glossary:
  - spec-annotation
  - codeLink
principle:
  statement: >-
    Spec card source bindings MUST be expressed only via the /** @spec
    <card-key> */ JSDoc annotation in source code; card frontmatter MUST NOT
    declare binding fields such as codeLinks or boundary. (Applies primarily to
    spec cards; type-gated by enforcement at validation time.)
  rationale: >-
    Earlier designs let cards declare codeLinks directly in YAML. The dual-write
    contract between card and source produced silent drift whenever a symbol was
    renamed, moved, or removed without an accompanying card edit. Pinning the
    binding source of truth to the source side and having spec-sync populate the
    indexed cache from annotations eliminates the dual-write problem; refactors
    become observable through validation alone.
  applies_to:
    - '*'
  enforcement: advisory
  verify:
    class: prose
---
