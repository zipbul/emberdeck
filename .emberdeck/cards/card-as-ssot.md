---
key: card-as-ssot
summary: >-
  Cards are the single source of truth for design knowledge; code derives from
  cards.
status: active
type: principle
glossary:
  - 4-tier
  - card-key
principle:
  statement: >-
    All design knowledge MUST live in cards as the single source of truth; code
    MUST derive from cards, not the other way around.
  rationale: >-
    Without a single authoritative location for design knowledge, decisions
    drift across docs, code comments, and tribal knowledge. Anchoring source of
    truth in cards (machine-readable, schema-validated, cross-ref enforced)
    prevents the divergence that makes large refactors and onboarding expensive.
    Code-level changes that alter contract surface require a card update first;
    otherwise validation and reviewers no longer have a stable reference.
  applies_to:
    - '*'
  enforcement: blocking
---
