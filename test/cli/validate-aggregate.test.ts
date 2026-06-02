/**
 * `ed validate` (aggregate) must agree with `ed validate cards` on the exit
 * gate: warning-level codes (glossary-unused etc.) are non-gating in BOTH.
 * Regression for the aggregate using `total > 0` (which gated on warnings).
 */
import { describe, expect, it } from 'bun:test';
import { runEd, setupTmpProject } from './helpers';

describe('validate aggregate gate consistency', () => {
  it('exits 0 when only a warning-level code (glossary-unused) is present', async () => {
    const { tmp, cleanup } = setupTmpProject();
    try {
      // Define a glossary word that no card references → glossary-unused (warning).
      const def = await runEd(['glossary', 'define', 'widget=a project widget concept'], tmp);
      expect(def.exitCode).toBe(0);

      const cards = await runEd(['validate', 'cards'], tmp);
      const cardsData = JSON.parse(cards.stdout);
      expect(cardsData.summary.byCode['glossary-unused']).toBeGreaterThanOrEqual(1);
      expect(cards.exitCode).toBe(0); // warning, non-gating

      const agg = await runEd(['validate'], tmp);
      expect(agg.exitCode).toBe(0); // aggregate must agree — not gate on the warning
    } finally {
      cleanup();
    }
  });
});
