import { CardValidationError, ParentValidationError, ActivationGuardError } from './errors';
import { ensureReindexed, makeSymbolFileCache, listAllIndexedFilesWithProject } from '../ops/link';
import type { EmberdeckContext } from '../config';
import type { BriefBody, CardFrontmatter, CardType, CardStatus, SpecBody } from './types';
import { validateBriefRefs } from '../brief/validate-refs';
import { validateSpecRefs } from '../spec/validate-refs';
import { validatePrincipleCard } from '../principle/validate';
import { validateDomainCard } from '../domain/validate';

/**
 * Per-field maximum size constants applied by `validateCardInput`.
 * Shared across the operation layer (create, update) and tests.
 */
export const LIMITS = {
  /** Maximum length of summary (character count) */
  SUMMARY_MAX: 300,
  /** Maximum length of body (character count) */
  BODY_MAX: 100_000,
  /** Maximum item count for array fields (tags, relations) */
  ARRAY_MAX: 100,
  /** Maximum length of individual tag items */
  ITEM_MAX: 100,
  /** Maximum length of relations[] items (card keys) */
  RELATION_TARGET_MAX: 200,
  /** Maximum length of card key */
  KEY_MAX: 200,
} as const;

/**
 * Input interface passed to `validateCardInput`.
 * If a field is `undefined`, validation for that field is skipped.
 */
export interface ValidationInput {
  key?: string;
  summary?: string;
  tags?: string[];
  relations?: string[];
  type?: string;
  status?: string;
}

import { CARD_TYPES, CARD_STATUSES } from './types';

/**
 * Validates size limits of card input values.
 * Throws {@link CardValidationError} on violation.
 * Fields are checked in order, so only the first violation is reported.
 *
 * @param input - The input object to validate. `undefined` fields are skipped.
 * @throws {CardValidationError} On size limit violation.
  * @spec card-model/schema-and-validation/validate-card-input
 */
