/**
 * Deck-wide cross-card validation for v18 spec edges that no per-card or
 * derives check covers (§9.1 ceiling-raisers — make the declared edges
 * enforceable instead of inert):
 *  - `invokes[].to`        → must resolve to an existing card of type `spec`.
 *  - `shapes[].id` (SHP)   → deck-global unique (owner-uniqueness key).
 *  - `postconditions[].references` → must resolve to a SHP declared by some spec.
 *  - `failures[].owner`    → must resolve to an existing card of type `spec`.
 *  - `failures[].references` → FAIL-id that exists in the `owner` spec; and
 *                            `references` without an `owner` is meaningless.
 *
 * Draft specs are skipped (WIP) and excluded from the SHP registry, mirroring
 * the broken-derives pass. Each issue is a gating finding (a broken edge), not
 * a warning.
 */

import type { CardType, SpecBody } from '../card/types';

export interface SpecCrossCardIssue {
  cardKey: string;
  code: string;
  message: string;
}

export interface SpecNode {
  key: string;
  status: string;
  spec: SpecBody;
}

export function collectSpecCrossCardErrors(
  specs: SpecNode[],
  cardTypeByKey: Map<string, CardType>,
): SpecCrossCardIssue[] {
  const issues: SpecCrossCardIssue[] = [];
  const active = specs.filter((s) => s.status !== 'draft');

  // ── SHP deck-global registry (owner-uniqueness key) ──────────
  const shpOwners = new Map<string, string[]>();
  for (const s of active) {
    for (const shape of s.spec.shapes ?? []) {
      const owners = shpOwners.get(shape.id) ?? [];
      owners.push(s.key);
      shpOwners.set(shape.id, owners);
    }
  }
  for (const [shp, owners] of shpOwners) {
    if (owners.length > 1) {
      for (const owner of owners) {
        issues.push({
          cardKey: owner,
          code: 'duplicate-shape-id',
          message: `shape id "${shp}" is declared by ${owners.length} specs (${owners.join(', ')}); SHP ids are deck-global and must be unique`,
        });
      }
    }
  }

  const isSpec = (key: string): boolean => cardTypeByKey.get(key) === 'spec';

  for (const s of active) {
    // ── invokes[].to → existing spec ───────────────────────────
    for (const inv of s.spec.invokes ?? []) {
      if (!cardTypeByKey.has(inv.to)) {
        issues.push({ cardKey: s.key, code: 'broken-invoke', message: `invokes target "${inv.to}" does not exist` });
      } else if (!isSpec(inv.to)) {
        issues.push({ cardKey: s.key, code: 'broken-invoke', message: `invokes target "${inv.to}" is type "${cardTypeByKey.get(inv.to)}", expected "spec"` });
      }
    }

    // ── postconditions[].references → a declared SHP ───────────
    for (const post of s.spec.postconditions) {
      if (post.references != null && !shpOwners.has(post.references)) {
        issues.push({ cardKey: s.key, code: 'broken-shape-ref', message: `postconditions[${post.id}] references shape "${post.references}" which no spec declares` });
      }
    }

    // ── failures[].owner / references (cross-domain dedup) ─────
    for (const f of s.spec.failures) {
      const fid = f.id ?? 'FAIL-?';
      if (f.owner != null) {
        if (!cardTypeByKey.has(f.owner)) {
          issues.push({ cardKey: s.key, code: 'broken-failure-owner', message: `failures[${fid}].owner "${f.owner}" does not exist` });
        } else if (!isSpec(f.owner)) {
          issues.push({ cardKey: s.key, code: 'broken-failure-owner', message: `failures[${fid}].owner "${f.owner}" is type "${cardTypeByKey.get(f.owner)}", expected "spec"` });
        }
      }
      if (f.references != null) {
        if (f.owner == null) {
          issues.push({ cardKey: s.key, code: 'broken-failure-ref', message: `failures[${fid}].references "${f.references}" requires an owner spec to resolve against` });
        } else {
          const ownerSpec = active.find((x) => x.key === f.owner);
          const hasFail = ownerSpec?.spec.failures.some((of) => of.id === f.references) ?? false;
          if (!hasFail) {
            issues.push({ cardKey: s.key, code: 'broken-failure-ref', message: `failures[${fid}].references "${f.references}" not found in owner spec "${f.owner}"` });
          }
        }
      }
    }
  }

  return issues;
}
