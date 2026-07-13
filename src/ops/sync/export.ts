import { Buffer } from 'node:buffer';

import type { EmberdeckContext } from '../../config';
import type { CardFile, CardFrontmatter, CardStatus, CardType } from '../../card/types';
import { parseFullKey } from '../../card/card-key';
import { CardNotFoundError } from '../../card/errors';
import { writeCardFile } from '../../fs/writer';
import { serializeCard } from '../../card/serialize';
import { parseStringArrayJson, parseNamespaces } from '../../card/json-fields';

/**
 * Build a CardFile from the indexed row plus auxiliary tables. Pure — does NOT
 * touch the filesystem. Used by both exportCardToFile (which writes to disk)
 * and CLI `card export` (which can render to STDOUT instead).
 */
export function buildCardFromDb(ctx: EmberdeckContext, fullKey: string): CardFile {
  const key = parseFullKey(fullKey);
  const row = ctx.cardRepo.findByKey(key);
  if (!row) throw new CardNotFoundError(key);

  const relations = ctx.relationRepo
    .findByCardKey(key)
    .filter((r) => !r.isReverse)
    .map((r) => r.dstCardKey);

  const tags = ctx.classificationRepo.findTagsByCard(key);

  const glossary = parseStringArrayJson(row.glossaryJson);

  const ns = parseNamespaces(row.namespacesJson);
  const fm: CardFrontmatter = {
    key: row.key,
    summary: row.summary,
    status: row.status as CardStatus,
    type: row.type as CardType,
    ...(row.parent ? { parent: row.parent } : {}),
    ...(relations.length ? { relations } : {}),
    ...(tags.length ? { tags } : {}),
    ...(glossary.length > 0 ? { glossary } : {}),
    ...(ns.vision ? { vision: ns.vision as CardFrontmatter['vision'] } : {}),
    ...(ns.principle ? { principle: ns.principle as CardFrontmatter['principle'] } : {}),
    ...(ns.domain ? { domain: ns.domain as CardFrontmatter['domain'] } : {}),
    ...(ns.brief ? { brief: ns.brief as CardFrontmatter['brief'] } : {}),
    ...(ns.spec ? { spec: ns.spec as CardFrontmatter['spec'] } : {}),
  };

  return { frontmatter: fm, filePath: row.filePath };
}

/**
 * Regenerate a card file from the indexed row (reverse sync). Throws when the
 * row was somehow persisted without a filePath (schema NOT NULL invariant).
 */
export async function exportCardToFile(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<{ filePath: string; bytes: number }> {
  const cardFile = buildCardFromDb(ctx, fullKey);
  if (!cardFile.filePath) {
    throw new Error(`exportCardToFile: card "${fullKey}" returned without a filePath`);
  }
  const filePath = cardFile.filePath;
  const content = serializeCard(cardFile.frontmatter);
  await writeCardFile(filePath, cardFile);
  return { filePath, bytes: Buffer.byteLength(content, 'utf-8') };
}

/**
 * Remove an indexed card row whose file has been externally deleted. Invoked
 * by CLI sync commands when a tracked card file is missing.
 */
export function removeCardByFile(ctx: EmberdeckContext, filePath: string): void {
  const existing = ctx.cardRepo.findByFilePath(filePath);
  if (existing) {
    ctx.cardRepo.deleteByKey(existing.key);
    ctx.classificationRepo.pruneOrphans();
  }
}
