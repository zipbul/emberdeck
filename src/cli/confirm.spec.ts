import { describe, expect, test } from 'bun:test';
import { confirmDestructive, type ConfirmEnv } from './confirm';
import { CliUsageError } from './usage-error';

// Each test builds its own env stub so we never mutate process.stdin globally
// (the prior implementation Object.defineProperty'd isTTY and relied on a
// try/finally restore — brittle across parallel tests).
function fakeEnv(overrides: Partial<ConfirmEnv> = {}): ConfirmEnv {
  return {
    stdinIsTTY: true,
    stderrIsTTY: true,
    readLine: async () => 'yes',
    write: () => {},
    ...overrides,
  };
}

describe('confirmDestructive', () => {
  test('--yes is a no-op (returns undefined, never reads stdin)', async () => {
    let readCalled = false;
    const result = await confirmDestructive(
      { yes: true, opName: 'op', prompt: 'do? ' },
      fakeEnv({ readLine: async () => { readCalled = true; return ''; } }),
    );
    expect(result).toBeUndefined();
    expect(readCalled).toBe(false);
  });

  test('non-TTY stdin + !yes → throws CliUsageError', async () => {
    await expect(
      confirmDestructive(
        { yes: false, opName: 'reset', prompt: 'do? ' },
        fakeEnv({ stdinIsTTY: false }),
      ),
    ).rejects.toBeInstanceOf(CliUsageError);
  });

  test('non-TTY stderr + !yes → throws CliUsageError', async () => {
    await expect(
      confirmDestructive(
        { yes: false, opName: 'reset', prompt: 'do? ' },
        fakeEnv({ stderrIsTTY: false }),
      ),
    ).rejects.toBeInstanceOf(CliUsageError);
  });

  test('TTY + answer matches default "yes" → resolves', async () => {
    await expect(
      confirmDestructive(
        { yes: false, opName: 'reset', prompt: '? ' },
        fakeEnv({ readLine: async () => 'yes\n' }),
      ),
    ).resolves.toBeUndefined();
  });

  test('TTY + answer is uppercase "YES" → resolves (case-insensitive)', async () => {
    await expect(
      confirmDestructive(
        { yes: false, opName: 'reset', prompt: '? ' },
        fakeEnv({ readLine: async () => 'YES' }),
      ),
    ).resolves.toBeUndefined();
  });

  test('TTY + answer mismatches expected → throws CliUsageError ("aborted")', async () => {
    await expect(
      confirmDestructive(
        { yes: false, opName: 'reset', prompt: '? ' },
        fakeEnv({ readLine: async () => 'no' }),
      ),
    ).rejects.toThrow(/reset aborted by user/);
  });

  test('custom expected token is honored', async () => {
    await expect(
      confirmDestructive(
        { yes: false, opName: 'wipe', prompt: '? ', expected: 'DELETE' },
        fakeEnv({ readLine: async () => 'delete' }), // case-insensitive
      ),
    ).resolves.toBeUndefined();
  });

  test('prompt text is written via env.write before reading the answer', async () => {
    const writes: string[] = [];
    let readCalled = false;
    await confirmDestructive(
      { yes: false, opName: 'reset', prompt: 'are you sure? ' },
      fakeEnv({
        write: (s) => { writes.push(s); if (!readCalled) expect(readCalled).toBe(false); },
        readLine: async () => { readCalled = true; return 'yes'; },
      }),
    );
    expect(writes).toEqual(['are you sure? ']);
    expect(readCalled).toBe(true);
  });
});
