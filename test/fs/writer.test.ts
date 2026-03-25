import { describe, it, expect, mock, spyOn } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CardFile } from '../../src/card/types';
import { writeCardFile, deleteCardFile } from '../../src/fs/writer';
import { serializeCardMarkdown } from '../../src/card/markdown';

// ---- Fixtures ----

const CARD_FIXTURE: CardFile = {
  frontmatter: { key: 'k', summary: 's', status: 'draft', type: 'spec' },
  body: 'body',
  filePath: '/cards/k.card.md',
};

const EXPECTED_SERIALIZED = serializeCardMarkdown(CARD_FIXTURE.frontmatter, CARD_FIXTURE.body);

// ---- writeCardFile ----

describe('writeCardFile', () => {
  // HP: atomic write produces correct file content
  it('should write correct serialized content to file via atomic rename', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'emberdeck-writer-'));
    const filePath = join(dir, 'k.card.md');
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
    const filePath = join(dir, 'k.card.md');
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
    const filePath = join(dir, 'k.card.md');
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
    const filePath = join(dir, 'k.card.md');
    try {
      const result = await writeCardFile(filePath, CARD_FIXTURE);
      expect(result).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // NE: reject when directory does not exist
  it('should reject when target directory does not exist', async () => {
    await expect(writeCardFile('/nonexistent/dir/k.card.md', CARD_FIXTURE)).rejects.toThrow();
  });
});

// ---- deleteCardFile ----

describe('deleteCardFile', () => {
  // HP
  it('should call file.delete() once when file.exists() returns true', async () => {
    const mockDelete = mock(async () => {});
    const mockExists = mock(async () => true);
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mockExists,
      delete: mockDelete,
    } as unknown as ReturnType<typeof Bun.file>);
    await deleteCardFile('/cards/k.card.md');
    expect(mockDelete).toHaveBeenCalledTimes(1);
    fileSpy.mockRestore();
  });

  it('should not call file.delete() when file.exists() returns false', async () => {
    const mockDelete = mock(async () => {});
    const mockExists = mock(async () => false);
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mockExists,
      delete: mockDelete,
    } as unknown as ReturnType<typeof Bun.file>);
    await deleteCardFile('/cards/k.card.md');
    expect(mockDelete).toHaveBeenCalledTimes(0);
    fileSpy.mockRestore();
  });

  it('should call Bun.file with given filePath once when invoked', async () => {
    const filePath = '/cards/k.card.md';
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mock(async () => false),
      delete: mock(async () => {}),
    } as unknown as ReturnType<typeof Bun.file>);
    await deleteCardFile(filePath);
    expect(fileSpy).toHaveBeenCalledTimes(1);
    expect(fileSpy).toHaveBeenCalledWith(filePath);
    fileSpy.mockRestore();
  });

  it('should call file.exists() once when invoked', async () => {
    const mockExists = mock(async () => false);
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mockExists,
      delete: mock(async () => {}),
    } as unknown as ReturnType<typeof Bun.file>);
    await deleteCardFile('/cards/k.card.md');
    expect(mockExists).toHaveBeenCalledTimes(1);
    fileSpy.mockRestore();
  });

  it('should resolve void without calling delete when file does not exist', async () => {
    const mockDelete = mock(async () => {});
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mock(async () => false),
      delete: mockDelete,
    } as unknown as ReturnType<typeof Bun.file>);
    const result = await deleteCardFile('/cards/k.card.md');
    expect(result).toBeUndefined();
    expect(mockDelete).toHaveBeenCalledTimes(0);
    fileSpy.mockRestore();
  });

  // NE
  it('should reject when file.exists() rejects', async () => {
    const existsError = new Error('exists error');
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mock(async () => { throw existsError; }),
      delete: mock(async () => {}),
    } as unknown as ReturnType<typeof Bun.file>);
    await expect(deleteCardFile('/cards/k.card.md')).rejects.toThrow('exists error');
    fileSpy.mockRestore();
  });

  it('should reject when file.delete() rejects and file exists', async () => {
    const deleteError = new Error('delete error');
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mock(async () => true),
      delete: mock(async () => { throw deleteError; }),
    } as unknown as ReturnType<typeof Bun.file>);
    await expect(deleteCardFile('/cards/k.card.md')).rejects.toThrow('delete error');
    fileSpy.mockRestore();
  });

  // ED
  it('should call Bun.file with empty string when filePath is empty', async () => {
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mock(async () => false),
      delete: mock(async () => {}),
    } as unknown as ReturnType<typeof Bun.file>);
    await deleteCardFile('');
    expect(fileSpy).toHaveBeenCalledWith('');
    fileSpy.mockRestore();
  });

  // ID
  it('should not call delete when called twice and file does not exist', async () => {
    const mockDelete = mock(async () => {});
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mock(async () => false),
      delete: mockDelete,
    } as unknown as ReturnType<typeof Bun.file>);
    await deleteCardFile('/cards/k.card.md');
    await deleteCardFile('/cards/k.card.md');
    expect(mockDelete).toHaveBeenCalledTimes(0);
    fileSpy.mockRestore();
  });
});
