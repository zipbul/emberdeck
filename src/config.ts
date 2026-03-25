import type { Gildash } from '@zipbul/gildash';
import type { EmberdeckDb } from './db/connection';
import type { CardRepository, RelationRepository, ClassificationRepository, CodeLinkRepository, ChangelogRepository } from './db/repository';

/**
 * Initialization options passed to `setupEmberdeck()`.
 */
export interface EmberdeckOptions {
  /** Absolute path to the directory where .card.md files are stored */
  cardsDir: string;
  /** Absolute path to the SQLite DB file. ':memory:' is allowed */
  dbPath: string;
  /** Absolute path to the project root for enabling gildash. Code link feature is disabled when not specified */
  projectRoot?: string;
  /** Additional gildash-specific ignore patterns (on top of ignorePatterns) */
  gildashIgnore?: string[];
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
  /** Project root directory. Available when projectRoot was specified in options. */
  projectRoot?: string;
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
  /** Gildash instance. undefined when projectRoot is not set or initialization fails */
  gildash?: Gildash;
}
