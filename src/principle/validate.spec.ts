import { describe, expect, it } from 'bun:test';
import { validatePrincipleCard } from './validate';
import { CardValidationError } from '../card/errors';
import type { PrincipleBody } from '../card/types';

function body(overrides: Partial<PrincipleBody> = {}): PrincipleBody {
  return {
    statement: 'X MUST Y',
    rationale: 'because Z',
    applies_to: '*',
    enforcement: 'blocking',
    verify: { class: 'binding' },
    ...overrides,
  };
}

describe('validatePrincipleCard', () => {
  it('accepts a valid principle body', () => {
    expect(() => validatePrincipleCard(body())).not.toThrow();
  });

  it('rejects missing principle namespace', () => {
    expect(() => validatePrincipleCard(undefined)).toThrow(/missing required `principle` namespace/);
  });

  it('rejects empty applies_to array', () => {
    expect(() => validatePrincipleCard(body({ applies_to: [] }))).toThrow(/applies_to must be "\*" or non-empty/);
  });

  it('accepts applies_to as glob array', () => {
    expect(() =>
      validatePrincipleCard(body({ applies_to: ['src/auth/**', 'src/billing/**'], enforcement: 'warning' })),
    ).not.toThrow();
  });

  it('throws CardValidationError type on failure', () => {
    expect(() => validatePrincipleCard(undefined)).toThrow(CardValidationError);
  });
});
