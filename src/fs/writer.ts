import { rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { CardFile } from '../card/types';
import { serializeCard } from '../card/serialize';

export async function writeCardFile(filePath: string, card: CardFile): Promise<void> {
  const text = serializeCard(card.frontmatter);
  await atomicWrite(filePath, text);
}

/**
 * Atomic write: write to a sibling tmp file, then rename over the target.
 * On the same filesystem rename is atomic; on partial Bun.write we leave the
 * tmp behind for forensic recovery, then re-throw.
 *
 * Use for any user file where a half-written truncation would be worse than
 * the whole write failing.
 */
export async function atomicWrite(filePath: string, text: string): Promise<void> {
  const tmpPath = filePath + '.tmp.' + randomBytes(4).toString('hex');
  await Bun.write(tmpPath, text);
  try {
    await rename(tmpPath, filePath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

export async function deleteCardFile(filePath: string): Promise<void> {
  // unlink + swallow ENOENT defeats the exists()/delete() TOCTOU race
  // (another process may delete the file between the two calls).
  try {
    await unlink(filePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}
