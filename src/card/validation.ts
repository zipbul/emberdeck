import { CardValidationError, ParentValidationError, ActivationGuardError } from './errors';
import type { EmberdeckContext } from '../config';
import type { BriefBody, CardFrontmatter, CardType, SpecBody } from './types';
import { validateBriefRefs } from '../brief/validate-refs';
import { validateSpecRefs } from '../spec/validate-refs';
import { validatePrincipleCard } from '../principle/validate';

/**
 * Per-field maximum size constants applied by `validateCardInput`.
 * Shared across the operation layer (create, update) and tests.
 */
export const LIMITS = {
  /** Maximum length of summary (character count) */
  SUMMARY_MAX: 300,
  /** Maximum length of body (character count) */
  BODY_MAX: 100_000,
  /** Maximum item count for array fields (tags, relations, codeLinks) */
  ARRAY_MAX: 100,
  /** Maximum length of individual tag items */
  ITEM_MAX: 100,
  /** Maximum length of relations[] items (card keys) */
  RELATION_TARGET_MAX: 200,
  /** Maximum length of codeLinks[].symbol */
  CODE_LINK_SYMBOL_MAX: 200,
  /** Maximum length of codeLinks[].file */
  CODE_LINK_FILE_MAX: 500,
  /** Maximum length of card key */
  KEY_MAX: 200,
  /** Maximum number of boundary patterns */
  BOUNDARY_MAX_PATTERNS: 50,
  /** Maximum length of each boundary pattern */
  BOUNDARY_PATTERN_MAX: 500,
} as const;

/**
 * Input interface passed to `validateCardInput`.
 * If a field is `undefined`, validation for that field is skipped.
 */
export interface ValidationInput {
  key?: string;
  summary?: string;
  body?: string;
  tags?: string[];
  relations?: string[];
  codeLinks?: Array<{ kind: string; file: string; symbol: string }>;
  boundary?: string[];
  type?: string;
  status?: string;
}

const VALID_TYPES = new Set(['principle', 'brief', 'spec']);
const VALID_STATUSES = new Set(['draft', 'active', 'drifted', 'retired']);

/**
 * Validates size limits of card input values.
 * Throws {@link CardValidationError} on violation.
 * Fields are checked in order, so only the first violation is reported.
 *
 * @param input - The input object to validate. `undefined` fields are skipped.
 * @throws {CardValidationError} On size limit violation.
 */
