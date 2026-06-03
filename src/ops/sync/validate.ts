import { relative } from 'node:path';

import type { EmberdeckContext } from '../../config';
import type { CardRow, RelationRow } from '../../db/repository';
import type { CardType, SpecBody, BriefBody, PrincipleBody, DomainBody } from '../../card/types';
import { readCardFile } from '../../fs/reader';
import { readGlossary } from '../../glossary/io';
import { parseStringArrayJson, parseCrossDomainDependencies, parseNamespaces, serializeNamespaces } from '../../card/json-fields';
import { collectSpecDeriveErrors } from '../../spec/validate-refs';
import { collectSpecCrossCardErrors, type SpecNode } from '../../spec/validate-cross-card';
import { evaluateStructuralPrinciples, type StructuralPrincipleRule } from '../../principle/structural-verify';
import { evaluateBindingPrinciples, type BindingPrincipleRule } from '../../principle/binding-verify';
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
  if (rowType === 'vision') return `Vision card must be root-level, but has parent "${parentKey}"`;
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
/** Stable, key-order-independent JSON (arrays keep order; object keys sorted). */
function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, sort(val)]),
      );
    }
    return x;
  };
  return JSON.stringify(sort(v));
}

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
    // Orphan card: only vision, principle and domain are root-allowed.
    if (!row.parent && row.type !== 'vision' && row.type !== 'principle' && row.type !== 'domain') {
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
          // §10 Phase 2.2: relationship should narrow to the invokes|consumes enum;
          // free-text is a (non-gating) deprecation warning until mapped. Original
          // wording is preserved via `note?`.
          if (dep.relationship != null && dep.relationship !== 'invokes' && dep.relationship !== 'consumes') {
            warnings.push({
              type: 'relationship-free-text',
              cardKey: row.key,
              message: `cross_domain_dependencies["${dep.domain}"].relationship "${dep.relationship}" is free-text (deprecated — use invokes|consumes + note?)`,
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

    // Rework dependency: active card depends on draft card — via relations[]
    // OR a spec's invokes[] (same WIP-coupling smell, the typed v18 edge).
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
      if (row.type === 'spec') {
        const spec = parseNamespaces(row.namespacesJson).spec as SpecBody | undefined;
        for (const iv of spec?.invokes ?? []) {
          const target = cardByKey.get(iv.to);
          if (target && target.status === 'draft') {
            warnings.push({
              type: 'rework-dependency',
              cardKey: row.key,
              message: `Active spec invokes draft spec "${iv.to}"`,
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
    // A spec realizes its OWN brief: every derives/case_of must reference the
    // spec's ancestor brief (walk the parent chain to the enclosing brief),
    // not a foreign one. A foreign derive is a mis-wired trace.
    const ancestorBrief = ((): string | null => {
      let cur: CardRow | undefined = row;
      const seen = new Set<string>();
      while (cur?.parent && !seen.has(cur.key)) {
        seen.add(cur.key);
        const p = cardByKey.get(cur.parent);
        if (!p) return null;
        if (p.type === 'brief') return p.key;
        cur = p;
      }
      return null;
    })();
    if (ancestorBrief) {
      const refs = [
        ...spec.preconditions.map((p) => p.derives),
        ...spec.postconditions.map((p) => p.derives),
        ...spec.failures.filter((f) => f.case_of != null).map((f) => f.case_of!),
      ];
      for (const ref of refs) {
        const bk = ref.split('#')[0];
        if (bk && bk !== ancestorBrief) {
          warnings.push({ type: 'foreign-derive', cardKey: row.key, message: `derives/case_of references brief "${bk}" but the spec's ancestor brief is "${ancestorBrief}"` });
        }
      }
    }
  }

  // Deck-wide v18 spec edges (invokes.to / SHP uniqueness / shape-ref /
  // failures.owner+references) — make the declared edges enforceable, not inert.
  const cardTypeByKey = new Map<string, CardType>();
  for (const row of dbRows) cardTypeByKey.set(row.key, row.type as CardType);
  const specNodes: SpecNode[] = [];
  for (const row of dbRows) {
    if (row.type !== 'spec') continue;
    const spec = parseNamespaces(row.namespacesJson).spec as SpecBody | undefined;
    if (spec) specNodes.push({ key: row.key, status: row.status, spec });
  }
  for (const issue of collectSpecCrossCardErrors(specNodes, cardTypeByKey)) {
    warnings.push({ type: issue.code, cardKey: issue.cardKey, message: issue.message });
  }

  // applies_to '*' deprecation (§10 Phase 3.2): non-gating warning until the
  // principle cards are narrowed to real keys/globs; later promoted to error.
  for (const row of dbRows) {
    if (row.type !== 'principle') continue;
    const principle = parseNamespaces(row.namespacesJson).principle as PrincipleBody | undefined;
    if (!principle) continue;
    // [§5] A classified principle (verify.class declared) treats '*' as a deliberate
    // universal scope, not lazy authoring — don't nudge it to narrow.
    if (principle.verify) continue;
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

  // Vision singleton: at most one vision card per project (CARD_MODEL_DESIGN §9.1).
  // Vision is the single project-direction root that scopes every domain by
  // derivation; a second vision would make that root ambiguous.
  const visionRows = dbRows.filter((r) => r.type === 'vision');
  if (visionRows.length > 1) {
    for (const row of visionRows) {
      warnings.push({
        type: 'vision-singleton',
        cardKey: row.key,
        message: `At most one vision card is allowed per project; found ${visionRows.length}`,
      });
    }
  }

  // Structural principle enforcement (§5 verify.class=structural): evaluate each
  // active structural principle's closed predicate over its applies_to scope.
  // blocking → gating warning; warning → non-gating; advisory → not emitted.
  const structuralRules: StructuralPrincipleRule[] = [];
  for (const row of dbRows) {
    if (row.type !== 'principle' || row.status !== 'active') continue;
    const principle = parseNamespaces(row.namespacesJson).principle as PrincipleBody | undefined;
    if (principle?.verify?.class !== 'structural' || !principle.verify.structural) continue;
    structuralRules.push({
      key: row.key,
      appliesTo: principle.applies_to,
      enforcement: principle.enforcement,
      predicate: principle.verify.structural,
      ...(principle.exemptions ? { exemptions: principle.exemptions.map((e) => e.target) } : {}),
    });
  }
  if (structuralRules.length > 0) {
    // Union of outgoing coupling edges per card: legacy relations[] +
    // cross_domain_dependencies + spec invokes — so a boundary principle is not
    // bypassable by expressing the dependency through a typed v18 edge.
    const forwardEdgesBySrc = new Map<string, string[]>();
    const addEdge = (src: string, dst: string): void => {
      const list = forwardEdgesBySrc.get(src) ?? [];
      list.push(dst);
      forwardEdgesBySrc.set(src, list);
    };
    for (const [src, rels] of relationsBySrc) {
      for (const r of rels) if (!r.isReverse) addEdge(src, r.dstCardKey);
    }
    for (const row of dbRows) {
      const ns = parseNamespaces(row.namespacesJson);
      const domain = ns.domain as DomainBody | undefined;
      for (const dep of domain?.cross_domain_dependencies ?? []) addEdge(row.key, dep.domain);
      const spec = ns.spec as SpecBody | undefined;
      for (const iv of spec?.invokes ?? []) addEdge(row.key, iv.to);
    }
    const nodes = dbRows.map((r) => ({ key: r.key, type: r.type as CardType, status: r.status, parent: r.parent ?? null }));
    for (const v of evaluateStructuralPrinciples(nodes, forwardEdgesBySrc, structuralRules)) {
      if (v.enforcement === 'advisory') continue;
      warnings.push({
        type: v.enforcement === 'blocking' ? 'principle-violation' : 'principle-violation-warning',
        cardKey: v.cardKey,
        message: v.message,
      });
    }
  }

  // Binding principle enforcement (§5 verify.class=binding): @spec is the only
  // code-binding mechanism (source-as-binding-sot), so a binding principle is
  // verified by the @spec evidence of the SPEC cards it governs — each governed
  // spec must have ≥1 code_link row.
  const bindingRules: BindingPrincipleRule[] = [];
  for (const row of dbRows) {
    if (row.type !== 'principle' || row.status !== 'active') continue;
    const principle = parseNamespaces(row.namespacesJson).principle as PrincipleBody | undefined;
    if (principle?.verify?.class !== 'binding') continue;
    bindingRules.push({
      key: row.key,
      appliesTo: principle.applies_to,
      enforcement: principle.enforcement,
      ...(principle.exemptions ? { exemptions: principle.exemptions.map((e) => e.target) } : {}),
    });
  }
  if (bindingRules.length > 0) {
    const hasBinding = new Set<string>();
    for (const link of ctx.codeLinkRepo.findAll()) hasBinding.add(link.cardKey);
    const bindingNodes = dbRows.map((r) => ({ key: r.key, type: r.type as CardType, status: r.status }));
    for (const v of evaluateBindingPrinciples(bindingNodes, hasBinding, bindingRules)) {
      if (v.enforcement === 'advisory') continue;
      warnings.push({
        type: v.enforcement === 'blocking' ? 'principle-violation' : 'principle-violation-warning',
        cardKey: v.cardKey,
        message: v.message,
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
      // Structured namespace drift (matters under --read-only, where the entry
      // sync is skipped). Compare with a key-order-independent canonical form so
      // YAML key reordering never false-positives — only a genuine body
      // divergence fires. (serializeNamespaces is bare JSON.stringify = insertion
      // order, so it alone is NOT canonical.)
      const fileNs = canonicalJson(parseNamespaces(serializeNamespaces(file.frontmatter)));
      const dbNs = canonicalJson(parseNamespaces(row.namespacesJson));
      if (fileNs !== dbNs) {
        warnings.push({
          type: 'content-mismatch',
          cardKey: row.key,
          message: `DB namespace body differs from file (re-sync needed)`,
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
