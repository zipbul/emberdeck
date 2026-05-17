/**
 * Narrow port for the code-index dependency.
 *
 * The full Gildash class exposes a wide surface; emberdeck only consumes the
 * 14 methods listed below. `IGildashAdapter` is `Pick<Gildash, ...>` over
 * exactly that set, so:
 *
 *  - Adding a new external API to Gildash does not silently expand emberdeck's
 *    coupling: a TypeScript error appears if a call site reaches past the
 *    documented surface.
 *  - Replacing the backing implementation (e.g. ts-morph, tree-sitter) means
 *    implementing exactly these 14 methods — no hidden requirements.
 *  - Tests can implement the interface directly instead of duck-typing against
 *    the Gildash class.
 *
 * The contract is "the API surface link-and-coverage and friends consume".
 * Keep this file in sync when adding or removing a code-index call site.
 *  @spec code-binding/link-and-coverage/resolve-and-validate
 */

import type { Gildash } from '@zipbul/gildash';

export type IGildashAdapter = Pick<
  Gildash,
  | 'close'
  | 'getAffected'
  | 'getCyclePaths'
  | 'getDependencies'
  | 'getDependents'
  | 'getFanMetrics'
  | 'getStats'
  | 'getSymbolChanges'
  | 'getSymbolsByFile'
  | 'hasCycle'
  | 'listIndexedFiles'
  | 'projects'
  | 'pruneChangelog'
  | 'reindex'
  | 'searchAnnotations'
>;
