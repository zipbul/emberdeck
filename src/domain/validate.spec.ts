import { describe, it, expect } from 'bun:test';
import { validateDomainCard } from './validate';
import type { DomainBody } from '../card/types';

function body(overrides: Partial<DomainBody> = {}): DomainBody {
  return { overview: 'over', scope: 'sc', ...overrides };
}

describe('validateDomainCard', () => {
  it('passes for a fully-formed domain card', () => {
    expect(() => validateDomainCard(body())).not.toThrow();
  });

  it('rejects missing domain namespace', () => {
    expect(() => validateDomainCard(undefined)).toThrow(/missing required/);
  });

  it('rejects empty overview', () => {
    expect(() => validateDomainCard(body({ overview: '   ' }))).toThrow(/overview/);
  });

  it('rejects empty scope', () => {
    expect(() => validateDomainCard(body({ overview: 'o', scope: '' }))).toThrow(/scope/);
  });

  it('rejects empty cross_domain_dependencies entry', () => {
    expect(() =>
      validateDomainCard(body({
        cross_domain_dependencies: [{ domain: '', relationship: 'r' }],
      })),
    ).toThrow(/non-empty card key/);
  });

  it('rejects empty relationship', () => {
    expect(() =>
      validateDomainCard(body({
        cross_domain_dependencies: [{ domain: 'other', relationship: '' }],
      })),
    ).toThrow(/relationship/);
  });

  it('rejects self-reference when selfKey is supplied', () => {
    expect(() =>
      validateDomainCard(
        body({
          cross_domain_dependencies: [{ domain: 'self-d', relationship: 'r' }],
        }),
        { selfKey: 'self-d' },
      ),
    ).toThrow(/self-reference/);
  });

  it('allows the same domain key when selfKey is omitted', () => {
    expect(() =>
      validateDomainCard(body({
        cross_domain_dependencies: [{ domain: 'self-d', relationship: 'r' }],
      })),
    ).not.toThrow();
  });
});
