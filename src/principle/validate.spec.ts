import { describe, expect, it } from 'bun:test';
import { validatePrincipleCard } from './validate';
import { CardValidationError } from '../card/errors';
import type { CardFrontmatter } from '../card/types';

function makeFm(overrides: Partial<CardFrontmatter> = {}): CardFrontmatter {
  return {
    key: 'test-principle',
    summary: 's',
    status: 'draft',
    type: 'principle',
    principle: {
      statement: 'X MUST Y',
      rationale: 'because Z',
      applies_to: '*',
      enforcement: 'blocking',
    },
    ...overrides,
  };
}

describe('validatePrincipleCard', () => {
  it('accepts a valid principle frontmatter', () => {
    expect(() => validatePrincipleCard(makeFm())).not.toThrow();
  });

  it('rejects non-principle card type', () => {
    const fm = makeFm({ type: 'brief' });
    expect(() => validatePrincipleCard(fm)).toThrow(/Expected principle card/);
  });

  it('rejects missing principle namespace', () => {
    const fm = makeFm({ principle: undefined });
    expect(() => validatePrincipleCard(fm)).toThrow(/missing required `principle` namespace/);
  });

  it('rejects empty applies_to array', () => {
    const fm = makeFm({
      principle: {
        statement: 'X',
        rationale: 'Y',
        applies_to: [],
        enforcement: 'blocking',
      },
    });
    expect(() => validatePrincipleCard(fm)).toThrow(/applies_to must be "\*" or non-empty/);
  });

  it('accepts applies_to as glob array', () => {
    const fm = makeFm({
      principle: {
        statement: 'X',
        rationale: 'Y',
        applies_to: ['src/auth/**', 'src/billing/**'],
        enforcement: 'warning',
      },
    });
    expect(() => validatePrincipleCard(fm)).not.toThrow();
  });

  it('throws CardValidationError type on failure', () => {
    const fm = makeFm({ principle: undefined });
    expect(() => validatePrincipleCard(fm)).toThrow(CardValidationError);
  });
});
