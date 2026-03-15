import type { Gildash } from '@zipbul/gildash';
import type { EmberdeckDb } from './db/connection';
import type { CardRepository, RelationRepository, ClassificationRepository, CodeLinkRepository, ChangelogRepository } from './db/repository';

export const DEFAULT_RELATION_TYPES = [
  'depends-on',
  'references',
  'related',
  'extends',
  'conflicts',
] as const;

export type DefaultRelationType = (typeof DEFAULT_RELATION_TYPES)[number];

/**
 * Initialization options passed to `setupEmberdeck()`.
 */
export interface EmberdeckOptions {
  /** Absolute path to the directory where .card.md files are stored */
  cardsDir: string;
  /** Absolute path to the SQLite DB file. ':memory:' is allowed */
  dbPath: string;
  /** Allowed relation types. Uses DEFAULT_RELATION_TYPES when not specified */
  allowedRelationTypes?: readonly string[];
  /** Absolute path to the project root for enabling gildash. Code link feature is disabled when not specified */
  projectRoot?: string;
  /** Gildash ignore patterns. Default: ['node_modules', 'dist', '.zipbul'] */
  gildashIgnore?: string[];
}

/**
 * Runtime context returned by `setupEmberdeck()`.
 * Passed as the first parameter to all ops functions.
 *
 * @example
 * const ctx = await setupEmberdeck({ cardsDir: './cards', dbPath: './cards.db' });
 * await createCard(ctx, { slug: 'auth-token', summary: 'JWT token management' });
 */
export interface EmberdeckContext {
  cardsDir: string;
  db: EmberdeckDb;
  cardRepo: CardRepository;
  relationRepo: RelationRepository;
  classificationRepo: ClassificationRepository;
  codeLinkRepo: CodeLinkRepository;
  changelogRepo: ChangelogRepository;
  allowedRelationTypes: readonly string[];
  /** Gildash instance. undefined when projectRoot is not set or initialization fails */
  gildash?: Gildash;
}

/**
 * Adds a new type to the allowed relation types list in ctx.
 * Ignored if it already exists (prevents duplicates).
 */
export function addRelationType(ctx: EmberdeckContext, type: string): void {
  if (!ctx.allowedRelationTypes.includes(type)) {
    ctx.allowedRelationTypes = [...ctx.allowedRelationTypes, type];
  }
}

/**
 * Removes a type from the allowed relation types list in ctx.
 * No-op if the type does not exist.
 */
export function removeRelationType(ctx: EmberdeckContext, type: string): void {
  ctx.allowedRelationTypes = ctx.allowedRelationTypes.filter((t) => t !== type);
}

/**
 * Returns the current allowed relation types list from ctx.
 */
export function listRelationTypes(ctx: EmberdeckContext): readonly string[] {
  return ctx.allowedRelationTypes;
}