export function validateCardInput(input: ValidationInput): void {
  const { key, summary, body, tags, relations, codeLinks, boundary, type, status } = input;

  // ── type ──
  if (type !== undefined && !VALID_TYPES.has(type)) {
    throw new CardValidationError(
      `Invalid card type "${type}" (expected one of: principle, brief, spec)`,
    );
  }

  // ── status ──
  if (status !== undefined && !VALID_STATUSES.has(status)) {
    throw new CardValidationError(
      `Invalid card status "${status}" (expected one of: draft, active, drifted, retired)`,
    );
  }

  // ── key ────────────────────────────────────────────────────
  if (key !== undefined && key.length > LIMITS.KEY_MAX) {
    throw new CardValidationError(
      `key exceeds maximum length of ${LIMITS.KEY_MAX} characters (got ${key.length})`,
    );
  }

  // ── summary ──────────────────────────────────────────────
  if (summary !== undefined) {
    if (summary.length === 0) {
      throw new CardValidationError('summary must not be empty');
    }
    if (summary.length > LIMITS.SUMMARY_MAX) {
      throw new CardValidationError(
        `summary exceeds maximum length of ${LIMITS.SUMMARY_MAX} characters (got ${summary.length})`,
      );
    }
  }

  // ── body ─────────────────────────────────────────────────
  if (body !== undefined && body.length > LIMITS.BODY_MAX) {
    throw new CardValidationError(
      `body exceeds maximum length of ${LIMITS.BODY_MAX} characters (got ${body.length})`,
    );
  }

  // ── tags ─────────────────────────────────────────────────
  if (tags !== undefined) {
    if (tags.length > LIMITS.ARRAY_MAX) {
      throw new CardValidationError(
        `tags array exceeds maximum of ${LIMITS.ARRAY_MAX} items (got ${tags.length})`,
      );
    }
    for (const tag of tags) {
      if (tag.length === 0) {
        throw new CardValidationError('tag item must not be empty');
      }
      if (tag.length > LIMITS.ITEM_MAX) {
        throw new CardValidationError(
          `tag item exceeds maximum length of ${LIMITS.ITEM_MAX} characters`,
        );
      }
    }
  }

  // ── relations ─────────────────────────────────────────────
  if (relations !== undefined) {
    if (relations.length > LIMITS.ARRAY_MAX) {
      throw new CardValidationError(
        `relations array exceeds maximum of ${LIMITS.ARRAY_MAX} items (got ${relations.length})`,
      );
    }
    for (const rel of relations) {
      if (rel.length === 0) {
        throw new CardValidationError('relation item must not be empty');
      }
      if (rel.length > LIMITS.RELATION_TARGET_MAX) {
        throw new CardValidationError(
          `relation item exceeds maximum length of ${LIMITS.RELATION_TARGET_MAX} characters`,
        );
      }
    }
    // Self-reference check requires card key context — done at ops layer
  }

  // ── codeLinks ─────────────────────────────────────────────
  if (codeLinks !== undefined) {
    if (codeLinks.length > LIMITS.ARRAY_MAX) {
      throw new CardValidationError(
        `codeLinks array exceeds maximum of ${LIMITS.ARRAY_MAX} items (got ${codeLinks.length})`,
      );
    }
    for (const link of codeLinks) {
      if (link.file.length === 0) {
        throw new CardValidationError('codeLink file must not be empty');
      }
      if (link.symbol.length === 0) {
        throw new CardValidationError('codeLink symbol must not be empty');
      }
      if (link.symbol.length > LIMITS.CODE_LINK_SYMBOL_MAX) {
        throw new CardValidationError(
          `codeLink symbol exceeds maximum length of ${LIMITS.CODE_LINK_SYMBOL_MAX} characters`,
        );
      }
      if (link.file.length > LIMITS.CODE_LINK_FILE_MAX) {
        throw new CardValidationError(
          `codeLink file path exceeds maximum length of ${LIMITS.CODE_LINK_FILE_MAX} characters`,
        );
      }
    }
  }

  // ── boundary ──────────────────────────────────────────────
  if (boundary !== undefined) {
    if (boundary.length > LIMITS.BOUNDARY_MAX_PATTERNS) {
      throw new CardValidationError(
        `boundary array exceeds maximum of ${LIMITS.BOUNDARY_MAX_PATTERNS} patterns (got ${boundary.length})`,
      );
    }
    for (const pattern of boundary) {
      if (pattern.length === 0) {
        throw new CardValidationError('boundary pattern must not be empty');
      }
      if (pattern.length > LIMITS.BOUNDARY_PATTERN_MAX) {
        throw new CardValidationError(
          `boundary pattern exceeds maximum length of ${LIMITS.BOUNDARY_PATTERN_MAX} characters`,
        );
      }
      // Validate glob syntax
      try {
        new Bun.Glob(pattern);
      } catch {
        throw new CardValidationError(`boundary pattern is not valid glob syntax: "${pattern}"`);
      }
    }
  }
}

// ── Integrity validators (require DB context) ─────────────────────────────

const MAX_PARENT_DEPTH = 20;

/**
 * Validates that the parent card exists in the DB.
 */
export function validateParentExists(ctx: EmberdeckContext, parentKey: string): void {
  if (!ctx.cardRepo.existsByKey(parentKey)) {
    throw new ParentValidationError(`Parent card not found: "${parentKey}"`);
  }
}

/**
 * Validates parent-type hierarchy rules:
 * - brief: parent must be null or brief
 * - spec: parent must be brief or spec
 */
export function validateParentType(ctx: EmberdeckContext, cardType: CardType, parentKey: string): void {
  const parent = ctx.cardRepo.findByKey(parentKey);
  if (!parent) {
    throw new ParentValidationError(`Parent card not found: "${parentKey}"`);
  }
  const parentType = parent.type as CardType;

  if (cardType === 'principle') {
    throw new ParentValidationError(
      `principle card cannot have a parent (principle is always root-level)`,
    );
  } else if (cardType === 'brief') {
    if (parentType !== 'brief') {
      throw new ParentValidationError(
        `brief card parent must be brief (got "${parentType}")`,
      );
    }
  } else if (cardType === 'spec') {
    if (parentType !== 'brief' && parentType !== 'spec') {
      throw new ParentValidationError(
        `spec card parent must be brief or spec (got "${parentType}")`,
      );
    }
  }
}

/**
 * Detects circular parent references by walking the ancestor chain (max 20 depth).
 */
export function validateParentCycle(ctx: EmberdeckContext, cardKey: string, parentKey: string): void {
  let current: string | null = parentKey;
  for (let i = 0; i < MAX_PARENT_DEPTH && current; i++) {
    if (current === cardKey) {
      throw new ParentValidationError(`Circular parent reference detected: "${cardKey}" → ... → "${cardKey}"`);
    }
    const row = ctx.cardRepo.findByKey(current);
    current = row?.parent ?? null;
  }
}

/**
 * Validates that all relation targets exist in the DB and none is a self-reference.
 */
export function validateRelationTargets(ctx: EmberdeckContext, cardKey: string, relations: string[]): void {
  for (const target of relations) {
    if (target === cardKey) {
      throw new CardValidationError(`Relation self-reference not allowed: "${cardKey}"`);
    }
    if (!ctx.cardRepo.existsByKey(target)) {
      throw new CardValidationError(`Relation target not found: "${target}"`);
    }
  }
}

