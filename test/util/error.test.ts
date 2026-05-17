import { describe, it, expect } from 'bun:test';

import { errorMessage } from '../../src/util/error';

describe('errorMessage', () => {
  it('returns Error.message for Error instances', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns the string unchanged for string input', () => {
    expect(errorMessage('plain')).toBe('plain');
  });

  it('serializes plain objects via JSON.stringify', () => {
    expect(errorMessage({ code: 42 })).toBe('{"code":42}');
  });

  it('falls back to String() when JSON.stringify throws (e.g. circular)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(errorMessage(circular)).toBe('[object Object]');
  });

  // Regression: a prior refactor (5c0f0b7) accidentally replaced the body
  // with `return errorMessage(e)`, an infinite self-call that hung every
  // caller in the YAML-parse-error path. The function must terminate.
  it('terminates on every input shape (no self-recursion)', () => {
    expect(errorMessage(undefined)).toBeDefined();
    expect(errorMessage(null)).toBeDefined();
    expect(errorMessage(123)).toBeDefined();
  });
});
