/**
 * Regression tests for src/cli/parsers.ts.
 *
 * parsePositiveInt used to call Number.isFinite as its only post-parse guard.
 * That accepts values above Number.MAX_SAFE_INTEGER, which then truncate
 * silently when passed into the ops layer. The parser now explicitly rejects
 * MAX_SAFE_INTEGER + 1 and above (L8 finding).
 */

import { describe, expect, test } from 'bun:test';
import { InvalidArgumentError } from 'commander';

import { parsePositiveInt } from '../../src/cli/parsers';

describe('parsePositiveInt', () => {
  const parse = parsePositiveInt('--limit');

  test('accepts non-negative integers', () => {
    expect(parse('0')).toBe(0);
    expect(parse('42')).toBe(42);
    expect(parse(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  test('rejects non-digit input with InvalidArgumentError', () => {
    expect(() => parse('abc')).toThrow(InvalidArgumentError);
    expect(() => parse('1.5')).toThrow(InvalidArgumentError);
    expect(() => parse('-1')).toThrow(InvalidArgumentError);
    expect(() => parse('')).toThrow(InvalidArgumentError);
  });

  test('rejects values above MAX_SAFE_INTEGER (L8 regression)', () => {
    const overflow = String(Number.MAX_SAFE_INTEGER) + '0'; // adds a digit
    expect(() => parse(overflow)).toThrow(/exceeds Number\.MAX_SAFE_INTEGER/);
  });
});
