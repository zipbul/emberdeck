import { describe, expect, test } from 'bun:test';
import { confirmDestructive } from './confirm';

describe('confirm: confirmDestructive', () => {
  test('--yes is no-op', async () => {
    expect(
      await confirmDestructive({ yes: true, opName: 'op', prompt: 'do? ' }),
    ).toBeUndefined();
  });

  test('non-TTY without --yes throws', async () => {
    const wasTty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      await expect(
        confirmDestructive({ yes: false, opName: 'reset', prompt: 'do? ' }),
      ).rejects.toThrow(/reset requires --yes when not running in interactive TTY/);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: wasTty, configurable: true });
    }
  });
});
