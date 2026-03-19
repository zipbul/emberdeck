---
{key: policy-bulk-create-two-phase,summary: "Bulk card creation uses two-phase processing: create all cards without relations first, then apply relations, to resolve intra-batch dependencies",status: draft,type: decision,priority: medium,acceptance: [{id: ac-1,description: "Intra-batch relations (A depends-on B, both in same batch) succeed regardless of array order",verified: false},{id: ac-2,description: A failed card in phase 1 does not prevent other cards from being created,verified: false},{id: ac-3,description: A failed relation update in phase 2 removes the card from the success keys list,verified: false}],keywords: [bulkCreateCards,two-phase,partial-success,intra-batch],tags: [policy,bulk-operations],relations: [{type: depends-on,target: policy-relation-type-whitelist}],codeLinks: [{kind: function,file: src/ops/bulk-create.ts,symbol: bulkCreateCards}]}
---
## Policy

`bulkCreateCards` processes inputs in two phases:
1. **Phase 1**: Create all cards without their relations (strip relations from input).
2. **Phase 2**: Apply relations via `updateCard` for all cards that had them.

This ordering guarantees that intra-batch relations (card A depends-on card B, both in the same batch) resolve regardless of input array order.

## Partial success

Failed items in either phase are recorded in `errors` and skipped. Remaining items continue processing. The result reports both `created` count and `failed` count. If a relation update fails in phase 2, the card is removed from the `keys` array (it was created but is incomplete).

## What breaks if violated

- Single-phase processing would fail when card A has a relation to card B but B appears later in the array and does not exist yet.
- Relation validation would reject valid intra-batch references.

## Exclusions

- `bulkCreateCards` does NOT deduplicate inputs. If the same slug appears twice, the second will fail with `CardAlreadyExistsError`.
- Relations to cards outside the batch must already exist in the system.