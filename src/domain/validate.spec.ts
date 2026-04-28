import { describe, it, expect } from 'bun:test';
import { validateDomainCard } from './validate';
import { CardValidationError } from '../card/errors';
import type { CardFrontmatter } from '../card/types';

function fm(overrides: Partial<CardFrontmatter> = {}): CardFrontmatter {
  return {
    key: 'd',
    summary: 's',
    status: 'draft',
    type: 'domain',
    domain: { overview: 'over', scope: 'sc' },
    ...overrides,
  };
}

describe('validateDomainCard', () => {
  it('passes for a fully-formed domain card', () => {
    expect(() => validateDomainCard(fm())).not.toThrow();
  });

  it('rejects non-domain type', () => {
    expect(() => validateDomainCard(fm({ type: 'brief' }))).toThrow(CardValidationError);
  });

  it('rejects missing domain namespace', () => {
    expect(() => validateDomainCard(fm({ domain: undefined }))).toThrow(/missing required/);
  });

  it('rejects empty overview', () => {
    expect(() => validateDomainCard(fm({ domain: { overview: '   ', scope: 'sc' } }))).toThrow(/overview/);
  });

  it('rejects empty scope', () => {
    expect(() => validateDomainCard(fm({ domain: { overview: 'o', scope: '' } }))).toThrow(/scope/);
  });

  it('rejects empty cross_domain_dependencies entry', () => {
    expect(() =>
      validateDomainCard(fm({
        domain: {
          overview: 'o',
          scope: 's',
          cross_domain_dependencies: [{ domain: '', relationship: 'r' }],
        },
      })),
    ).toThrow(/non-empty card key/);
  });

  it('rejects empty relationship', () => {
    expect(() =>
      validateDomainCard(fm({
        domain: {
          overview: 'o',
          scope: 's',
          cross_domain_dependencies: [{ domain: 'other', relationship: '' }],
        },
      })),
    ).toThrow(/relationship/);
  });

  it('rejects self-reference', () => {
    expect(() =>
      validateDomainCard(fm({
        key: 'self-d',
        domain: {
          overview: 'o',
          scope: 's',
          cross_domain_dependencies: [{ domain: 'self-d', relationship: 'r' }],
        },
      })),
    ).toThrow(/self-reference/);
  });
});
