import { describe, expect, test } from 'bun:test';
import { classifyErrorStatus } from './runner';

describe('runner: classifyErrorStatus', () => {
  test('GILDASH_TRANSIENT → unknown (exit 7)', () => {
    expect(classifyErrorStatus('GILDASH_TRANSIENT')).toBe('unknown');
  });

  test('NETWORK_TRANSIENT → unknown', () => {
    expect(classifyErrorStatus('NETWORK_TRANSIENT')).toBe('unknown');
  });

  test('CARD_NOT_FOUND → error (exit 3 mapped elsewhere)', () => {
    expect(classifyErrorStatus('CARD_NOT_FOUND')).toBe('error');
  });

  test('VALIDATION_ERROR → error', () => {
    expect(classifyErrorStatus('VALIDATION_ERROR')).toBe('error');
  });

  test('GILDASH_NOT_CONFIGURED → error (NOT transient — config issue)', () => {
    expect(classifyErrorStatus('GILDASH_NOT_CONFIGURED')).toBe('error');
  });

  test('unknown code → error (default)', () => {
    expect(classifyErrorStatus('SOMETHING_NEW')).toBe('error');
  });
});