/**
 * Validates that changing a card's type won't break children's parent-type hierarchy.
 */
export function validateChildrenHierarchy(ctx: EmberdeckContext, cardKey: string, newType: CardType): void {
  const children = ctx.cardRepo.findChildren(cardKey);
  for (const child of children) {
    const childType = child.type as CardType;
    if (newType === 'spec' && childType === 'brief') {
      throw new ParentValidationError(
        `Cannot change to spec: child "${child.key}" is brief (brief cannot have spec parent)`,
      );
    }
  }
}

/**
 * Activation guard: validates that a card meets the conditions for active status.
 * - principle: requires `principle` namespace + valid applies_to
 * - brief: requires `brief` namespace + cross-ref validation passes
 * - spec: requires `spec` namespace, codeLinks >= 1 and all resolve; if boundary present, at least 1 file must match
 */
export async function validateActivationGuard(
  ctx: EmberdeckContext,
  card: {
    type: CardType;
    codeLinks?: Array<{ file: string; symbol: string }>;
    boundary?: string[];
    principle?: CardFrontmatter['principle'];
    brief?: BriefBody;
    spec?: SpecBody;
    key?: string;
  },
): Promise<void> {
  if (card.type === 'principle') {
    if (!card.principle) {
      throw new ActivationGuardError('Activation conditions not met', [
        'principle card must have `principle` namespace in frontmatter to activate',
      ]);
    }
    try {
      validatePrincipleCard({
        type: 'principle',
        key: card.key ?? '',
        summary: '',
        status: 'draft',
        principle: card.principle,
      } as CardFrontmatter);
    } catch (e) {
      throw new ActivationGuardError(
        'Activation conditions not met',
        [(e as Error).message],
      );
    }
    return;
  }
  if (card.type === 'brief') {
    if (!card.brief) {
      throw new ActivationGuardError('Activation conditions not met', [
        'brief card must have `brief` namespace in frontmatter to activate',
      ]);
    }
    try {
      validateBriefRefs(card.brief);
    } catch (e) {
      throw new ActivationGuardError(
        'Activation conditions not met',
        [(e as Error).message],
      );
    }
    return;
  }

  // spec activation conditions
  const unmet: string[] = [];

  if (!card.spec) {
    unmet.push('spec card must have `spec` namespace in frontmatter to activate');
  } else {
    try {
      validateSpecRefs(card.spec, { codeLinks: card.codeLinks } as CardFrontmatter);
    } catch (e) {
      unmet.push((e as Error).message);
    }
  }

  const links = card.codeLinks ?? [];
  if (links.length === 0) {
    unmet.push('spec card must have at least 1 codeLink');
  } else if (ctx.gildash) {
    for (const link of links) {
      const results = ctx.gildash.searchSymbols({
        text: link.symbol,
        exact: true,
        filePath: link.file,
      });
      const found = Array.isArray(results)
        ? results.find((s) => s.name === link.symbol && s.filePath === link.file)
        : null;
      if (!found) {
        unmet.push(`codeLink '${link.file}:${link.symbol}' unresolved`);
      }
    }
  }

  if (card.boundary && card.boundary.length > 0) {
    let anyMatch = false;
    for (const pattern of card.boundary) {
      const glob = new Bun.Glob(pattern);
      // Check if at least one file matches (scan project root)
      if (ctx.gildash) {
        const files = ctx.gildash.listIndexedFiles();
        for (const f of files) {
          if (glob.match(f.filePath)) {
            anyMatch = true;
            break;
          }
        }
      } else {
        // Without gildash, skip boundary check
        anyMatch = true;
      }
      if (anyMatch) break;
    }
    if (!anyMatch) {
      unmet.push(`boundary patterns match no indexed files`);
    }
  }

  if (unmet.length > 0) {
    throw new ActivationGuardError('Activation conditions not met', unmet);
  }
}

/**
 * Re-validates activation guard when type changes on an active card.
 * Returns 'draft' if the new type's conditions are unmet, otherwise returns the current status.
 */
export async function validateTypeChangeActivation(
  ctx: EmberdeckContext,
  card: {
    status: string;
    type: CardType;
    codeLinks?: Array<{ file: string; symbol: string }>;
    boundary?: string[];
    principle?: CardFrontmatter['principle'];
    brief?: BriefBody;
    spec?: SpecBody;
  },
  newType: CardType,
): Promise<string> {
  if (card.status !== 'active') return card.status;

  try {
    await validateActivationGuard(ctx, { ...card, type: newType });
    return card.status;
  } catch (e) {
    if (e instanceof ActivationGuardError) {
      return 'draft'; // force to draft
    }
    throw e;
  }
}
