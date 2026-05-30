import { describe, it, expect } from 'bun:test';
import { cardsExitCode } from './validate';

// §10 Phase 1.2 — glossary-unused is warning-level: reported in byCode/output
// but excluded from the exit gate. glossary-broken stays an error (gates exit 2).
describe('cardsExitCode — glossary-unused warning split (§10 P1.2)', () => {
  it('returns 0 when only glossary-unused issues exist (warning, non-gating)', () => {
    expect(cardsExitCode({ 'glossary-unused': 3 })).toBe(0);
  });

  it('returns 2 for glossary-broken (error, gating)', () => {
    expect(cardsExitCode({ 'glossary-broken': 1 })).toBe(2);
  });

  it('returns 2 when a gating issue coexists with glossary-unused', () => {
    expect(cardsExitCode({ 'glossary-unused': 2, 'orphan-card': 1 })).toBe(2);
  });

  it('returns 0 for no issues', () => {
    expect(cardsExitCode({})).toBe(0);
  });
});
