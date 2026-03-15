import type { EmberdeckContext } from '../config';
import type { AcceptanceCriterion } from '../card/types';
import type { UpdateCardResult } from './update';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { withCardLock, withRetry, safeWriteOperation } from './safe';
import { syncCardFromFile } from './sync';

/**
 * Result of verifyAcceptance operation.
 */
export interface VerifyAcceptanceResult {
  /** Card key. */
  key: string;
  /** Updated acceptance criteria. */
  acceptance: AcceptanceCriterion[];
  /** Number of criteria that were changed. */
  changed: number;
}

/**
 * Set the verified status of one or more acceptance criteria on a card.
 *
 * @param ctx - EmberdeckContext
 * @param fullKey - Card key
 * @param criterionIds - One or more criterion IDs to update
 * @param verified - New verified status (default: true)
 */
export async function verifyAcceptance(
  ctx: EmberdeckContext,
  fullKey: string,
  criterionIds: string | string[],
  verified = true,
): Promise<VerifyAcceptanceResult> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  const ids = Array.isArray(criterionIds) ? criterionIds : [criterionIds];

  return withCardLock(ctx, key, () =>
    withRetry(async () => {
      if (!(await Bun.file(filePath).exists())) {
        throw new CardNotFoundError(key);
      }

      const current = await readCardFile(filePath);
      if (current.frontmatter.key !== key) {
        throw new CardNotFoundError(key);
      }

      if (!current.frontmatter.acceptance || current.frontmatter.acceptance.length === 0) {
        throw new Error(`Card "${key}" has no acceptance criteria`);
      }

      let changed = 0;
      const acceptance = current.frontmatter.acceptance.map((ac) => {
        if (ids.includes(ac.id) && ac.verified !== verified) {
          changed++;
          return { ...ac, verified };
        }
        return ac;
      });

      const card = {
        filePath,
        frontmatter: { ...current.frontmatter, acceptance },
        body: current.body,
      };

      const now = new Date().toISOString();

      return safeWriteOperation({
        dbAction: () => {
          const existing = ctx.cardRepo.findByKey(key);
          if (existing) {
            ctx.cardRepo.upsert({
              ...existing,
              acceptanceJson: JSON.stringify(acceptance),
              updatedAt: now,
            });
          }

          if (changed > 0) {
            ctx.changelogRepo.insert({
              cardKey: key,
              field: 'acceptance',
              oldValue: JSON.stringify(current.frontmatter.acceptance),
              newValue: JSON.stringify(acceptance),
              changedAt: now,
              changedBy: 'agent',
            });
          }

          return { key, acceptance, changed } as VerifyAcceptanceResult;
        },
        fileAction: async () => {
          await writeCardFile(filePath, card);
        },
        compensate: async () => {
          await syncCardFromFile(ctx, filePath);
        },
      });
    }),
  );
}

/**
 * Card with unverified acceptance criteria.
 */
export interface UnverifiedCard {
  key: string;
  summary: string;
  status: string;
  unverified: AcceptanceCriterion[];
  total: number;
}

/**
 * List all cards that have unverified acceptance criteria.
 */
export function listUnverified(ctx: EmberdeckContext): UnverifiedCard[] {
  const rows = ctx.cardRepo.list();
  const result: UnverifiedCard[] = [];

  for (const row of rows) {
    if (!row.acceptanceJson) continue;
    const acceptance = JSON.parse(row.acceptanceJson) as AcceptanceCriterion[];
    const unverified = acceptance.filter((ac) => !ac.verified);
    if (unverified.length > 0) {
      result.push({
        key: row.key,
        summary: row.summary,
        status: row.status,
        unverified,
        total: acceptance.length,
      });
    }
  }

  return result;
}

/**
 * Get the changelog history for a card.
 */
export function getCardHistory(ctx: EmberdeckContext, fullKey: string, limit = 100) {
  const key = parseFullKey(fullKey);
  return ctx.changelogRepo.findByCardKey(key, limit);
}
