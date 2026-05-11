import { describe, it, expect } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CardFile } from '../../src/card/types';
import { writeCardFile, deleteCardFile } from '../../src/fs/writer';
import { serializeCard } from '../../src/card/serialize';

// ---- Fixtures ----

const CARD_FIXTURE: CardFile = {
  frontmatter: { key: 'k', summary: 's', status: 'draft', type: 'spec' },
  filePath: '/cards/k.md',
};

const EXPECTED_SERIALIZED = serializeCard(CARD_FIXTURE.frontmatter);

// ---- writeCardFile ----

describe('writeCardFile', () => {
  // HP: atomic write produces correct file content
  it('should write correct serialized content to file via atomic rename', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'emberdeck-writer-'));
    const filePath = join(dir, 'k.json');
    try {
      await writeCardFile(filePath, CARD_FIXTURE);
      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe(EXPECTED_SERIALIZED);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // HP: overwrite existing file atomically
  it('should overwrite existing file with new content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'emberdeck-writer-'));
    const filePath = join(dir, 'k.json');
    try {
      await Bun.write(filePath, 'old content');
      await writeCardFile(filePath, CARD_FIXTURE);
      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe(EXPECTED_SERIALIZED);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // HP: no tmp file left after successful write
  it('should not leave tmp files after successful write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'emberdeck-writer-'));
    const filePath = join(dir, 'k.json');
    try {
      await writeCardFile(filePath, CARD_FIXTURE);
      const glob = new Bun.Glob('*.tmp.*');
      const tmpFiles: string[] = [];
      for (const f of glob.scanSync({ cwd: dir })) tmpFiles.push(f);
      expect(tmpFiles).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // HP: resolve void
  it('should resolve void when write succeeds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'emberdeck-writer-'));
    const filePath = join(dir, 'k.json');
    try {
      const result = await writeCardFile(filePath, CARD_FIXTURE);
      expect(result).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // NE: reject when directory does not exist
  it('should reject when target directory does not exist', async () => {
    await expect(writeCardFile('/nonexistent/dir/k.json', CARD_FIXTURE)).rejects.toThrow();
  });
});

// ---- deleteCardFile ----
//
// Behavioral tests against a real tmp filesystem. The previous implementation
// used Bun.file().exists() then .delete() — vulnerable to TOCTOU. The current
// implementation calls unlink directly and swallows ENOENT, so the contract is:
//   - existing file → removed
//   - missing file  → no-op (idempotent, no throw)
//   - permission/IO error → re-throw

describe('deleteCardFile', () => {
  it('removes an existing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ed-del-'));
    const path = join(dir, 'k.json');
    await Bun.write(path, 'x');
    expect(await Bun.file(path).exists()).toBe(true);
    await deleteCardFile(path);
    expect(await Bun.file(path).exists()).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it('is a no-op when file does not exist (idempotent, no throw)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ed-del-'));
    const path = join(dir, 'missing.json');
    await deleteCardFile(path); // first call — file never existed
    await deleteCardFile(path); // second call — still missing
    expect(await Bun.file(path).exists()).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it('re-throws non-ENOENT errors (e.g. permission)', async () => {
    // Simulate non-ENOENT by passing a directory path — unlink on a dir
    // returns EISDIR or EPERM (depending on platform); both must propagate.
    const dir = await mkdtemp(join(tmpdir(), 'ed-del-'));
    await expect(deleteCardFile(dir)).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
});
