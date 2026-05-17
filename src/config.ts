import type { IGildashAdapter } from './code-index/adapter';
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
  /** Code-index instance, accessed through the narrow port. Always
   *  initialized (setupEmberdeck throws if the backing engine fails to open). */
  gildash: IGildashAdapter;
}
