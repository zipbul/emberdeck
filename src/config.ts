import type { Gildash } from '@zipbul/gildash';
import type { EmberdeckDb } from './db/connection';
import type { CardRepository, RelationRepository, ClassificationRepository, CodeLinkRepository, ChangelogRepository } from './db/repository';

/**
 * Initialization options passed to `setupEmberdeck()`.
 */
export interface EmberdeckOptions {
  /** Absolute path to the directory where .json files are stored */
  cardsDir: string;
  /** Absolute path to the SQLite DB file. ':memory:' is allowed */
  dbPath: string;
  /** Absolute path to the project root. Required — emberdeck binds cards to code via gildash, so projectRoot is non-optional. */
  projectRoot: string;
  /** Additional gildash-specific ignore patterns (on top of ignorePatterns) */
  analysisIgnore?: string[];
  /** Glob patterns for files to exclude from coverage and gildash indexing */
  ignorePatterns?: string[];
  /** Regression guard threshold (0-1). 0 = any drifted card fails. Default: 0 */
  regressionThreshold?: number;
  /** [§10 P1.1] Open the card index read-only (write-free): no migration/WAL/entry-sync. */
  readonly?: boolean;
}

/**
 * Runtime context returned by `setupEmberdeck()`.
 * Passed as the first parameter to all ops functions.
 */
export interface EmberdeckContext {
  cardsDir: string;
  /** Project root directory. Always present (emberdeck requires gildash binding). */
  projectRoot: string;
  db: EmberdeckDb;
  cardRepo: CardRepository;
  relationRepo: RelationRepository;
  classificationRepo: ClassificationRepository;
  codeLinkRepo: CodeLinkRepository;
  changelogRepo: ChangelogRepository;
  /** Glob patterns for files to exclude from coverage and gildash indexing */
  ignorePatterns: string[];
  /** Regression guard threshold (0-1). 0 = any drifted card fails */
  regressionThreshold: number;
  /** True when the DB was opened read-only (`--read-only`): no write is possible. */
  readonly: boolean;
  /** Gildash instance. Always initialized (setupEmberdeck throws if Gildash.open fails). */
  gildash: Gildash;
  /**
   * Optional diagnostic sink, injected by the CLI surface. Ops use this to
   * surface a non-fatal warning without depending on the CLI layer
   * (e.g. a best-effort rollback that partially failed). Undefined outside the
   * CLI (tests/embedding) — callers must treat it as optional (no-op).
   */
  emitWarning?: (obj: { code: string; message: string; details?: Record<string, unknown> }) => void;
}
