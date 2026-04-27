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
      const mergedIgnore = [
        ...(options.gildashIgnore ?? []),
        ...(options.ignorePatterns ?? []),
      ];
      const result = await Gildash.open({
        projectRoot: options.projectRoot,
        ignorePatterns: mergedIgnore.length > 0 ? mergedIgnore : undefined,
      });
      if (isErr(result)) {
        process.stderr.write(`[emberdeck] gildash init error: ${JSON.stringify(result.data)}\n`);
        gildash = undefined;
      } else {
        gildash = result;
      }
    } catch (e) {
      process.stderr.write(`[emberdeck] gildash init exception: ${e instanceof Error ? e.message : String(e)}\n`);
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
 */
export async function teardownEmberdeck(ctx: EmberdeckContext): Promise<void> {
  // Always close DB even if gildash.close throws — leaking a SQLite handle
  // (with WAL mode + lock files) is worse than swallowing a gildash close error.
  try {
    await ctx.gildash?.close();
  } finally {
    closeDb(ctx.db);
  }
}
