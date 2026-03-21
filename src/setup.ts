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
 * Initializes the emberdeck context.
 *
 * 1. Opens the SQLite DB and runs migrations.
 * 2. Creates repository instances.
 * 3. If `projectRoot` is specified, initializes gildash.
 *    On initialization failure, gildash is set to `undefined` and the code link feature is disabled.
 */
export async function setupEmberdeck(options: EmberdeckOptions): Promise<EmberdeckContext> {
  const db = createEmberdeckDb(options.dbPath);

  let gildash: Gildash | undefined;
  if (options.projectRoot) {
    try {
      const result = await Gildash.open({
        projectRoot: options.projectRoot,
        ignorePatterns: options.gildashIgnore,
      });
      if (isErr(result)) {
        gildash = undefined;
      } else {
        gildash = result;
      }
    } catch (e) {
      gildash = undefined;
    }
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
    coverageIgnore: options.coverageIgnore ?? [],
    regressionThreshold: options.regressionThreshold ?? 0,
    gildash,
  };
}

/**
 * Tears down the emberdeck context.
 *
 * Closes the gildash index and the SQLite DB connection.
 * Should be called before process exit or when recreating the context.
 */
export async function teardownEmberdeck(ctx: EmberdeckContext): Promise<void> {
  await ctx.gildash?.close();
  closeDb(ctx.db);
}
