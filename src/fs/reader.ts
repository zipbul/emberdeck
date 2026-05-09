import type { CardFile } from '../card/types';
import { parseCard } from '../card/serialize';
import { CardNotFoundError } from '../card/errors';

export async function readCardFile(filePath: string): Promise<CardFile> {
  const text = await Bun.file(filePath).text();
  const parsed = parseCard(text);
  return { ...parsed, filePath };
}

/**
 * Read a card file, throwing CardNotFoundError(key) if the file is missing.
 * If `expectedKey` is provided, also verify the parsed frontmatter.key matches.
 */
export async function readCardFileOrThrow(
  filePath: string,
  expectedKey: string,
  options?: { checkKey?: boolean },
): Promise<CardFile> {
  if (!(await Bun.file(filePath).exists())) throw new CardNotFoundError(expectedKey);
  const card = await readCardFile(filePath);
  if (options?.checkKey && card.frontmatter.key !== expectedKey) {
    throw new CardNotFoundError(expectedKey);
  }
  return card;
}
