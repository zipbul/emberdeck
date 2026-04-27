import { describe, expect, test } from 'bun:test';
import {
  ok,
  partial,
  err,
  unknown,
  resolveOutputMode,
  statusToExitCode,
  SCHEMA_VERSION,
} from './output';
import { EXIT } from './exit-codes';

describe('output: resolveOutputMode', () => {
  test('explicit --output=json wins', () => {
    expect(resolveOutputMode({ output: 'json' })).toBe('json');
    expect(resolveOutputMode({ output: 'json', json: false })).toBe('json');
  });

  test('explicit --output=human wins over TTY default', () => {
    expect(resolveOutputMode({ output: 'human' })).toBe('human');
  });

  test('--quiet shortcut', () => {
    expect(resolveOutputMode({ quiet: true })).toBe('quiet');
    expect(resolveOutputMode({ output: 'quiet' })).toBe('quiet');
  });

  test('--json shortcut', () => {
    expect(resolveOutputMode({ json: true })).toBe('json');
  });
});

describe('output: result builders', () => {
  test('ok includes schemaVersion + status=ok + empty arrays', () => {
    const r = ok({ key: 'foo' });
    expect(r.schemaVersion).toEqual(SCHEMA_VERSION);
    expect(r.status).toBe('ok');
    expect(r.data).toEqual({ key: 'foo' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.error).toBeUndefined();
  });

  test('ok with warnings', () => {
    const r = ok({ count: 1 }, [{ code: 'X', message: 'minor issue' }]);
    expect(r.warnings).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });

  test('partial includes errors', () => {
    const r = partial({ succeeded: ['a'], total: 2 }, [
      { code: 'X', message: 'failed', key: 'b' },
    ]);
    expect(r.status).toBe('partial');
    expect(r.errors).toHaveLength(1);
    expect(r.error).toBeUndefined();
  });

  test('err is single error', () => {
    const r = err({ code: 'CARD_NOT_FOUND', message: 'gone' });
    expect(r.status).toBe('error');
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('CARD_NOT_FOUND');
    expect(r.errors).toEqual([]);
  });

  test('unknown is transient', () => {
    const r = unknown({ code: 'GILDASH_TRANSIENT', message: 'timeout' });
    expect(r.status).toBe('unknown');
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('GILDASH_TRANSIENT');
  });
});

describe('output: statusToExitCode', () => {
  test('ok → 0', () => {
    expect(statusToExitCode(ok({}))).toBe(EXIT.OK);
  });

  test('partial → 0 by default, 2 when partialIsFailure', () => {
    const r = partial({}, [{ code: 'X', message: 'x' }]);
    expect(statusToExitCode(r)).toBe(EXIT.OK);
    expect(statusToExitCode(r, { partialIsFailure: true })).toBe(EXIT.VALIDATION_FAILURE);
  });

  test('unknown → 7', () => {
    expect(statusToExitCode(unknown({ code: 'X', message: 'x' }))).toBe(EXIT.TRANSIENT);
  });

  test('error code → mapped exit code', () => {
    expect(statusToExitCode(err({ code: 'CARD_NOT_FOUND', message: 'x' }))).toBe(EXIT.NOT_FOUND);
    expect(statusToExitCode(err({ code: 'CARD_ALREADY_EXISTS', message: 'x' }))).toBe(EXIT.CONFLICT);
    expect(statusToExitCode(err({ code: 'GILDASH_NOT_CONFIGURED', message: 'x' }))).toBe(EXIT.CONFIG_MISSING);
    expect(statusToExitCode(err({ code: 'VALIDATION_ERROR', message: 'x' }))).toBe(EXIT.VALIDATION_FAILURE);
    expect(statusToExitCode(err({ code: 'INVALID_CARD_KEY', message: 'x' }))).toBe(EXIT.VALIDATION_FAILURE);
    expect(statusToExitCode(err({ code: 'BOUNDARY_VALIDATION_ERROR', message: 'x' }))).toBe(EXIT.VALIDATION_FAILURE);
    expect(statusToExitCode(err({ code: 'GLOSSARY_VALIDATION_ERROR', message: 'x' }))).toBe(EXIT.VALIDATION_FAILURE);
    expect(statusToExitCode(err({ code: 'ACTIVATION_GUARD_FAILED', message: 'x' }))).toBe(EXIT.VALIDATION_FAILURE);
    expect(statusToExitCode(err({ code: 'RENAME_SAME_PATH', message: 'x' }))).toBe(EXIT.CONFLICT);
    expect(statusToExitCode(err({ code: 'UNKNOWN_CODE', message: 'x' }))).toBe(EXIT.GENERIC_ERROR);
  });
});

describe('output: schemaVersion', () => {
  test('all builders use the same SCHEMA_VERSION constant', () => {
    expect(ok({}).schemaVersion).toBe(SCHEMA_VERSION);
    expect(partial({}, []).schemaVersion).toBe(SCHEMA_VERSION);
    expect(err({ code: 'X', message: 'x' }).schemaVersion).toBe(SCHEMA_VERSION);
    expect(unknown({ code: 'X', message: 'x' }).schemaVersion).toBe(SCHEMA_VERSION);
  });

  test('SCHEMA_VERSION is { major: 1, minor: 0 }', () => {
    expect(SCHEMA_VERSION).toEqual({ major: 1, minor: 0 });
  });
});
