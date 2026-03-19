---
{key: policy-gildash-graceful-degradation,summary: "Gildash (code index) is optional; when absent, code link features are disabled but all other functionality works normally",status: draft,type: decision,priority: high,acceptance: [{id: ac-1,description: "setupEmberdeck succeeds even when Gildash.open fails, with ctx.gildash set to undefined",verified: false},{id: ac-2,description: Operations that require gildash throw GildashNotConfiguredError (not TypeError) when ctx.gildash is undefined,verified: false},{id: ac-3,description: "checkDrift and getCardContext produce valid results without gildash, omitting code-link-dependent data",verified: false}],keywords: [gildash,GildashNotConfiguredError,projectRoot,code-links,optional],tags: [policy,graceful-degradation,gildash],codeLinks: [{kind: function,file: src/setup.ts,symbol: setupEmberdeck},{kind: class,file: src/card/errors.ts,symbol: GildashNotConfiguredError},{kind: function,file: src/ops/link.ts,symbol: validateCodeLinks},{kind: function,file: src/ops/spec-sync.ts,symbol: syncSpecAnnotations}]}
---
## Policy

Gildash integration is opt-in via `EmberdeckOptions.projectRoot`. When `projectRoot` is not set or gildash initialization fails, `ctx.gildash` is `undefined`. Operations that require gildash throw `GildashNotConfiguredError`. All other operations continue to work.

## Gildash-dependent operations

These operations require `ctx.gildash` and throw `GildashNotConfiguredError` when it is absent:
- `resolveCardCodeLinks`
- `validateCodeLinks`
- `syncSpecAnnotations`
- `syncSymbolChanges`
- `getLinkCoverage`

## Gildash-optional operations

These operations check for gildash but degrade gracefully:
- `checkDrift`: skips broken link counting and stale file detection when gildash is absent. Drift score only reflects acceptance criteria health.
- `getCardContext`: returns empty `codeLinks` array when gildash is absent.

## Initialization resilience

`setupEmberdeck` wraps gildash initialization in try/catch. If `Gildash.open` fails or returns an error Result, gildash is set to `undefined` silently. The rest of the context initializes normally.

## What breaks if violated

- If a gildash-dependent operation does not check `ctx.gildash`, it will throw a runtime TypeError on method access.
- If gildash initialization failure crashes `setupEmberdeck`, the entire system becomes unusable even for non-code-link features.

## Exclusions

- Code links can still be stored on cards without gildash. They are just metadata. Only resolution/validation against the actual codebase requires gildash.