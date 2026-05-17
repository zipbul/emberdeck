import { describe, it, expect, mock, spyOn } from 'bun:test';
import jsyaml from 'js-yaml';
import { readCardFile } from '../../src/fs/reader';

// ---- Fixtures ----
// parseCard/serializeCard are pure functions (no I/O) — real impl used.
// Only Bun.file (I/O) is spied on.

const VALID_CARD_YAML = `---\n${jsyaml.dump({
  key: 'test/card',
  summary: 'A test card',
  status: 'draft',
  type: 'spec',
})}---\n`;

// ---- Tests ----

describe('readCardFile', () => {
  // HP
  it('should return CardFile when Bun.file().text() and parseCard succeed', async () => {
    // Arrange
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => VALID_CARD_YAML),
    } as unknown as ReturnType<typeof Bun.file>);
    // Act
    const result = await readCardFile('/cards/test/card.md');
    // Assert
    expect(result.frontmatter.key).toBe('test/card');
    expect(result.frontmatter.summary).toBe('A test card');
    fileSpy.mockRestore();
  });

  it('should set filePath field to given argument when parsing succeeds', async () => {
    // Arrange
    const filePath = '/cards/test/card.md';
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => VALID_CARD_YAML),
    } as unknown as ReturnType<typeof Bun.file>);
    // Act
    const result = await readCardFile(filePath);
    // Assert
    expect(result.filePath).toBe(filePath);
    fileSpy.mockRestore();
  });

  // NE
  it('should reject when Bun.file().text() rejects', async () => {
    // Arrange
    const error = new Error('read error');
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => { throw error; }),
    } as unknown as ReturnType<typeof Bun.file>);
    // Act / Assert
    await expect(readCardFile('/cards/missing.md')).rejects.toThrow('read error');
    fileSpy.mockRestore();
  });

  it('should throw when parseCard throws due to invalid markdown', async () => {
    // Arrange: text without --- frontmatter triggers CardValidationError
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => 'no frontmatter at all'),
    } as unknown as ReturnType<typeof Bun.file>);
    // Act / Assert
    await expect(readCardFile('/cards/bad.md')).rejects.toThrow();
    fileSpy.mockRestore();
  });

  // ── Boundary inputs (no mock — real Bun.file) ─────────────────────────
  // Previously these were asserted via toHaveBeenCalledWith on a mocked
  // Bun.file (call-pattern assertions). Restored here as outcome assertions
  // against real Bun.file behavior, which is what production code sees.

  it('should reject with ENOENT when filePath is the empty string', async () => {
    await expect(readCardFile('')).rejects.toThrow(/ENOENT/);
  });

  it('should reject with ENOENT when filePath is a single character that does not exist', async () => {
    await expect(readCardFile('a')).rejects.toThrow(/ENOENT/);
  });
});
