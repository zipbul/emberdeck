---
{key: card-lifecycle/hierarchy,summary: "Parent-type hierarchy rules, circular reference detection, and children validation on type change",status: draft,type: spec,parent: card-lifecycle,relations: [card-lifecycle],codeLinks: [{kind: function,file: src/card/validation.ts,symbol: validateParentExists},{kind: function,file: src/card/validation.ts,symbol: validateParentType},{kind: function,file: src/card/validation.ts,symbol: validateParentCycle},{kind: function,file: src/card/validation.ts,symbol: validateChildrenHierarchy},{kind: function,file: src/card/validation.ts,symbol: validateRelationTargets}],glossary: [activation-guard]}
---

## Contract
- GIVEN a card specifies a parent
  WHEN the parent key is validated
  THEN the parent card MUST exist in the DB, otherwise ParentValidationError is thrown.
- GIVEN a brief card specifies a parent
  WHEN parent type is checked
  THEN the parent MUST be of type brief. Any other parent type MUST be rejected.
- GIVEN a spec card specifies a parent
  WHEN parent type is checked
  THEN the parent MUST be of type brief or spec. Any other parent type MUST be rejected.
- GIVEN a card update sets parent to another card
  WHEN the ancestor chain is walked
  THEN if the chain forms a cycle (reaches the card itself within 20 levels), ParentValidationError MUST be thrown.
- GIVEN an active card's type is changed
  WHEN the card has children
  THEN changing to spec MUST be rejected if any child is of type brief.

## Invariant
- The parent-child hierarchy MUST never contain cycles. Cycle detection walks up to 20 ancestor levels.
- A brief card MUST never have a non-brief parent at any point in its lifecycle.
- A spec card MUST never have a parent that is neither brief nor spec.
- Relation targets MUST exist in DB and MUST NOT be self-references.

## Failure
| Violation | System behavior |
|-----------|----------------|
| Parent card does not exist | ParentValidationError thrown |
| Brief card has non-brief parent | ParentValidationError thrown |
| Spec card has invalid parent type | ParentValidationError thrown |
| Circular parent reference detected | ParentValidationError thrown |
| Type change to spec with brief children | ParentValidationError thrown |
| Relation target does not exist | CardValidationError thrown |
| Relation is self-reference | CardValidationError thrown |
| Invalid card key format | CardKeyError thrown before validation |
