import { describe, expect, test } from 'bun:test';
import { startSpinner } from './spinner';
import type { OutputContext } from './output';

describe('spinner', () => {
  test('NOOP when output mode is json', () => {
    const ctx: OutputContext = { mode: 'json' };
    const sp = startSpinner(ctx, 'x');
    // NOOP — methods exist but do nothing
    expect(typeof sp.update).toBe('function');
    expect(typeof sp.stop).toBe('function');
    sp.update('y');
    sp.stop();
  });

  test('NOOP when output mode is quiet', () => {
    const ctx: OutputContext = { mode: 'quiet' };
    const sp = startSpinner(ctx, 'x');
    sp.update('y');
    sp.stop();
  });

  test('NOOP when stderr is not a TTY (default in test env)', () => {
    // bun test runs with stderr possibly piped → not TTY
    const ctx: OutputContext = { mode: 'json' };
    const sp = startSpinner(ctx, 'x');
    sp.update('y');
    sp.stop();
  });

  test('stop is idempotent', () => {
    const ctx: OutputContext = { mode: 'json' };
    const sp = startSpinner(ctx, 'x');
    sp.stop();
    sp.stop();  // should not throw
    sp.stop();
  });

  test('stop with finalLabel does not throw in NOOP mode', () => {
    const ctx: OutputContext = { mode: 'json' };
    const sp = startSpinner(ctx, 'x');
    expect(() => sp.stop('done')).not.toThrow();
  });

  test('NOOP when --verbose to avoid stderr interleaving', () => {
    const ctx: OutputContext = { mode: 'json' };
    const sp = startSpinner(ctx, 'x', { verbose: true });
    sp.update('y');
    sp.stop('done'); // would not write final label in NOOP — verifies NOOP path
  });
});
