import { describe, it, expect } from 'bun:test';
import { validateCardInput, LIMITS } from './validation';
import { CardValidationError } from './errors';

describe('validateCardInput', () => {
  // ── HP-1: all valid fields ──

  it('should not throw when all valid fields are given with normal values', () => {
    // Arrange / Act / Assert
    expect(() =>
      validateCardInput({
        key: 'my-card',
        summary: 'Normal summary',
                tags: ['tag1', 'tag2'],
        relations: ['other-card'],
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
                tags: [],
        relations: [],
        }),
    ).not.toThrow();
  });

  // ── key validation ──

  it('should not throw when key is exactly at KEY_MAX length', () => {
    // Arrange
    const key = 'k'.repeat(LIMITS.KEY_MAX);
    // Act / Assert
    expect(() => validateCardInput({ key })).not.toThrow();
  });

  it('should throw CardValidationError when key exceeds KEY_MAX characters', () => {
    // Arrange
    const key = 'k'.repeat(LIMITS.KEY_MAX + 1);
    // Act / Assert
    expect(() => validateCardInput({ key })).toThrow(CardValidationError);
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

  // ── NE-5b: tag item empty string ──

  it('should throw CardValidationError when a tag item is empty string', () => {
    // Arrange / Act / Assert
    expect(() =>
      validateCardInput({ summary: 'ok', tags: ['valid', ''] }),
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
    const tooMany = Array(LIMITS.ARRAY_MAX + 1).fill('some-card');
    // Act / Assert
    expect(() =>
      validateCardInput({ summary: 'ok', relations: tooMany }),
    ).toThrow(CardValidationError);
  });

  // ── NE-9: relation item over 200 ──

  it('should throw CardValidationError when a relation item exceeds 200 characters', () => {
    // Arrange
    const longRel = 'r'.repeat(LIMITS.RELATION_TARGET_MAX + 1);
    // Act / Assert
    expect(() =>
      validateCardInput({ summary: 'ok', relations: [longRel] }),
    ).toThrow(CardValidationError);
  });

  // ── NE-9b: relation item empty string ──

  it('should throw CardValidationError when a relation item is empty string', () => {
    // Arrange / Act / Assert
    expect(() =>
      validateCardInput({ summary: 'ok', relations: [''] }),
    ).toThrow(CardValidationError);
  });

  // ── ED-1: all fields exactly at max limits ──

  it('should not throw when all fields are exactly at their maximum limits', () => {
    // Arrange
    const key = 'k'.repeat(LIMITS.KEY_MAX);                       // 200
    const summary = 'a'.repeat(LIMITS.SUMMARY_MAX);               // 500
    const tags = Array(LIMITS.ARRAY_MAX).fill('t'.repeat(LIMITS.ITEM_MAX));       // 100x100
    const relations = Array(LIMITS.ARRAY_MAX).fill('r'.repeat(LIMITS.RELATION_TARGET_MAX)); // 100x200
    // Act / Assert
    expect(() =>
      validateCardInput({ key, summary, tags, relations }),
    ).not.toThrow();
  });

  // ── type / status enum (defense in depth — CLI also validates) ──

  it('should reject invalid card type', () => {
    expect(() => validateCardInput({ type: 'banana' })).toThrow(CardValidationError);
    expect(() => validateCardInput({ type: 'banana' })).toThrow(/Invalid card type/);
  });

  it('should accept valid card types', () => {
    expect(() => validateCardInput({ type: 'principle' })).not.toThrow();
    expect(() => validateCardInput({ type: 'brief' })).not.toThrow();
    expect(() => validateCardInput({ type: 'spec' })).not.toThrow();
  });

  it('should reject invalid card status', () => {
    expect(() => validateCardInput({ status: 'pending' })).toThrow(CardValidationError);
    expect(() => validateCardInput({ status: 'pending' })).toThrow(/Invalid card status/);
  });

  it('should accept valid card statuses', () => {
    for (const s of ['draft', 'active', 'drifted', 'retired'] as const) {
      expect(() => validateCardInput({ status: s })).not.toThrow();
    }
  });

  it('should skip type/status validation when undefined', () => {
    expect(() => validateCardInput({})).not.toThrow();
    expect(() => validateCardInput({ summary: 'x' })).not.toThrow();
  });

  // ── CO-1: validation order — summary checked before other fields ──

  it('should throw on summary validation before checking other fields when multiple fields invalid', () => {
    // Arrange
    const tooManyTags = Array(LIMITS.ARRAY_MAX + 1).fill('t');
    // Act
    let thrownError: unknown;
    try {
      validateCardInput({ summary: '', tags: tooManyTags });
    } catch (e) {
      thrownError = e;
    }
    // Assert: CardValidationError with summary message (not tags message)
    expect(thrownError).toBeInstanceOf(CardValidationError);
    expect((thrownError as CardValidationError).message).toContain('summary');
  });
});
