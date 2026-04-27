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
      let caught: Error | null = null;
      try {
        await confirmDestructive({ yes: false, opName: 'reset', prompt: 'do? ' });
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).not.toBeNull();
      expect(caught?.message).toMatch(/reset requires --yes when not running in interactive TTY/);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: wasTty, configurable: true });
    }
  });
});
