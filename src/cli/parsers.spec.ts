import { describe, expect, test } from 'bun:test';
import { InvalidArgumentError } from 'commander';
import { parsePositiveInt } from './parsers';

describe('parsers: parsePositiveInt', () => {
  const parse = parsePositiveInt('--n');

  test('valid non-negative integers pass', () => {
    expect(parse('0')).toBe(0);
    expect(parse('1')).toBe(1);
    expect(parse('100')).toBe(100);
    expect(parse('999999')).toBe(999999);
  });

  test('non-numeric input throws InvalidArgumentError', () => {
    // Both the class identity AND the message format are part of commander's
    // contract: commander introspects InvalidArgumentError and routes to its
    // own usage-error formatter. A wrong class would silently fall through to
    // the generic error path.
    expect(() => parse('abc')).toThrow(InvalidArgumentError);
    expect(() => parse('abc')).toThrow(/--n must be a non-negative integer/);
    expect(() => parse('1abc')).toThrow(InvalidArgumentError);
    expect(() => parse('')).toThrow(InvalidArgumentError);
    expect(() => parse(' 5')).toThrow(InvalidArgumentError);
  });

  test('negative numbers rejected', () => {
    expect(() => parse('-1')).toThrow();
    expect(() => parse('-100')).toThrow();
  });

  test('decimals rejected', () => {
    expect(() => parse('1.5')).toThrow();
    expect(() => parse('0.1')).toThrow();
  });

  test('error message includes the option name and value', () => {
    expect(() => parse('xyz')).toThrow(/--n.*'xyz'/);
  });

  // Regression (codex L8): parsePositiveInt used Number.isFinite as its only
  // guard, which accepts values above Number.MAX_SAFE_INTEGER. Those silently
  // truncate downstream. The parser now rejects MAX_SAFE_INTEGER + 1 and above.
  test('accepts MAX_SAFE_INTEGER, rejects MAX_SAFE_INTEGER + 1', () => {
    expect(parse(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    const overflow = String(Number.MAX_SAFE_INTEGER) + '0';
    expect(() => parse(overflow)).toThrow(/exceeds Number\.MAX_SAFE_INTEGER/);
  });
});
