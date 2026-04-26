import { describe, expect, test } from 'bun:test';
import { toCliError } from './errors';
import {
  CardNotFoundError,
  CardAlreadyExistsError,
  CardKeyError,
  CardValidationError,
  ParentValidationError,
  ActivationGuardError,
  GildashNotConfiguredError,
  CompensationError,
} from '../card/errors';
import { GlossaryValidationError } from '../glossary/io';

describe('toCliError', () => {
  test('CardNotFoundError → CARD_NOT_FOUND', () => {
    const m = toCliError(new CardNotFoundError('foo'));
    expect(m.code).toBe('CARD_NOT_FOUND');
    expect(m.message).toContain('foo');
  });

  test('CardAlreadyExistsError → CARD_ALREADY_EXISTS', () => {
    const m = toCliError(new CardAlreadyExistsError('foo'));
    expect(m.code).toBe('CARD_ALREADY_EXISTS');
  });

  test('CardKeyError → INVALID_CARD_KEY', () => {
    const m = toCliError(new CardKeyError('bad/key'));
    expect(m.code).toBe('INVALID_CARD_KEY');
  });

  test('CardValidationError → VALIDATION_ERROR', () => {
    const m = toCliError(new CardValidationError('bad input'));
    expect(m.code).toBe('VALIDATION_ERROR');
  });

  test('ParentValidationError → PARENT_VALIDATION_ERROR', () => {
    const m = toCliError(new ParentValidationError('parent missing'));
    expect(m.code).toBe('PARENT_VALIDATION_ERROR');
  });

  test('ActivationGuardError preserves unmet conditions in details', () => {
    const m = toCliError(new ActivationGuardError('guard failed', ['needs body', 'needs codeLinks']));
    expect(m.code).toBe('ACTIVATION_GUARD_FAILED');
    expect(m.details?.unmet_conditions).toEqual(['needs body', 'needs codeLinks']);
  });

  test('GildashNotConfiguredError → GILDASH_NOT_CONFIGURED', () => {
    const m = toCliError(new GildashNotConfiguredError());
    expect(m.code).toBe('GILDASH_NOT_CONFIGURED');
  });

  test('CompensationError preserves both errors in details', () => {
    const m = toCliError(new CompensationError(new Error('orig'), new Error('comp')));
    expect(m.code).toBe('COMPENSATION_FAILED');
    expect(m.details?.original_error).toContain('orig');
    expect(m.details?.compensation_error).toContain('comp');
  });

  test('GlossaryValidationError → GLOSSARY_VALIDATION_ERROR', () => {
    const m = toCliError(new GlossaryValidationError('dup word'));
    expect(m.code).toBe('GLOSSARY_VALIDATION_ERROR');
  });

  test('unknown Error → INTERNAL_ERROR', () => {
    const m = toCliError(new Error('weird'));
    expect(m.code).toBe('INTERNAL_ERROR');
    expect(m.message).toBe('weird');
  });

  test('non-Error value → INTERNAL_ERROR with stringified message', () => {
    const m = toCliError('a string');
    expect(m.code).toBe('INTERNAL_ERROR');
    expect(m.message).toBe('a string');
  });
});
