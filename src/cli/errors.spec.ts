import { describe, expect, test } from 'bun:test';
import { toCliError } from './errors';
import {
  CardNotFoundError,
  CardAlreadyExistsError,
  CardKeyError,
  CardValidationError,
  ParentValidationError,
  ActivationGuardError,
  CompensationError,
} from '../card/errors';
import { GildashInitError } from '../setup';
import { GlossaryValidationError } from '../glossary/io';
import { GlossaryNotFoundError } from '../glossary/errors';

describe('toCliError', () => {
  test('CardNotFoundError → card-not-found', () => {
    const m = toCliError(new CardNotFoundError('foo'));
    expect(m.code).toBe('card-not-found');
    expect(m.message).toContain('foo');
  });

  test('CardAlreadyExistsError → card-already-exists', () => {
    const m = toCliError(new CardAlreadyExistsError('foo'));
    expect(m.code).toBe('card-already-exists');
  });

  test('CardKeyError → invalid-card-key', () => {
    const m = toCliError(new CardKeyError('bad/key'));
    expect(m.code).toBe('invalid-card-key');
  });

  test('CardValidationError → validation-error', () => {
    const m = toCliError(new CardValidationError('bad input'));
    expect(m.code).toBe('validation-error');
  });

  test('ParentValidationError → parent-validation-error', () => {
    const m = toCliError(new ParentValidationError('parent missing'));
    expect(m.code).toBe('parent-validation-error');
  });

  test('ActivationGuardError preserves unmet conditions in details', () => {
    const m = toCliError(new ActivationGuardError('guard failed', ['needs body', 'needs codeLinks']));
    expect(m.code).toBe('activation-guard-failed');
    expect(m.details?.unmetConditions).toEqual(['needs body', 'needs codeLinks']);
  });

  test('GildashInitError → gildash-init-failed', () => {
    const m = toCliError(new GildashInitError('gildash failed: path not found'));
    expect(m.code).toBe('gildash-init-failed');
    expect(m.message).toContain('path not found');
  });

  test('CompensationError preserves both errors in details', () => {
    const m = toCliError(new CompensationError(new Error('orig'), new Error('comp')));
    expect(m.code).toBe('compensation-failed');
    expect(m.details?.originalError).toContain('orig');
    expect(m.details?.compensationError).toContain('comp');
  });

  test('GlossaryValidationError → glossary-validation-error', () => {
    const m = toCliError(new GlossaryValidationError('dup word'));
    expect(m.code).toBe('glossary-validation-error');
  });

  test('GlossaryNotFoundError → glossary-not-found', () => {
    const m = toCliError(new GlossaryNotFoundError('missingWord'));
    expect(m.code).toBe('glossary-not-found');
  });

  test('unknown Error → internal-error', () => {
    const m = toCliError(new Error('weird'));
    expect(m.code).toBe('internal-error');
    expect(m.message).toBe('weird');
  });

  test('non-Error value → internal-error with stringified message', () => {
    const m = toCliError('a string');
    expect(m.code).toBe('internal-error');
    expect(m.message).toBe('a string');
  });
});
