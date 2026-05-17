/**
 * Shared types for the sync surface (sync-in / validate / export submodules).
 * Lives next to the submodules so each file can re-import without a cycle.
 */

import type { CardRow } from '../../db/repository';

export interface BulkSyncResult {
  synced: number;
  errors: Array<{ filePath: string; error: unknown }>;
}

export interface ValidationWarning {
  type: string;
  cardKey: string;
  message: string;
}

export interface CardValidationResult {
  staleDbRows: CardRow[];
  orphanFiles: string[];
  keyMismatches: Array<{ row: CardRow; expectedKey: string }>;
  warnings: ValidationWarning[];
}

export interface CardSyncFailure {
  filePath: string;
  error: string;
}
