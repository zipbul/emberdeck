import { errorMessage } from './util/error';
import { Gildash } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';
import { createEmberdeckDb, closeDb } from './db/connection';
import { DrizzleCardRepository } from './db/card-repo';
import { DrizzleRelationRepository } from './db/relation-repo';
import { DrizzleClassificationRepository } from './db/classification-repo';
import { DrizzleCodeLinkRepository } from './db/code-link-repo';
import { DrizzleChangelogRepository } from './db/changelog-repo';
import type { EmberdeckContext, EmberdeckOptions } from './config';

/**
 * Thrown when `setupEmberdeck` cannot initialize gildash (missing projectRoot,
 * unindexable source tree, etc.). Surfaced as a config-class error to callers.
 * @spec cli-surface/project-setup/setup-config-root
 */
export class GildashInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GildashInitError';
  }
}

/**
 * Initializes the emberdeck context.
 *
 * 1. Opens the SQLite DB and runs migrations.
 * 2. Initializes gildash against `projectRoot`. Failure is fatal — emberdeck
 *    is a card-to-code binding system and gildash is the binding.
 * 3. Creates repository instances.
 * @spec cli-surface/project-setup/setup-config-root
 */
export async function setupEmberdeck(options: EmberdeckOptions): Promise<EmberdeckContext> {
  const db = createEmberdeckDb(options.dbPath);

  const mergedIgnore = [
    ...(options.analysisIgnore ?? []),
    ...(options.ignorePatterns ?? []),
  ];
  let gildash: Gildash;
  try {
    const result = await Gildash.open({
      projectRoot: options.projectRoot,
      ignorePatterns: mergedIgnore.length > 0 ? mergedIgnore : undefined,
      watchMode: false,
    });
    if (isErr(result)) {
      closeDb(db);
      throw new GildashInitError(`gildash init failed: ${JSON.stringify(result.data)}`);
    }
    gildash = result;
  } catch (e) {
    if (e instanceof GildashInitError) throw e;
    closeDb(db);
    throw new GildashInitError(`gildash init failed: ${errorMessage(e)}`);
  }

  return {
    cardsDir: options.cardsDir,
    projectRoot: options.projectRoot,
    db,
    cardRepo: new DrizzleCardRepository(db),
    relationRepo: new DrizzleRelationRepository(db),
    classificationRepo: new DrizzleClassificationRepository(db),
    codeLinkRepo: new DrizzleCodeLinkRepository(db),
    changelogRepo: new DrizzleChangelogRepository(db),
    ignorePatterns: options.ignorePatterns ?? [],
    regressionThreshold: options.regressionThreshold ?? 0,
    gildash,
  };
}

/**
 * Tears down the emberdeck context.
 *
 * Closes the gildash index and the SQLite DB connection.
 * Should be called before process exit or when recreating the context.
 * @spec cli-surface/project-setup/setup-config-root
 */
export async function teardownEmberdeck(ctx: EmberdeckContext): Promise<void> {
  try {
    await ctx.gildash.close();
  } finally {
    closeDb(ctx.db);
  }
}
