import { relative } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardRow, RelationRow } from '../db/repository';
import { parseFullKey } from '../card/card-key';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { CardNotFoundError } from '../card/errors';
import { buildSearchableText } from '../card/searchable-text';
import type { CardFile, CardFrontmatter, CardStatus, CardType } from '../card/types';

/**
 * Reverse of the body+namespace concatenation done at write-time
 * (syncCardFromFile / create / update). We store `body \n\n namespaceText`
 * in row.body to feed FTS5; on export we must strip the trailing namespace
 * text or the .card.md file gets corrupted (and grows on every round-trip).
 */
function stripNamespaceText(storedBody: string, fm: CardFrontmatter): string {
  const ns = buildSearchableText(fm);
  if (!ns) return storedBody;
  // Be permissive about the join whitespace: file round-trips can introduce/remove
  // a trailing newline before the namespace tail, so match anywhere it ends the body.
  const idx = storedBody.lastIndexOf(ns);
  if (idx >= 0 && idx + ns.length === storedBody.length) {
    return storedBody.slice(0, idx).replace(/\s+$/, '');
  }
  return storedBody;
}

/**
 * Serialize the principle/domain/brief/spec namespace blocks from frontmatter for DB storage.
 * Returns null when the card has no namespace structures (typical for plain markdown cards).
 */
function serializeNamespaces(fm: CardFrontmatter): string | null {
  const ns: Record<string, unknown> = {};
  if (fm.principle) ns.principle = fm.principle;
  if (fm.domain) ns.domain = fm.domain;
  if (fm.brief) ns.brief = fm.brief;
  if (fm.spec) ns.spec = fm.spec;
  return Object.keys(ns).length === 0 ? null : JSON.stringify(ns);
}

