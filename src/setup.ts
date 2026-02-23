import { Gildash } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';
import { createEmberdeckDb, closeDb } from './db/connection';
import { DrizzleCardRepository } from './db/card-repo';
import { DrizzleRelationRepository } from './db/relation-repo';
import { DrizzleClassificationRepository } from './db/classification-repo';
import { DrizzleCodeLinkRepository } from './db/code-link-repo';
import { DEFAULT_RELATION_TYPES, type EmberdeckContext, type EmberdeckOptions } from './config';

export async function setupEmberdeck(options: EmberdeckOptions): Promise<EmberdeckContext> {
  const db = createEmberdeckDb(options.dbPath);

  let gildash: Gildash | undefined;
  if (options.projectRoot) {
    const result = await Gildash.open({
      projectRoot: options.projectRoot,
      ignorePatterns: options.gildashIgnore,
    });
    if (isErr(result)) {
      gildash = undefined;
    } else {
      gildash = result;
    }
  }

  return {
    cardsDir: options.cardsDir,
    db,
    cardRepo: new DrizzleCardRepository(db),
    relationRepo: new DrizzleRelationRepository(db),
    classificationRepo: new DrizzleClassificationRepository(db),
    codeLinkRepo: new DrizzleCodeLinkRepository(db),
    allowedRelationTypes: options.allowedRelationTypes ?? [...DEFAULT_RELATION_TYPES],
    gildash,
  };
}

export async function teardownEmberdeck(ctx: EmberdeckContext): Promise<void> {
  await ctx.gildash?.close();
  closeDb(ctx.db);
}
