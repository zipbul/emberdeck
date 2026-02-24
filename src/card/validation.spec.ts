import { describe, it, expect } from 'bun:test';
import { validateCardInput, LIMITS } from './validation';
import { CardValidationError } from './errors';

describe('validateCardInput', () => {
  // ── HP-1: all valid fields ──

  it('should not throw when all valid fields are given with normal values', () => {
    // Arrange / Act / Assert
    expect(() =>
      validateCardInput({
        summary: 'Normal summary',
        body: 'Normal body',
        keywords: ['kw1', 'kw2'],
        tags: ['tag1', 'tag2'],
        relations: [{ type: 'depends-on', target: 'other-card' }],
        codeLinks: [{ kind: 'function', file: 'src/auth.ts', symbol: 'getToken' }],
      }),
    ).not.toThrow();
  });

  // ── HP-2: all undefined ──

  it('should not throw when all fields are undefined', () => {
    // Arrange / Act / Assert
    expect(() => validateCardInput({})).not.toThrow();
  });

  // ── HP-3: all empty arrays ──

  it('should not throw when all array fields are empty arrays', () => {
    // Arrange / Act / Assert
    expect(() =>
      validateCardInput({
        summary: 'Valid summary',
        body: '',
        keywords: [],
        tags: [],
        relations: [],
        codeLinks: [],
      }),
    ).not.toThrow();
  });

  // ── NE-1: summary empty ──

  it('should throw CardValidationError when summary is empty string', () => {
    // Arrange / Act / Assert
    expect(() => validateCardInput({ summary: '' })).toThrow(CardValidationError);
  });

  // ── NE-2: summary over 500 ──

  it('should throw CardValidationError when summary exceeds 500 characters', () => {
    // Arrange
    const longSummary = 'a'.repeat(LIMITS.SUMMARY_MAX + 1);
    // Act / Assert
    expect(() => validateCardInput({ summary: longSummary })).toThrow(CardValidationError);
  });

  // ── NE-3: body over 100000 ──

  it('should throw CardValidationError when body exceeds 100000 characters', () => {
    // Arrange
    const bigBody = 'x'.repeat(LIMITS.BODY_MAX + 1);
    // Act / Assert
    expect(() =>
      validateCardInput({ summary: 'ok', body: bigBody }),
    ).toThrow(CardValidationError);
  });

  // ── NE-4: keywords count over 100 ──

  it('should throw CardValidationError when keywords array exceeds 100 items', () => {
    // Arrange
    const tooMany = Array(LIMITS.ARRAY_MAX + 1).fill('kw');
    // Act / Assert
    expect(() =>
      validateCardInput({ summary: 'ok', keywords: tooMany }),
    ).toThrow(CardValidationError);
  });

  // ── NE-5: keyword item over 100 ──

  it('should throw CardValidationError when a keyword item exceeds 100 characters', () => {
    // Arrange
    const longKw = 'k'.repeat(LIMITS.ITEM_MAX + 1);
    // Act / Assert
    expect(() =>
      validateCardInput({ summary: 'ok', keywords: ['valid', longKw] }),
    ).toThrow(CardValidationError);
  });

  // ── NE-6: tags count over 100 ──

  it('should throw CardValidationError when tags array exceeds 100 items', () => {
    // Arrange
    const tooMany = Array(LIMITS.ARRAY_MAX + 1).fill('t');
    // Act / Assert
    expect(() =>
      validateCardInput({ summary: 'ok', tags: tooMany }),
    ).toThrow(CardValidationError);
  });

  // ── NE-7: tag item over 100 ──

  it('should throw CardValidationError when a tag item exceeds 100 characters', () => {
    // Arrange
    const longTag = 't'.repeat(LIMITS.ITEM_MAX + 1);
    // Act / Assert
    expect(() =>
      validateCardInput({ summary: 'ok', tags: ['valid', longTag] }),
    ).toThrow(CardValidationError);
  });

  // ── NE-8: relations count over 100 ──

  it('should throw CardValidationError when relations array exceeds 100 items', () => {
    // Arrange
    const tooMany = Array(LIMITS.ARRAY_MAX + 1).fill({ type: 'related', target: 'x' });
    // Act / Assert
    expect(() =>
      validateCardInput({ summary: 'ok', relations: tooMany }),
    ).toThrow(CardValidationError);
  });

  // ── NE-9: relation target over 200 ──

  it('should throw CardValidationError when a relation target exceeds 200 characters', () => {
    // Arrange
    const longTarget = 'r'.repeat(LIMITS.RELATION_TARGET_MAX + 1);
    // Act / Assert
    expect(() =>
      validateCardInput({ summary: 'ok', relations: [{ type: 'depends-on', target: longTarget }] }),
    ).toThrow(CardValidationError);
  });

  // ── NE-10: codeLinks count over 100 ──

  it('should throw CardValidationError when codeLinks array exceeds 100 items', () => {
    // Arrange
    const tooMany = Array(LIMITS.ARRAY_MAX + 1).fill({ kind: 'fn', file: 'a.ts', symbol: 'x' });
    // Act / Assert
    expect(() =>
      validateCardInput({ summary: 'ok', codeLinks: tooMany }),
    ).toThrow(CardValidationError);
  });

  // ── NE-11: codeLink symbol over 200 ──

  it('should throw CardValidationError when a codeLink symbol exceeds 200 characters', () => {
    // Arrange
    const longSymbol = 's'.repeat(LIMITS.CODE_LINK_SYMBOL_MAX + 1);
    // Act / Assert
    expect(() =>
      validateCardInput({
        summary: 'ok',
        codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: longSymbol }],
      }),
    ).toThrow(CardValidationError);
  });

  // ── NE-12: codeLink file over 500 ──

  it('should throw CardValidationError when a codeLink file path exceeds 500 characters', () => {
    // Arrange
    const longFile = 'f'.repeat(LIMITS.CODE_LINK_FILE_MAX + 1);
    // Act / Assert
    expect(() =>
      validateCardInput({
        summary: 'ok',
        codeLinks: [{ kind: 'function', file: longFile, symbol: 'foo' }],
      }),
    ).toThrow(CardValidationError);
  });

  // ── ED-1: all fields exactly at max limits ──

  it('should not throw when all fields are exactly at their maximum limits', () => {
    // Arrange
    const summary = 'a'.repeat(LIMITS.SUMMARY_MAX);           // 500
    const body = 'b'.repeat(LIMITS.BODY_MAX);                 // 100000
    const keywords = Array(LIMITS.ARRAY_MAX).fill('k'.repeat(LIMITS.ITEM_MAX));   // 100×100
    const tags = Array(LIMITS.ARRAY_MAX).fill('t'.repeat(LIMITS.ITEM_MAX));       // 100×100
    const relations = Array(LIMITS.ARRAY_MAX).fill({
      type: 'related',
      target: 'r'.repeat(LIMITS.RELATION_TARGET_MAX),         // 200
    });
    const codeLinks = Array(LIMITS.ARRAY_MAX).fill({
      kind: 'function',
      file: 'f'.repeat(LIMITS.CODE_LINK_FILE_MAX),            // 500
      symbol: 's'.repeat(LIMITS.CODE_LINK_SYMBOL_MAX),        // 200
    });
    // Act / Assert
    expect(() =>
      validateCardInput({ summary, body, keywords, tags, relations, codeLinks }),
    ).not.toThrow();
  });

  // ── CO-1: validation order — summary checked before other fields ──

  it('should throw on summary validation before checking other fields when multiple fields invalid', () => {
    // Arrange
    const tooManyKeywords = Array(LIMITS.ARRAY_MAX + 1).fill('kw');
    // Act
    let thrownError: unknown;
    try {
      validateCardInput({ summary: '', keywords: tooManyKeywords });
    } catch (e) {
      thrownError = e;
    }
    // Assert: CardValidationError with summary message (not keywords message)
    expect(thrownError).toBeInstanceOf(CardValidationError);
    expect((thrownError as CardValidationError).message).toContain('summary');
  });
});
