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

});
// Notes on removed tests (refactor 2026-05): four tests were deleted as
// call-pattern assertions that lock implementation rather than behavior:
//   1. "Bun.file called once with filePath" — couples to call count; behavior
//      already covered by the filePath-field outcome test above.
//   2. "Bun.file called with empty string" — pure mock-invocation check, no
//      outcome assertion. Behavior is "function passes through filePath",
//      which the outcome test (filePath field) already proves.
//   3. "Bun.file called with single-char 'a'" — same as (2).
//   4. "twice with same mock returns same result" — tests the mock's
//      idempotency, not readCardFile. Real determinism is guaranteed by the
//      function being pure given its inputs.
