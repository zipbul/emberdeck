/**
 * §10 Phase 1.1b — write-free validate via the global --read-only flag.
 * Opens the card index read-only and skips the entry disk→DB sync, so `ed
 * validate` runs without writing the DB (migration dry-run / CI / RO fs).
 */
import { describe, expect, it } from 'bun:test';
import { runEd, setupTmpProject } from './helpers';

describe('--read-only write-free validate', () => {
  it('accepts --read-only and validates an existing DB write-free', async () => {
    const { tmp, cleanup } = setupTmpProject();
    try {
      // First a normal command creates + migrates + syncs the DB.
      await runEd(['validate', 'cards'], tmp);
      // Then validate read-only: option is accepted and the command succeeds
      // without attempting a DB write (entry sync skipped, DB opened read-only).
      const ro = await runEd(['validate', 'cards', '--read-only'], tmp);
      expect(ro.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });
});
