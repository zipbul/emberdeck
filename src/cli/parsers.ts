/**
 * Commander option-value parsers with strict validation.
 * parseInt('abc', 10) silently returns NaN, which then propagates into ops as a bogus
 * limit/offset/depth — surface invalid input as a clear CLI error instead.
 */

import { InvalidArgumentError } from 'commander';

export function parsePositiveInt(name: string): (value: string) => number {
  return (value: string) => {
    if (!/^\d+$/.test(value)) {
      throw new InvalidArgumentError(`${name} must be a non-negative integer (got '${value}')`);
    }
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) {
      throw new InvalidArgumentError(`${name} out of range (got '${value}')`);
    }
    return n;
  };
}
