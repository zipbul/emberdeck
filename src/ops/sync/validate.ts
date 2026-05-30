import { relative } from 'node:path';

import type { EmberdeckContext } from '../../config';
import type { CardRow, RelationRow } from '../../db/repository';
import type { CardType, SpecBody, BriefBody, PrincipleBody } from '../../card/types';
import { readCardFile } from '../../fs/reader';
import { readGlossary } from '../../glossary/io';
import { parseStringArrayJson, parseCrossDomainDependencies, parseNamespaces } from '../../card/json-fields';
import { collectSpecDeriveErrors } from '../../spec/validate-refs';
import type { CardValidationResult, ValidationWarning } from './types';
import { listCardFiles } from './sync-in';

/**
 * Type hierarchy rule (4-tier): principle/domain are root-only; brief.parent
 * must be domain; spec.parent must be brief or spec. Returns null when valid.
 */
function typeHierarchyViolationMessage(
  rowType: CardType,
  parentKey: string,
  parentType: CardType,
): string | null {
  if (rowType === 'principle') return `Principle card must be root-level, but has parent "${parentKey}"`;
  if (rowType === 'domain') return `Domain card must be root-level, but has parent "${parentKey}"`;
  if (rowType === 'brief' && parentType !== 'domain') return `Brief card parent must be domain, got "${parentKey}" (type: ${parentType})`;
  if (rowType === 'spec' && parentType !== 'brief' && parentType !== 'spec') return `Spec card parent must be brief or spec, got "${parentKey}" (type: ${parentType})`;
  return null;
}

/**
 * Cheap key-mismatch detection. Subset of validateCards that only reports
 * cards whose frontmatter key differs from the path-derived slug. Used by
 * `ed validate links` to skip mismatched cards without paying the full
 * validateCards cost (content-mismatch reads, relation walks, glossary).
 * @spec card-storage/persistence/sync
 */