function parseNamespaces(json: string | null): { principle?: unknown; domain?: unknown; brief?: unknown; spec?: unknown } {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import { txDb } from '../db/connection';
import { readGlossary } from '../glossary/io';


import { parseStringArrayJson, parseCrossDomainDependencies } from '../card/json-fields';

export interface BulkSyncResult {
  synced: number;
  errors: Array<{ filePath: string; error: unknown }>;
}

export interface ValidationWarning {
  type: string;
  cardKey: string;
  message: string;
}

export interface CardValidationResult {
  staleDbRows: CardRow[];
  orphanFiles: string[];
  keyMismatches: Array<{ row: CardRow; expectedKey: string }>;
  warnings: ValidationWarning[];
}

/**
 * Syncs an externally modified card file to the DB.
 * Invoked by CLI sync commands (`ed sync`) and as the compensation step
 * for failed file writes in create/update operations.
 */
export async function syncCardFromFile(ctx: EmberdeckContext, filePath: string): Promise<void> {
  const cardFile = await readCardFile(filePath);
  const key = parseFullKey(cardFile.frontmatter.key);
  const now = new Date().toISOString();
  // (buildSearchableText imported below; cf. row.body assignment)

  // Concatenate markdown body + searchable namespace text so FTS5 matches namespace content.
  const namespaceText = buildSearchableText(cardFile.frontmatter);
  const fullBody = [cardFile.body, namespaceText].filter((s) => s.trim().length > 0).join('\n\n');

  const row: CardRow = {
    key,
    summary: cardFile.frontmatter.summary,
    status: cardFile.frontmatter.status,
    type: cardFile.frontmatter.type,
    parent: cardFile.frontmatter.parent ?? null,
    boundaryJson: cardFile.frontmatter.boundary
      ? JSON.stringify(cardFile.frontmatter.boundary)
      : null,
    namespacesJson: serializeNamespaces(cardFile.frontmatter),
    body: fullBody,
    glossaryJson: cardFile.frontmatter.glossary
      ? JSON.stringify(cardFile.frontmatter.glossary)
      : '[]',
    filePath,
    updatedAt: now,
  };

  ctx.db.transaction((tx) => {
    const d = txDb(tx);
    const cardRepo = new DrizzleCardRepository(d);
    const relationRepo = new DrizzleRelationRepository(d);
    const classRepo = new DrizzleClassificationRepository(d);
    const codeLinkRepo = new DrizzleCodeLinkRepository(d);

    cardRepo.upsert(row);
    relationRepo.replaceForCard(key, cardFile.frontmatter.relations ?? []);
    classRepo.replaceTags(key, cardFile.frontmatter.tags ?? []);
    codeLinkRepo.replaceForCard(key, cardFile.frontmatter.codeLinks ?? []);
  });
}

/**
 * Scans the entire cardsDir (or dirPath) and bulk-syncs all .card.md files to the DB.
 *
 * Detects duplicate keys across files and reports them as errors (data loss prevention).
 * File reads are executed in parallel via `Promise.allSettled` to minimize I/O wait time.
 * Each file's DB write is atomic, guaranteed by the transaction inside `syncCardFromFile`.
 */
export async function bulkSyncCards(
  ctx: EmberdeckContext,
  dirPath?: string,
): Promise<BulkSyncResult> {
  const targetDir = dirPath ?? ctx.cardsDir;
  const glob = new Bun.Glob('**/*.card.md');
  const cardFiles: string[] = [];
  for await (const file of glob.scan({ cwd: targetDir, absolute: true })) {
    cardFiles.push(file);
  }

  // Detect duplicate keys.
  // Parallelize file reads in batches — sequential await on N files becomes the
  // bottleneck for large card collections (jsdoc above mentioned parallelism but
  // this loop was actually serial).
  const keyToFile = new Map<string, string>();
  const duplicates = new Map<string, string[]>();
  const errors: BulkSyncResult['errors'] = [];
  const READ_BATCH_SIZE = 20;

  for (let i = 0; i < cardFiles.length; i += READ_BATCH_SIZE) {
    const batch = cardFiles.slice(i, i + READ_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((filePath) => readCardFile(filePath)),
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j]!;
      const filePath = batch[j]!;
      if (result.status === 'rejected') {
        errors.push({ filePath, error: result.reason });
        continue;
      }
      const key = result.value.frontmatter.key;
      if (keyToFile.has(key)) {
        const existing = duplicates.get(key) ?? [keyToFile.get(key)!];
        existing.push(filePath);
        duplicates.set(key, existing);
      } else {
        keyToFile.set(key, filePath);
      }
    }
  }

  // Report duplicates as errors
  for (const [key, files] of duplicates) {
    for (const filePath of files) {
      errors.push({
        filePath,
        error: new Error(`Duplicate key "${key}" found in multiple files: ${files.join(', ')}`),
      });
    }
  }

  // Only sync non-duplicate files
  const duplicateFiles = new Set<string>();
  for (const files of duplicates.values()) {
    for (const f of files) duplicateFiles.add(f);
  }

  let synced = 0;
  const BATCH_SIZE = 20;
  const safeFiles = cardFiles.filter((f) => !duplicateFiles.has(f));

  for (let i = 0; i < safeFiles.length; i += BATCH_SIZE) {
    const batch = safeFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((filePath) => syncCardFromFile(ctx, filePath)),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j]!;
      if (result.status === 'fulfilled') {
        synced++;
      } else {
        errors.push({ filePath: batch[j]!, error: result.reason });
      }
    }
  }

  return { synced, errors };
}

/**
 * Generate synthetic sample paths from a glob pattern for overlap testing.
 * Since Bun.Glob.match expects a concrete path (not another pattern),
 * we create plausible paths that would match the pattern and cross-test them.
 */
