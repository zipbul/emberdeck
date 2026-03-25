---
{key: card-validation-rules,summary: "Size limits, input constraints, and activation guard contracts",status: active,type: spec,parent: card-model,boundary: [src/card/validation.ts],relations: [card-model],codeLinks: [{kind: function,file: src/card/validation.ts,symbol: validateCardInput},{kind: function,file: src/card/validation.ts,symbol: validateActivationGuard},{kind: variable,file: src/card/validation.ts,symbol: LIMITS}],tags: [contract,validation]}
---
## Contracts
- WHEN key length > 200 THEN reject with CardValidationError
- WHEN summary is empty or > 300 chars THEN reject
- WHEN body > 100,000 chars THEN reject
- WHEN tags/relations/codeLinks array > 100 items THEN reject
- WHEN boundary > 50 patterns THEN reject
- WHEN any tag/relation/boundary item is empty string THEN reject
- WHEN boundary pattern has invalid glob syntax THEN reject (tested via Bun.Glob constructor)
- WHEN spec card activates without codeLinks THEN reject with ActivationGuardError
- WHEN spec card activates AND gildash available AND any codeLink unresolved THEN reject
- WHEN spec card activates AND boundary present AND no pattern matches indexed files THEN reject
- WHEN intent card activates THEN always pass (no conditions)
- WHEN gildash unavailable THEN activation guard checks codeLink count only, skips resolution

## Failure modes
| Symptom | Cause | Resolution |
|---------|-------|------------|
| Active spec with broken links | Gildash was unavailable at activation time | Re-validate when gildash becomes available |
| Validation passes but card is immediately drifted | Activation guard passed without gildash, then drift check runs with gildash | Expected behavior — activation is best-effort without gildash |

## Cross-module contracts
- validateCardInput is called by create and update ops before any DB write
- validateActivationGuard is called when status=active on create, or on status transition to active
- Type change from intent→spec on active card re-triggers activation guard via validateTypeChangeActivation; may force to draft if conditions unmet