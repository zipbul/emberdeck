import { describe, expect, test } from 'bun:test';
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
    expect(() => parse('abc')).toThrow(/--n must be a non-negative integer/);
    expect(() => parse('1abc')).toThrow();
    expect(() => parse('')).toThrow();
    expect(() => parse(' 5')).toThrow();
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
});