function generateSamplePaths(pattern: string): string[] {
  const samples = new Set<string>();

  const defaultExts = ['.ts', '.js', '.tsx', '.json'];

  // Extract extension constraint from pattern (e.g. *.ts -> .ts)
  const extMatch = pattern.match(/\*\.([a-zA-Z0-9]+)$/);
  const patternExt = extMatch ? '.' + extMatch[1] : null;
  const extensions = patternExt ? [patternExt] : defaultExts;

  // Get the static (non-glob) prefix
  const segments = pattern.split('/');
  const prefixParts: string[] = [];
  for (const seg of segments) {
    if (seg.includes('*') || seg.includes('?') || seg.includes('[') || seg.includes('{')) break;
    prefixParts.push(seg);
  }
  const prefix = prefixParts.join('/');

  const depths = ['', 'd1/', 'd1/d2/', 'd1/d2/d3/'];

  for (const ext of extensions) {
    for (const depth of depths) {
      let p = pattern;
      p = p.replace(/\*\*\//g, depth);
      p = p.replace(/\*\*/g, depth ? depth.slice(0, -1) : 'x');
      p = p.replace(/\*\.([a-zA-Z0-9]+)/g, 'sample.$1');
      p = p.replace(/\*/g, 'sample');
      p = p.replace(/\/\//g, '/').replace(/\/$/, '');

      if (p) samples.add(p);

      // For patterns ending with **, append concrete file names
      if (pattern.endsWith('**') || pattern.endsWith('**/')) {
        const withExt = p + (p.endsWith('/') ? '' : '/') + 'file' + ext;
        samples.add(withExt.replace(/\/\//g, '/'));
        if (p && !p.includes('.')) {
          samples.add(p + ext);
        }
      }
    }
  }

  // Add depth-varied samples under the prefix for ** patterns
  if (prefix && pattern.includes('**')) {
    for (const ext of extensions) {
      samples.add(prefix + '/file' + ext);
      samples.add(prefix + '/sub/file' + ext);
      samples.add(prefix + '/sub/deep/file' + ext);
    }
  }

  return [...samples];
}

/**
 * Check whether two glob patterns potentially overlap (i.e., a path could exist
 * that matches both). Uses sample-based heuristic: generates concrete paths from
 * each pattern and tests them against the other.
 */
function globPatternsOverlap(pa: string, pb: string): boolean {
  const samplesA = generateSamplePaths(pa);
  const samplesB = generateSamplePaths(pb);

  const globA = new Bun.Glob(pa);
  const globB = new Bun.Glob(pb);

  for (const s of samplesA) {
    if (globB.match(s)) return true;
  }
  for (const s of samplesB) {
    if (globA.match(s)) return true;
  }

  return false;
}

/**
 * Validates consistency between the file list in cardsDir (or dirPath) and DB rows.
 * Performs read-only structural validation including hierarchy, relations, and boundary checks.
 */
export async function validateCards(
  ctx: EmberdeckContext,
  dirPath?: string,
): Promise<CardValidationResult> {
  const targetDir = dirPath ?? ctx.cardsDir;
  const glob = new Bun.Glob('**/*.card.md');
  const cardFiles: string[] = [];
  for await (const file of glob.scan({ cwd: targetDir, absolute: true })) {
    cardFiles.push(file);
  }

  const fileSet = new Set(cardFiles);
  const dbRows = ctx.cardRepo.list();
  const dbFilePaths = new Set(dbRows.map((r) => r.filePath));

  const staleDbRows = dbRows.filter((r) => !fileSet.has(r.filePath));
  const orphanFiles = cardFiles.filter((f) => !dbFilePaths.has(f));
  const keyMismatches = dbRows
    .map((r) => {
      const expectedKey = relative(targetDir, r.filePath).replace(/\.card\.md$/, '');
      return expectedKey !== r.key ? { row: r, expectedKey } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const warnings: ValidationWarning[] = [];

  // Build lookup maps
  const cardByKey = new Map<string, CardRow>();
  for (const row of dbRows) {
    cardByKey.set(row.key, row);
  }

  // Pre-load all relations once to defeat the N+1 findByCardKey loop below.
  const relationsBySrc = new Map<string, RelationRow[]>();
  for (const rel of ctx.relationRepo.findAll()) {
    const list = relationsBySrc.get(rel.srcCardKey) ?? [];
    list.push(rel);
    relationsBySrc.set(rel.srcCardKey, list);
  }

  for (const row of dbRows) {
    // Orphan card: only principle and domain are root-allowed.
    // brief/spec require a parent (brief → domain, spec → brief|spec).
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
    // 4-tier: principle/domain root, brief.parent=domain, spec.parent=brief|spec.
    if (row.parent && cardByKey.has(row.parent)) {
      const parent = cardByKey.get(row.parent)!;
      if (row.type === 'principle') {
        warnings.push({
          type: 'type-hierarchy-violation',
          cardKey: row.key,
          message: `Principle card must be root-level, but has parent "${row.parent}"`,
        });
      } else if (row.type === 'domain') {
        warnings.push({
          type: 'type-hierarchy-violation',
          cardKey: row.key,
          message: `Domain card must be root-level, but has parent "${row.parent}"`,
        });
      } else if (row.type === 'brief' && parent.type !== 'domain') {
        warnings.push({
          type: 'type-hierarchy-violation',
          cardKey: row.key,
          message: `Brief card parent must be domain, got "${row.parent}" (type: ${parent.type})`,
        });
      } else if (row.type === 'spec' && parent.type !== 'brief' && parent.type !== 'spec') {
        warnings.push({
          type: 'type-hierarchy-violation',
          cardKey: row.key,
          message: `Spec card parent must be brief or spec, got "${row.parent}" (type: ${parent.type})`,
        });
      }
    }

    // Broken cross_domain_dependencies (domain-only): every dep target must
    // exist AND be type=domain. Activation guard catches this on activate, but
    // we surface it here too so that a dangling dep after rename/delete is
    // visible without waiting for the next activation.
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

  // Empty tree: brief or domain card with no children (skip draft).
  // Pre-build parent → has-children index to avoid full-scan inside the loop
  // (was O(N×M) — N briefs × M total).
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

  // Boundary overlap: two cards with overlapping boundaries (parent-child allowed)
  // Detects overlaps by checking if any pattern from one card matches any pattern from the other
  // (glob A matches path B, or glob B matches path A, or identical patterns).
  const cardsWithBoundary = dbRows.filter((r) => r.boundaryJson);
  for (let i = 0; i < cardsWithBoundary.length; i++) {
    for (let j = i + 1; j < cardsWithBoundary.length; j++) {
      const a = cardsWithBoundary[i]!;
      const b = cardsWithBoundary[j]!;

      // Skip parent-child pairs
      if (a.parent === b.key || b.parent === a.key) continue;

      const aBoundary = parseStringArrayJson(a.boundaryJson);
      const bBoundary = parseStringArrayJson(b.boundaryJson);
      if (aBoundary.length === 0 || bBoundary.length === 0) continue;

      const overlapping: string[] = [];
      for (const pa of aBoundary) {
        for (const pb of bBoundary) {
          if (pa === pb) {
            overlapping.push(pa);
          } else {
            try {
              if (globPatternsOverlap(pa, pb)) {
                overlapping.push(`${pa} ∩ ${pb}`);
              }
            } catch {
              // Invalid glob — skip
            }
          }
        }
      }

      if (overlapping.length > 0) {
        warnings.push({
          type: 'boundary-overlap',
          cardKey: a.key,
          message: `Boundary overlaps with "${b.key}": ${overlapping.join(', ')}`,
        });
      }
    }
  }

  // Content mismatch: DB and file frontmatter diverged
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
      // File unreadable — already caught by orphanFiles or staleDbRows
    }
  }

  // Glossary cross-validation
  const glossaryEntries = readGlossary(ctx);
  const glossaryWordSet = new Set(glossaryEntries.map((e) => e.word));
  const usedGlossaryWords = new Set<string>();

  for (const row of dbRows) {
    const cardGlossary = parseStringArrayJson(row.glossaryJson);
    if (cardGlossary.length > 0) {
      // Track usage for unused detection
      for (const w of cardGlossary) usedGlossaryWords.add(w);

      // Check each declared word exists in glossary
      for (const word of cardGlossary) {
        if (!glossaryWordSet.has(word)) {
          warnings.push({
            type: 'glossary-broken',
            cardKey: row.key,
            message: `Glossary word "${word}" not found in glossary.yaml`,
          });
        }
      }

      // Content-mismatch for glossary: DB vs file
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

  // Unused glossary entries
  for (const entry of glossaryEntries) {
    if (!usedGlossaryWords.has(entry.word)) {
      warnings.push({
        type: 'glossary-unused',
        cardKey: '',
        message: `Glossary word "${entry.word}" is not referenced by any card`,
      });
    }
  }

  // Broken chain: spec card with no relation to any brief card.
  // Reuses the relationsBySrc prefetch built above (no extra DB round-trips).
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
      // Also consider parent chain: if parent is brief, chain is intact
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

/**
 * Regenerates a card file from the DB state (reverse sync).
 * DB row + relations + tags + codeLinks -> constructs frontmatter -> Bun.write.
 * @returns Absolute path of the written file.
 */
/**
 * Build a CardFile from the DB row + auxiliary tables. Pure — does NOT touch the filesystem.
 * Used by both exportCardToFile (which writes to disk) and CLI `card export` (which renders to STDOUT).
 */
export function buildCardFromDb(ctx: EmberdeckContext, fullKey: string): CardFile {
  const key = parseFullKey(fullKey);
  const row = ctx.cardRepo.findByKey(key);
  if (!row) throw new CardNotFoundError(key);

  const relations = ctx.relationRepo
    .findByCardKey(key)
    .filter((r) => !r.isReverse)
    .map((r) => r.dstCardKey);

  const tags = ctx.classificationRepo.findTagsByCard(key);
  const codeLinks = ctx.codeLinkRepo
    .findByCardKey(key)
    .map((r) => ({ kind: r.kind, file: r.file, symbol: r.symbol }));

  const glossary = parseStringArrayJson(row.glossaryJson);

  const ns = parseNamespaces(row.namespacesJson);
  const fm: CardFrontmatter = {
    key: row.key,
    summary: row.summary,
    status: row.status as CardStatus,
    type: row.type as CardType,
    ...(row.parent ? { parent: row.parent } : {}),
    ...((() => { const b = parseStringArrayJson(row.boundaryJson); return b.length > 0 ? { boundary: b } : {}; })()),
    ...(relations.length ? { relations } : {}),
    ...(tags.length ? { tags } : {}),
    ...(codeLinks.length ? { codeLinks } : {}),
    ...(glossary.length > 0 ? { glossary } : {}),
    ...(ns.principle ? { principle: ns.principle as CardFrontmatter['principle'] } : {}),
    ...(ns.domain ? { domain: ns.domain as CardFrontmatter['domain'] } : {}),
    ...(ns.brief ? { brief: ns.brief as CardFrontmatter['brief'] } : {}),
    ...(ns.spec ? { spec: ns.spec as CardFrontmatter['spec'] } : {}),
  };

  const cleanBody = stripNamespaceText(row.body ?? '', fm);
  return { frontmatter: fm, body: cleanBody, filePath: row.filePath };
}

export async function exportCardToFile(ctx: EmberdeckContext, fullKey: string): Promise<string> {
  const cardFile = buildCardFromDb(ctx, fullKey);
  await writeCardFile(cardFile.filePath!, cardFile);
  return cardFile.filePath!;
}

/**
 * Removes a card from the DB when its file has been externally deleted.
 * Invoked by CLI sync commands when a tracked card file is missing.
 */
export function removeCardByFile(ctx: EmberdeckContext, filePath: string): void {
  const existing = ctx.cardRepo.findByFilePath(filePath);
  if (existing) {
    ctx.cardRepo.deleteByKey(existing.key);
    ctx.classificationRepo.pruneOrphans();
  }
}
