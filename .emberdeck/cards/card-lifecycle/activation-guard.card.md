---
{key: card-lifecycle/activation-guard,summary: "Activation preconditions: brief requires 8 sections, spec requires resolved codeLinks and 3 sections",status: draft,type: spec,parent: card-lifecycle,boundary: [src/card/validation.ts,src/brief/validate.ts],codeLinks: [{kind: function,file: src/card/validation.ts,symbol: validateActivationGuard},{kind: function,file: src/brief/validate.ts,symbol: validateBriefSections},{kind: function,file: src/brief/validate.ts,symbol: validateSpecSections},{kind: class,file: src/card/errors.ts,symbol: ActivationGuardError}],glossary: [activation-guard],relations: [card-lifecycle]}
---

## Contract
- GIVEN a brief card is being set to active status
  WHEN the body is checked
  THEN all 8 required sections (Motivation, Scope, Scenario, Rule, Constraint, Risk, Criteria, Decision) MUST be present.
- GIVEN a spec card is being set to active status
  WHEN the code links and body are checked
  THEN at least 1 code link MUST resolve AND all 3 required sections (Contract, Invariant, Failure) MUST be present.
- GIVEN a spec card has code links and the symbol index is available
  WHEN validateActivationGuard runs
  THEN each code link MUST be verified against the symbol index by exact name and file path match.
- GIVEN a spec card has boundary patterns and the symbol index is available
  WHEN validateActivationGuard runs
  THEN at least 1 indexed file MUST match at least 1 boundary pattern.
- GIVEN a brief card is being set to active status
  WHEN validateActivationGuard runs
  THEN activation MUST succeed unconditionally (brief has no code link or boundary requirements).

## Invariant
- An active spec card MUST always have at least 1 resolved code link. There is no path to active status without this.
- An active brief card MUST always have all 8 required sections present. There is no path to active status without this.
- An active spec card MUST always have all 3 required sections present.
- Section validation checks structural presence (heading exists and content is non-empty), not content quality.

## Failure
| Violation | System behavior |
|-----------|----------------|
| Spec card has 0 code links | ActivationGuardError with unmet condition list |
| Spec code link does not resolve | ActivationGuardError listing each unresolved link |
| Spec boundary matches no indexed files | ActivationGuardError noting boundary mismatch |
| Brief missing required section | Error listing missing section names |
| Spec missing required section | Error listing missing section names |
| Symbol index unavailable for spec | Boundary check skipped; code link check proceeds |
