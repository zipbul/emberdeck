---
{key: policy-relation-type-whitelist,summary: Relations between cards must use a type from the allowedRelationTypes whitelist; unregistered types are rejected at write time,status: draft,type: decision,priority: high,acceptance: [{id: ac-1,description: createCard and updateCard reject relations with types not in ctx.allowedRelationTypes before touching DB or file,verified: false},{id: ac-2,description: RelationTypeError message includes both the invalid type and the full list of allowed types,verified: false},{id: ac-3,description: addRelationType is idempotent — calling it twice with the same type does not create duplicates,verified: false}],keywords: [allowedRelationTypes,RelationTypeError,addRelationType,relation-whitelist],tags: [policy,relations,validation],relations: [{type: related,target: policy-db-file-consistency}],codeLinks: [{kind: variable,file: src/config.ts,symbol: DEFAULT_RELATION_TYPES},{kind: function,file: src/config.ts,symbol: addRelationType},{kind: class,file: src/card/errors.ts,symbol: RelationTypeError}]}
---
## Policy

Every relation written to a card (via `createCard` or `updateCard`) must have a `type` value present in `ctx.allowedRelationTypes`. If the type is not in the list, the operation throws `RelationTypeError` before any DB or file write occurs.

## Defaults

`DEFAULT_RELATION_TYPES`: `depends-on`, `references`, `related`, `extends`, `conflicts`.

## Extension mechanism

`addRelationType(ctx, type)` appends a new type to the runtime list (idempotent, no duplicates). `removeRelationType(ctx, type)` removes it. These only affect the in-memory context; there is no persistent config for custom types.

## What breaks if violated

- Typos in relation types (e.g. `depnds-on`) silently create uncategorizable edges in the relation graph.
- BFS traversal and impact analysis become unreliable when edge types have no semantic meaning.
- Cards with invalid relation types cannot be meaningfully queried by type.

## Exclusions

- `syncCardFromFile` does NOT validate relation types. It trusts the file content because it is a repair/import path. This means manually edited files can introduce unregistered types into the DB.
- The validation is per-operation, not per-DB. The DB schema does not enforce the whitelist.