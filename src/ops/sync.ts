/**
 * Barrel for the sync surface. The implementation lives in three submodules:
 *
 *  - sync/sync-in.ts: file → indexed-cache pipeline (ensureCardsSynced,
 *    syncCardFromFile, bulkSyncCards, listCardFiles).
 *  - sync/validate.ts: structural validation (detectKeyMismatches,
 *    validateCards).
 *  - sync/export.ts: indexed-cache → file (buildCardFromDb,
 *    exportCardToFile, removeCardByFile).
 *
 * Re-exporting keeps every existing caller's import path stable while letting
 * each concern live in its own ~250-line module.
 */
export type {
  BulkSyncResult,
  CardSyncFailure,
  CardValidationResult,
  ValidationWarning,
} from './sync/types';
export {
  ensureCardsSynced,
  syncCardFromFile,
  bulkSyncCards,
  listCardFiles,
} from './sync/sync-in';
export { detectKeyMismatches, validateCards } from './sync/validate';
export {
  buildCardFromDb,
  exportCardToFile,
  removeCardByFile,
} from './sync/export';
