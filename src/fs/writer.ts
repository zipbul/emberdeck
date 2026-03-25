import { rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { CardFile } from '../card/types';
import { serializeCardMarkdown } from '../card/markdown';

export async function writeCardFile(filePath: string, card: CardFile): Promise<void> {
  const text = serializeCardMarkdown(card.frontmatter, card.body);
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
  const file = Bun.file(filePath);
  if (await file.exists()) {
    await file.delete();
  }
}