export function detectKeyMismatches(
  ctx: EmberdeckContext,
  dirPath?: string,
): Array<{ row: CardRow; expectedKey: string }> {
  const targetDir = dirPath ?? ctx.cardsDir;
  return ctx.cardRepo
    .list()
    .map((r) => {
      const expectedKey = relative(targetDir, r.filePath).replace(/\.md$/, '');
      return expectedKey !== r.key ? { row: r, expectedKey } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/**
 * Validate consistency between the on-disk card file list and indexed rows.
 * Performs read-only structural validation: hierarchy, relations, glossary,
 * orphans, key mismatches, content drift.
 * @spec card-storage/persistence/sync
 */
export async function validateCards(
  ctx: EmberdeckContext,
  dirPath?: string,
): Promise<CardValidationResult> {
  const targetDir = dirPath ?? ctx.cardsDir;
  const cardFiles = await listCardFiles(targetDir);

  const fileSet = new Set(cardFiles);
  const dbRows = ctx.cardRepo.list();
  const dbFilePaths = new Set(dbRows.map((r) => r.filePath));

  const staleDbRows = dbRows.filter((r) => !fileSet.has(r.filePath));
  const orphanFiles = cardFiles.filter((f) => !dbFilePaths.has(f));
  const keyMismatches = dbRows
    .map((r) => {
      const expectedKey = relative(targetDir, r.filePath).replace(/\.md$/, '');
      return expectedKey !== r.key ? { row: r, expectedKey } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const warnings: ValidationWarning[] = [];

  // Build lookup maps
  const cardByKey = new Map<string, CardRow>();
  for (const row of dbRows) cardByKey.set(row.key, row);

  // Pre-load all relations once to defeat the N+1 findByCardKey loop below.
  const relationsBySrc = new Map<string, RelationRow[]>();
  for (const rel of ctx.relationRepo.findAll()) {
    const list = relationsBySrc.get(rel.srcCardKey) ?? [];
    list.push(rel);
    relationsBySrc.set(rel.srcCardKey, list);
  }

  for (const row of dbRows) {
    // Orphan card: only principle and domain are root-allowed.
    if (!row.parent && row.type !== 'principle' && row.type !== 'domain') {
      warnings.push({
        type: 'orphan-card',
        cardKey: row.key,
        message: `${row.type} card has no parent`,
      });
    }

    // Broken parent: parent refers to non-existent card
    if (row.parent && !cardByKey.has(row.parent)) {
      warnings.push({
        type: 'broken-parent',
        cardKey: row.key,
        message: `Parent "${row.parent}" does not exist`,
      });
    }

    // Type hierarchy violation — mirrors validateParentType (creation-time rule).
    if (row.parent && cardByKey.has(row.parent)) {
      const parent = cardByKey.get(row.parent)!;
      const violation = typeHierarchyViolationMessage(row.type as CardType, row.parent, parent.type as CardType);
      if (violation) {
        warnings.push({ type: 'type-hierarchy-violation', cardKey: row.key, message: violation });
      }
    }

    // Broken cross_domain_dependencies (domain-only).
    if (row.type === 'domain') {
      const deps = parseCrossDomainDependencies(row.namespacesJson);
      if (deps.length > 0) {
        for (const dep of deps) {
          const target = cardByKey.get(dep.domain);
          if (!target) {
            warnings.push({
              type: 'broken-cross-domain-dep',
              cardKey: row.key,
              message: `cross_domain_dependencies references unknown card "${dep.domain}"`,
            });
          } else if (target.type !== 'domain') {
            warnings.push({
              type: 'broken-cross-domain-dep',
              cardKey: row.key,
              message: `cross_domain_dependencies["${dep.domain}"] target is type "${target.type}", expected "domain"`,
            });
          } else if (dep.domain === row.key) {
            warnings.push({
              type: 'broken-cross-domain-dep',
              cardKey: row.key,
              message: `cross_domain_dependencies["${dep.domain}"] is a self-reference`,
            });
          }
        }
      }
    }

    // Broken relation: relation target does not exist
    const relations = relationsBySrc.get(row.key) ?? [];
    for (const rel of relations) {
      if (!rel.isReverse && !cardByKey.has(rel.dstCardKey)) {
        warnings.push({
          type: 'broken-relation',
          cardKey: row.key,
          message: `Relation target "${rel.dstCardKey}" does not exist`,
        });
      }
    }

    // Rework dependency: active card depends on draft card
    if (row.status === 'active') {
      for (const rel of relations) {
        if (!rel.isReverse) {
          const target = cardByKey.get(rel.dstCardKey);
          if (target && target.status === 'draft') {
            warnings.push({
              type: 'rework-dependency',
              cardKey: row.key,
              message: `Active card has relation to draft card "${rel.dstCardKey}"`,
            });
          }
        }
      }
    }
  }

  // Broken derives: spec pre/post `derives` → brief#goal and failures `case_of`
  // → brief#flow must resolve to an existing brief item. Skip draft (deep check,
  // mirrors the draft-bypasses-deep-validation gate). §10 Phase 1.4b
  for (const row of dbRows) {
    if (row.type !== 'spec' || row.status === 'draft') continue;
    const spec = parseNamespaces(row.namespacesJson).spec as SpecBody | undefined;
    if (!spec) continue;
    const deriveErrors = collectSpecDeriveErrors(spec, (key) => {
      const b = cardByKey.get(key);
      const brief = b ? (parseNamespaces(b.namespacesJson).brief as BriefBody | undefined) : undefined;
      return brief ?? null;
    });
    for (const msg of deriveErrors) {
      warnings.push({ type: 'broken-derives', cardKey: row.key, message: msg });
    }
  }

  // applies_to '*' deprecation (§10 Phase 3.2): non-gating warning until the
  // principle cards are narrowed to real keys/globs; later promoted to error.
  for (const row of dbRows) {
    if (row.type !== 'principle') continue;
    const principle = parseNamespaces(row.namespacesJson).principle as PrincipleBody | undefined;
    if (!principle) continue;
    const a = principle.applies_to;
    if (a === '*' || (Array.isArray(a) && a.includes('*'))) {
      warnings.push({
        type: 'applies-to-wildcard',
        cardKey: row.key,
        message: 'principle.applies_to is "*" (deprecated — narrow to real card keys/globs)',
      });
    }
  }

  // Empty tree: brief or domain card with no children (skip draft).
  const hasChildren = new Set<string>();
  for (const row of dbRows) {
    if (row.parent) hasChildren.add(row.parent);
  }
  for (const row of dbRows) {
    if (row.status === 'draft') continue;
    if ((row.type === 'brief' || row.type === 'domain') && !hasChildren.has(row.key)) {
      warnings.push({
        type: 'empty-tree',
        cardKey: row.key,
        message: `Active ${row.type} card has no child cards`,
      });
    }
  }

  // Content mismatch: indexed row and file frontmatter diverged
  for (const row of dbRows) {
    if (!fileSet.has(row.filePath)) continue;
    try {
      const file = await readCardFile(row.filePath);
      if (file.frontmatter.status !== row.status) {
        warnings.push({
          type: 'content-mismatch',
          cardKey: row.key,
          message: `DB status="${row.status}" differs from file status="${file.frontmatter.status}"`,
        });
      }
      if (file.frontmatter.summary !== row.summary) {
        warnings.push({
          type: 'content-mismatch',
          cardKey: row.key,
          message: `DB summary differs from file summary`,
        });
      }
    } catch {
      // File unreadable — already surfaced by orphanFiles / staleDbRows.
    }
  }

  // Glossary cross-validation
  const glossaryEntries = readGlossary(ctx);
  const glossaryWordSet = new Set(glossaryEntries.map((e) => e.word));
  const usedGlossaryWords = new Set<string>();

  for (const row of dbRows) {
    const cardGlossary = parseStringArrayJson(row.glossaryJson);
    if (cardGlossary.length > 0) {
      for (const w of cardGlossary) usedGlossaryWords.add(w);

      for (const word of cardGlossary) {
        if (!glossaryWordSet.has(word)) {
          warnings.push({
            type: 'glossary-broken',
            cardKey: row.key,
            message: `Glossary word "${word}" not found in glossary.yaml`,
          });
        }
      }

      if (fileSet.has(row.filePath)) {
        try {
          const file = await readCardFile(row.filePath);
          const fileGlossary = file.frontmatter.glossary ?? [];
          const dbGlossaryStr = JSON.stringify(cardGlossary.sort());
          const fileGlossaryStr = JSON.stringify([...fileGlossary].sort());
          if (dbGlossaryStr !== fileGlossaryStr) {
            warnings.push({
              type: 'content-mismatch',
              cardKey: row.key,
              message: `DB glossary differs from file glossary`,
            });
          }
        } catch {
          // already handled
        }
      }
    }
  }

  for (const entry of glossaryEntries) {
    if (!usedGlossaryWords.has(entry.word)) {
      warnings.push({
        type: 'glossary-unused',
        cardKey: '',
        message: `Glossary word "${entry.word}" is not referenced by any card`,
      });
    }
  }

  // Broken chain: spec card with no relation or parent link to any brief card.
  for (const row of dbRows) {
    if (row.type === 'spec') {
      const relations = relationsBySrc.get(row.key) ?? [];
      const forwardTargets = relations.filter((r) => !r.isReverse).map((r) => r.dstCardKey);
      const reverseTargets = relations.filter((r) => r.isReverse).map((r) => r.dstCardKey);
      const allRelated = [...forwardTargets, ...reverseTargets];
      const hasBriefRelation = allRelated.some((targetKey) => {
        const target = cardByKey.get(targetKey);
        return target && target.type === 'brief';
      });
      let hasBriefParent = false;
      let current = row.parent;
      while (current) {
        const p = cardByKey.get(current);
        if (p && p.type === 'brief') { hasBriefParent = true; break; }
        current = p?.parent ?? null;
      }
      if (!hasBriefRelation && !hasBriefParent) {
        warnings.push({
          type: 'broken-chain',
          cardKey: row.key,
          message: `Spec card has no relation or parent link to any brief card`,
        });
      }
    }
  }

  return { staleDbRows, orphanFiles, keyMismatches, warnings };
}
