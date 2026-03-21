import { describe, it, expect } from 'bun:test';
import {
  CardValidationError,
  CardNotFoundError,
  CardAlreadyExistsError,
  CardRenameSamePathError,
  ParentValidationError,
  ActivationGuardError,
  BoundaryValidationError,
  GildashNotConfiguredError,
} from './errors';

// ── CardValidationError ──────────────────────────────────────────────────────

describe('CardValidationError', () => {
  it('should set message, name, and be instanceof Error when constructed', () => {
    // Arrange / Act
    const err = new CardValidationError('frontmatter missing key');
    // Assert
    expect(err.message).toBe('frontmatter missing key');
    expect(err.name).toBe('CardValidationError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CardValidationError);
  });

  it('should allow empty string message when empty string given', () => {
    // Arrange / Act
    const err = new CardValidationError('');
    // Assert
    expect(err.message).toBe('');
  });

  it('should be catchable as CardValidationError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => { throw new CardValidationError('bad field'); }).toThrow(CardValidationError);
  });
});

// ── CardNotFoundError ────────────────────────────────────────────────────────

describe('CardNotFoundError', () => {
  it('should format message with key and set name when constructed', () => {
    // Arrange / Act
    const err = new CardNotFoundError('my-card');
    // Assert
    expect(err.message).toBe('Card not found: "my-card"');
    expect(err.name).toBe('CardNotFoundError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CardNotFoundError);
  });

  it('should produce "Card not found: " when empty key given', () => {
    // Arrange / Act
    const err = new CardNotFoundError('');
    // Assert
    expect(err.message).toBe('Card not found: ""');
  });

  it('should include nested key in message when nested slug given', () => {
    // Arrange / Act
    const err = new CardNotFoundError('parent/child/item');
    // Assert
    expect(err.message).toContain('parent/child/item');
  });

  it('should be catchable as CardNotFoundError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => { throw new CardNotFoundError('k'); }).toThrow(CardNotFoundError);
  });

  it('should produce identical messages when same key given twice', () => {
    // Arrange / Act
    const a = new CardNotFoundError('dup-key');
    const b = new CardNotFoundError('dup-key');
    // Assert
    expect(a.message).toBe(b.message);
  });
});

// ── CardAlreadyExistsError ───────────────────────────────────────────────────

describe('CardAlreadyExistsError', () => {
  it('should format message with key and set name when constructed', () => {
    // Arrange / Act
    const err = new CardAlreadyExistsError('existing-card');
    // Assert
    expect(err.message).toBe('Card already exists: "existing-card"');
    expect(err.name).toBe('CardAlreadyExistsError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CardAlreadyExistsError);
  });

  it('should produce "Card already exists: " when empty key given', () => {
    // Arrange / Act
    const err = new CardAlreadyExistsError('');
    // Assert
    expect(err.message).toBe('Card already exists: ""');
  });

  it('should be catchable as CardAlreadyExistsError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => { throw new CardAlreadyExistsError('k'); }).toThrow(CardAlreadyExistsError);
  });
});

// ── CardRenameSamePathError ──────────────────────────────────────────────────

describe('CardRenameSamePathError', () => {
  it('should set fixed message and name when constructed', () => {
    // Arrange / Act
    const err = new CardRenameSamePathError();
    // Assert
    expect(err.message).toBe('No-op rename: source and target paths are identical');
    expect(err.name).toBe('CardRenameSamePathError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CardRenameSamePathError);
  });

  it('should be catchable as CardRenameSamePathError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => { throw new CardRenameSamePathError(); }).toThrow(CardRenameSamePathError);
  });

  it('should produce identical messages for two separate instances', () => {
    // Arrange / Act
    const a = new CardRenameSamePathError();
    const b = new CardRenameSamePathError();
    // Assert
    expect(a.message).toBe(b.message);
  });
});

// ── ParentValidationError ────────────────────────────────────────────────────

describe('ParentValidationError', () => {
  it('should set message, name, and be instanceof Error when constructed', () => {
    // Arrange / Act
    const err = new ParentValidationError('parent not found');
    // Assert
    expect(err.message).toBe('parent not found');
    expect(err.name).toBe('ParentValidationError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ParentValidationError);
  });

  it('should be catchable as ParentValidationError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => { throw new ParentValidationError('bad parent'); }).toThrow(ParentValidationError);
  });
});

// ── ActivationGuardError ─────────────────────────────────────────────────────

describe('ActivationGuardError', () => {
  it('should set message, name, and unmetConditions when constructed', () => {
    // Arrange / Act
    const conditions = ['missing summary', 'no codeLinks'];
    const err = new ActivationGuardError('activation blocked', conditions);
    // Assert
    expect(err.message).toBe('activation blocked');
    expect(err.name).toBe('ActivationGuardError');
    expect(err.unmetConditions).toEqual(['missing summary', 'no codeLinks']);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ActivationGuardError);
  });

  it('should accept empty unmetConditions array when no conditions given', () => {
    // Arrange / Act
    const err = new ActivationGuardError('no conditions', []);
    // Assert
    expect(err.unmetConditions).toEqual([]);
  });

  it('should be catchable as ActivationGuardError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => { throw new ActivationGuardError('x', ['c']); }).toThrow(ActivationGuardError);
  });
});

// ── BoundaryValidationError ──────────────────────────────────────────────────

describe('BoundaryValidationError', () => {
  it('should set message, name, and be instanceof Error when constructed', () => {
    // Arrange / Act
    const err = new BoundaryValidationError('invalid glob');
    // Assert
    expect(err.message).toBe('invalid glob');
    expect(err.name).toBe('BoundaryValidationError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BoundaryValidationError);
  });

  it('should be catchable as BoundaryValidationError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => { throw new BoundaryValidationError('bad pattern'); }).toThrow(BoundaryValidationError);
  });
});

// ── GildashNotConfiguredError ─────────────────────────────────────────────────

describe('GildashNotConfiguredError', () => {
  // 19. [HP] exact message string
  it('should set correct message when constructed', () => {
    // Arrange / Act
    const err = new GildashNotConfiguredError();
    // Assert
    expect(err.message).toBe(
      'gildash is not configured: set projectRoot in EmberdeckOptions',
    );
  });

  // 20. [HP] name check
  it('should set name to GildashNotConfiguredError when constructed', () => {
    // Arrange / Act
    const err = new GildashNotConfiguredError();
    // Assert
    expect(err.name).toBe('GildashNotConfiguredError');
  });

  // 21. [HP] instanceof Error
  it('should be instanceof Error when constructed', () => {
    // Arrange / Act
    const err = new GildashNotConfiguredError();
    // Assert
    expect(err).toBeInstanceOf(Error);
  });

  // 22. [HP] instanceof GildashNotConfiguredError
  it('should be instanceof GildashNotConfiguredError when constructed', () => {
    // Arrange / Act
    const err = new GildashNotConfiguredError();
    // Assert
    expect(err).toBeInstanceOf(GildashNotConfiguredError);
  });

  // 23. [HP] catchable after throw
  it('should be catchable as GildashNotConfiguredError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => {
      throw new GildashNotConfiguredError();
    }).toThrow(GildashNotConfiguredError);
  });
});