export function validateCardInput(input: ValidationInput): void {
  const { key, summary, tags, relations, type, status } = input;

  // ── type ──
  if (type !== undefined) {
    if (typeof type !== 'string') {
      throw new CardValidationError(`Invalid card type: must be a string (got ${typeof type})`);
    }
    if (!CARD_TYPES.includes(type as CardType)) {
      throw new CardValidationError(
        `Invalid card type "${type}" (expected one of: ${CARD_TYPES.join(', ')})`,
      );
    }
  }

  // ── status ──
  if (status !== undefined) {
    if (typeof status !== 'string') {
      throw new CardValidationError(`Invalid card status: must be a string (got ${typeof status})`);
    }
    if (!CARD_STATUSES.includes(status as CardStatus)) {
      throw new CardValidationError(
        `Invalid card status "${status}" (expected one of: ${CARD_STATUSES.join(', ')})`,
      );
    }
  }

  // ── key ────────────────────────────────────────────────────
  if (key !== undefined) {
    if (typeof key !== 'string') {
      throw new CardValidationError(`key must be a string (got ${typeof key})`);
    }
    if (key.length > LIMITS.KEY_MAX) {
      throw new CardValidationError(
        `key exceeds maximum length of ${LIMITS.KEY_MAX} characters (got ${key.length})`,
      );
    }
  }

  // ── summary ──────────────────────────────────────────────
  if (summary !== undefined) {
    if (typeof summary !== 'string') {
      throw new CardValidationError(`summary must be a string (got ${typeof summary})`);
    }
    if (summary.length === 0) {
      throw new CardValidationError('summary must not be empty');
    }
    if (summary.length > LIMITS.SUMMARY_MAX) {
      throw new CardValidationError(
        `summary exceeds maximum length of ${LIMITS.SUMMARY_MAX} characters (got ${summary.length})`,
      );
    }
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
}

// ── Integrity validators (require DB context) ─────────────────────────────

const MAX_PARENT_DEPTH = 20;

/**
 * Validates that the parent card exists in the DB.
  * @spec card-model/schema-and-validation/parent-and-hierarchy
 */
export function validateParentExists(ctx: EmberdeckContext, parentKey: string): void {
  if (!ctx.cardRepo.existsByKey(parentKey)) {
    throw new ParentValidationError(`Parent card not found: "${parentKey}"`);
  }
}

/**
 * Validates parent-type hierarchy rules (4-tier: principle/domain/brief/spec).
 * - principle: must be root (no parent allowed)
 * - domain: must be root (no parent allowed) — bounded contexts are top-level
 * - brief: parent MUST be domain (no brief recursion; siblings absorb bloat instead)
 * - spec: parent must be brief or spec (sub-spec recursion allowed)
  * @spec card-model/schema-and-validation/parent-and-hierarchy
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
  } else if (cardType === 'domain') {
    throw new ParentValidationError(
      `domain card cannot have a parent (domain is always root-level)`,
    );
  } else if (cardType === 'brief') {
    if (parentType !== 'domain') {
      throw new ParentValidationError(
        `brief card parent must be domain (got "${parentType}"); brief recursion is not allowed`,
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
  * @spec card-model/schema-and-validation/parent-and-hierarchy
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
  * @spec card-model/schema-and-validation/parent-and-hierarchy
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
 * Mirrors the rules in validateParentType but applied retroactively to existing children.
 *
 * Rules (4-tier):
 * - principle / domain children should be: nothing for principle, brief for domain.
 * - brief: only spec children allowed.
 * - spec: only spec children allowed.
  * @spec card-model/schema-and-validation/parent-and-hierarchy
 */
export function validateChildrenHierarchy(ctx: EmberdeckContext, cardKey: string, newType: CardType): void {
  const children = ctx.cardRepo.findChildren(cardKey);
  if (children.length === 0) return;

  if (newType === 'principle') {
    throw new ParentValidationError(
      `Cannot change to principle: card has ${children.length} child card(s); principle must be root-level`,
    );
  }
  if (newType === 'domain') {
    // domain accepts brief children only — fail if any child is not brief
    for (const child of children) {
      const t = child.type as CardType;
      if (t !== 'brief') {
        throw new ParentValidationError(
          `Cannot change to domain: child "${child.key}" is ${t} (domain children must be brief)`,
        );
      }
    }
    return;
  }
  if (newType === 'brief') {
    // brief accepts spec children only — fail if any child is brief or domain etc.
    for (const child of children) {
      const t = child.type as CardType;
      if (t !== 'spec') {
        throw new ParentValidationError(
          `Cannot change to brief: child "${child.key}" is ${t} (brief children must be spec)`,
        );
      }
    }
    return;
  }
  if (newType === 'spec') {
    // spec accepts spec children only
    for (const child of children) {
      const t = child.type as CardType;
      if (t !== 'spec') {
        throw new ParentValidationError(
          `Cannot change to spec: child "${child.key}" is ${t} (spec children must be spec)`,
        );
      }
    }
    return;
  }
}

/**
 * Activation guard: validates that a card meets the conditions for active status.
 * - principle: requires `principle` namespace + valid applies_to. Must be root.
 * - domain: requires `domain` namespace with non-empty overview/scope. Must be root.
 *           cross_domain_dependencies targets must exist and be domain cards.
 * - brief: requires `brief` namespace + cross-ref validation passes.
 *          parent MUST exist and be a domain card (4-tier hierarchy).
 * - spec: requires `spec` namespace; binding to source is via `@spec card-key`
 *         JSDoc annotations populated into the code_link table by `ed spec sync`.
 *         parent MUST exist and be a brief or spec card (4-tier hierarchy).
  * @spec card-lifecycle/status-and-safe-write/update-card-status
 */
export async function validateActivationGuard(
  ctx: EmberdeckContext,
  card: {
    type: CardType;
    parent?: string | null;
    principle?: CardFrontmatter['principle'];
    domain?: CardFrontmatter['domain'];
    brief?: BriefBody;
    spec?: SpecBody;
    key?: string;
  },
): Promise<void> {
  // 4-tier hierarchy enforcement at activation time (strict).
  // Active brief MUST have parent=domain. Active spec MUST have parent=brief|spec.
  // principle/domain MUST be root-level (no parent).
  if (card.type === 'principle' || card.type === 'domain') {
    if (card.parent) {
      throw new ActivationGuardError('Activation conditions not met', [
        `${card.type} card must be root-level (got parent "${card.parent}")`,
      ]);
    }
  } else if (card.type === 'brief') {
    if (!card.parent) {
      throw new ActivationGuardError('Activation conditions not met', [
        'brief card must have parent=domain to activate (4-tier hierarchy)',
      ]);
    }
    const parent = ctx.cardRepo.findByKey(card.parent);
    if (!parent) {
      throw new ActivationGuardError('Activation conditions not met', [
        `parent card "${card.parent}" not found`,
      ]);
    }
    if (parent.type !== 'domain') {
      throw new ActivationGuardError('Activation conditions not met', [
        `brief.parent must be domain (got "${parent.type}")`,
      ]);
    }
  } else if (card.type === 'spec') {
    if (!card.parent) {
      throw new ActivationGuardError('Activation conditions not met', [
        'spec card must have parent=brief|spec to activate (4-tier hierarchy)',
      ]);
    }
    const parent = ctx.cardRepo.findByKey(card.parent);
    if (!parent) {
      throw new ActivationGuardError('Activation conditions not met', [
        `parent card "${card.parent}" not found`,
      ]);
    }
    if (parent.type !== 'brief' && parent.type !== 'spec') {
      throw new ActivationGuardError('Activation conditions not met', [
        `spec.parent must be brief or spec (got "${parent.type}")`,
      ]);
    }
  }

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
  if (card.type === 'domain') {
    // Pure shape validation (no DB) lives in src/domain/validate.ts.
    try {
      validateDomainCard({
        type: 'domain',
        key: card.key ?? '',
        summary: '',
        status: 'draft',
        domain: card.domain,
      } as CardFrontmatter);
    } catch (e) {
      throw new ActivationGuardError('Activation conditions not met', [(e as Error).message]);
    }
    // DB-dependent: every cross_domain_dependencies target must exist and be a domain card.
    const unmetD: string[] = [];
    if (card.domain?.cross_domain_dependencies) {
      for (const dep of card.domain.cross_domain_dependencies) {
        const target = ctx.cardRepo.findByKey(dep.domain);
        if (!target) {
          unmetD.push(`cross_domain_dependencies references unknown card "${dep.domain}"`);
        } else if (target.type !== 'domain') {
          unmetD.push(`cross_domain_dependencies["${dep.domain}"] target is type "${target.type}", expected "domain"`);
        }
      }
    }
    if (unmetD.length > 0) {
      throw new ActivationGuardError('Activation conditions not met', unmetD);
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
      validateSpecRefs(card.spec);
    } catch (e) {
      unmet.push((e as Error).message);
    }
  }

  // Binding to source is via `@spec card-key` annotations in code; the
  // populated DB rows live in the code_link table (kept as a cache of the
  // annotation scan). Source is the SoT — the card itself does not list links.
  if (card.key) {
    await ensureReindexed(ctx);
    // Aggregate across all gildash projects (monorepo support). Default-arg
    // listIndexedFiles() only sees the primary project, missing source in
    // multi-project repos. listAllIndexedFilesWithProject is the centralized
    // aggregator already used by spec-sync / coverage paths.
    const indexedFiles = listAllIndexedFilesWithProject(ctx);
    // Empty index = "no information" — neither demand annotations nor try to
    // resolve. Matches drift-detection semantics elsewhere.
    if (indexedFiles.length > 0) {
      const links = ctx.codeLinkRepo.findByCardKey(card.key);
      if (links.length === 0) {
        unmet.push(
          `spec card has no source bindings — add at least one '@spec ${card.key}' JSDoc annotation`,
        );
      } else {
        const cache = makeSymbolFileCache(ctx);
        for (const link of links) {
          try {
            if (!cache.find(link.file, link.symbol)) {
              unmet.push(`source binding '${link.file}:${link.symbol}' unresolved`);
            }
          } catch {
            unmet.push(`source binding '${link.file}:${link.symbol}' unresolved`);
          }
        }
      }
    }
  }

  if (unmet.length > 0) {
    throw new ActivationGuardError('Activation conditions not met', unmet);
  }
}

/**
 * Re-validates activation guard when type changes on an active card.
 * Returns 'draft' if the new type's conditions are unmet, otherwise returns the current status.
  * @spec card-lifecycle/status-and-safe-write/update-card-status
 */
export async function validateTypeChangeActivation(
  ctx: EmberdeckContext,
  card: {
    status: string;
    type: CardType;
    parent?: string | null;
    principle?: CardFrontmatter['principle'];
    domain?: CardFrontmatter['domain'];
    brief?: BriefBody;
    spec?: SpecBody;
    key?: string;
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
