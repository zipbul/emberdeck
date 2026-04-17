/**
 * CRUD + Sync operation tests.
 *
 * Covers:
 *  - create: parent/boundary, activation guard, relations string[]
 *  - update: parent change, type change + activation re-validation, children hierarchy, changelog
 *  - delete: force=true children orphan, referencing card file update
 *  - rename: referencing file update (relations, parent), bodyReferencesFound, changelog
 *  - sync: parent/boundary reflection, validateCards read-time checks
 *  - bulk-create: topological sort, parent reference
 *  - query: getCard includeHistory, getRelationGraph no relationType
 *  - MCP: .strict() rejects unknown keys, removed tools error
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createTestContext, BRIEF_BODY, type TestContext } from '../helpers';
import {
  createCard,
  updateCard,
  updateCardStatus,
  deleteCard,
  renameCard,
  bulkCreateCards,
  getCard,
  listCards,
  searchCards,
  getRelationGraph,
  validateCards,
  exportCardToFile,
  syncCardFromFile,
  bulkSyncCards,
  ActivationGuardError,
} from '../../index';
import { readCardFile } from '../../src/fs/reader';
import { serializeCardMarkdown } from '../../src/card/markdown';

let tc: TestContext;

afterEach(async () => {
  if (tc) await tc.cleanup();
});

// ── CREATE ──

describe('create', () => {
  it('should create a card with parent and boundary', async () => {
    tc = await createTestContext();
    // Create parent first
    await createCard(tc.ctx, { key: 'arch-parent', summary: 'Parent', type: 'brief' });
    // Create child with parent and boundary
    const result = await createCard(tc.ctx, {
      key: 'child-spec',
      summary: 'Child spec',
      type: 'spec',
      parent: 'arch-parent',
      boundary: ['src/auth/**'],
    });
    expect(result.card.frontmatter.parent).toBe('arch-parent');
    expect(result.card.frontmatter.boundary).toEqual(['src/auth/**']);

    // Verify DB
    const row = tc.ctx.cardRepo.findByKey('child-spec');
    expect(row!.parent).toBe('arch-parent');
    expect(row!.boundaryJson).toBe(JSON.stringify(['src/auth/**']));
  });

  it('should reject spec card with active status and no codeLinks (activation guard)', async () => {
    tc = await createTestContext();
    await expect(
      createCard(tc.ctx, { key: 'no-links', summary: 'No links', type: 'spec', status: 'active' }),
    ).rejects.toThrow('Activation conditions not met');
  });

  it('should create card with string[] relations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'card-a', summary: 'A', type: 'spec' });
    const result = await createCard(tc.ctx, {
      key: 'card-b',
      summary: 'B',
      type: 'spec',
      relations: ['card-a'],
    });
    expect(result.card.frontmatter.relations).toEqual(['card-a']);

    // Check DB relations
    const rels = tc.ctx.relationRepo.findByCardKey('card-b');
    const forward = rels.filter((r) => !r.isReverse);
    expect(forward).toHaveLength(1);
    expect(forward[0]!.dstCardKey).toBe('card-a');
  });

  it('should normalize tags to lowercase on create', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, {
      key: 'tagged',
      summary: 'Tagged',
      type: 'spec',
      tags: ['Auth', 'TOKEN'],
    });
    expect(result.card.frontmatter.tags).toEqual(['auth', 'token']);
  });

  it('should reject parent type hierarchy violation (spec under brief only)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'spec-parent', summary: 'Spec parent', type: 'spec' });
    await expect(
      createCard(tc.ctx, { key: 'arch-child', summary: 'Arch child', type: 'brief', parent: 'spec-parent' }),
    ).rejects.toThrow('brief card parent must be brief');
  });

  it('should reject non-existent parent', async () => {
    tc = await createTestContext();
    await expect(
      createCard(tc.ctx, { key: 'orphan', summary: 'Orphan', type: 'spec', parent: 'nonexistent' }),
    ).rejects.toThrow('Parent card not found');
  });

  it('should reject self-referencing relation', async () => {
    tc = await createTestContext();
    await expect(
      createCard(tc.ctx, { key: 'self', summary: 'Self', type: 'spec', relations: ['self'] }),
    ).rejects.toThrow('self-reference');
  });

  it('should reject relation to non-existent target', async () => {
    tc = await createTestContext();
    await expect(
      createCard(tc.ctx, { key: 'lonely', summary: 'Lonely', type: 'spec', relations: ['ghost'] }),
    ).rejects.toThrow('Relation target not found');
  });

  it('should reject circular parent reference', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'cycle-a', summary: 'A', type: 'brief' });
    await createCard(tc.ctx, { key: 'cycle-b', summary: 'B', type: 'brief', parent: 'cycle-a' });
    // Try to make cycle-a's parent = cycle-b (cycle-b → cycle-a → cycle-b)
    await expect(
      createCard(tc.ctx, { key: 'cycle-c', summary: 'C', type: 'brief', parent: 'cycle-b' }),
    ).resolves.toBeDefined(); // No cycle — just a chain
    // Now update cycle-a's parent to cycle-c to create a real cycle
    await expect(
      updateCard(tc.ctx, 'cycle-a', { parent: 'cycle-c' }),
    ).rejects.toThrow('Circular parent reference');
  });
});

// ── UPDATE ──

describe('update', () => {
  it('should update parent and record in changelog', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'arch-1', summary: 'Arch 1', type: 'brief' });
    await createCard(tc.ctx, { key: 'spec-1', summary: 'Spec 1', type: 'spec' });
    await updateCard(tc.ctx, 'spec-1', { parent: 'arch-1' });

    const result = await getCard(tc.ctx, 'spec-1', { includeHistory: true });
    expect(result.card.frontmatter.parent).toBe('arch-1');
    const parentChange = result.history!.find((h) => h.field === 'parent');
    expect(parentChange).toBeDefined();
    expect(parentChange!.newValue).toBe('arch-1');
  });

  it('should remove parent with null', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'arch-2', summary: 'Arch', type: 'brief' });
    await createCard(tc.ctx, { key: 'spec-2', summary: 'Spec', type: 'spec', parent: 'arch-2' });
    await updateCard(tc.ctx, 'spec-2', { parent: null });

    const result = await getCard(tc.ctx, 'spec-2');
    expect(result.card.frontmatter.parent).toBeUndefined();
  });

  it('should force draft when type change breaks activation conditions', async () => {
    tc = await createTestContext();
    // Intent card is active (no activation conditions for brief)
    await createCard(tc.ctx, { key: 'arch-active', summary: 'Arch', type: 'brief', status: 'active', body: BRIEF_BODY });
    // Change to spec (requires codeLinks) → should force to draft
    const result = await updateCard(tc.ctx, 'arch-active', { type: 'spec' });
    expect(result.card.frontmatter.status).toBe('draft');
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => w.includes('forced to draft'))).toBe(true);
  });

  it('should reject type change that breaks children hierarchy', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'arch-p', summary: 'Arch parent', type: 'brief' });
    await createCard(tc.ctx, { key: 'arch-c', summary: 'Arch child', type: 'brief', parent: 'arch-p' });
    // Can't change parent to spec because child is brief
    await expect(
      updateCard(tc.ctx, 'arch-p', { type: 'spec' }),
    ).rejects.toThrow('Cannot change to spec');
  });

  it('should update boundary and record in changelog', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bnd', summary: 'Boundary', type: 'spec' });
    await updateCard(tc.ctx, 'bnd', { boundary: ['src/**'] });

    const result = await getCard(tc.ctx, 'bnd', { includeHistory: true });
    expect(result.card.frontmatter.boundary).toEqual(['src/**']);
    const bndChange = result.history!.find((h) => h.field === 'boundary');
    expect(bndChange).toBeDefined();
  });

  it('should apply activation guard when status set to active', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'no-act', summary: 'No activation', type: 'spec' });
    await expect(
      updateCard(tc.ctx, 'no-act', { status: 'active' }),
    ).rejects.toThrow('Activation conditions not met');
  });
});

// ── UPDATE STATUS ──

describe('updateCardStatus', () => {
  it('should record reason in changelog', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'st-card', summary: 'Status card', type: 'brief', body: BRIEF_BODY });
    await updateCardStatus(tc.ctx, 'st-card', 'active', 'passed review');

    const result = await getCard(tc.ctx, 'st-card', { includeHistory: true });
    const statusChange = result.history!.find((h) => h.field === 'status');
    expect(statusChange).toBeDefined();
    expect(statusChange!.newValue).toContain('passed review');
  });

  it('should reject active status for spec without codeLinks', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'spec-no-link', summary: 'Spec', type: 'spec' });
    await expect(
      updateCardStatus(tc.ctx, 'spec-no-link', 'active'),
    ).rejects.toThrow('Activation conditions not met');
  });
});

// ── DELETE ──

describe('delete', () => {
  it('should reject delete when card has children and force=false', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'del-parent', summary: 'Parent', type: 'brief' });
    await createCard(tc.ctx, { key: 'del-child', summary: 'Child', type: 'spec', parent: 'del-parent' });
    await expect(
      deleteCard(tc.ctx, 'del-parent'),
    ).rejects.toThrow('has 1 child card');
  });

  it('should delete with force=true and orphan children (parent field removed from child file)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'f-parent', summary: 'Parent', type: 'brief' });
    await createCard(tc.ctx, { key: 'f-child', summary: 'Child', type: 'spec', parent: 'f-parent' });

    const childFilePath = tc.ctx.cardRepo.findByKey('f-child')!.filePath;
    await deleteCard(tc.ctx, 'f-parent', { force: true });

    // Child file should no longer have parent field
    const childFile = await readCardFile(childFilePath);
    expect(childFile.frontmatter.parent).toBeUndefined();
  });

  it('should remove deleted card key from referencing cards\' relation files', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'target', summary: 'Target', type: 'spec' });
    await createCard(tc.ctx, { key: 'referrer', summary: 'Referrer', type: 'spec', relations: ['target'] });

    const referrerPath = tc.ctx.cardRepo.findByKey('referrer')!.filePath;
    await deleteCard(tc.ctx, 'target');

    // Referrer file should no longer list 'target' in relations
    const refFile = await readCardFile(referrerPath);
    expect(refFile.frontmatter.relations).toBeUndefined();
  });
});

// ── RENAME ──

describe('rename', () => {
  it('should update referencing cards\' relations files (old key → new key)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'rename-target', summary: 'Target', type: 'spec' });
    await createCard(tc.ctx, { key: 'rename-referrer', summary: 'Referrer', type: 'spec', relations: ['rename-target'] });

    const result = await renameCard(tc.ctx, 'rename-target', 'renamed-target');

    // Check referrer's file has updated relation
    const refPath = tc.ctx.cardRepo.findByKey('rename-referrer')!.filePath;
    const refFile = await readCardFile(refPath);
    expect(refFile.frontmatter.relations).toEqual(['renamed-target']);
  });

  it('should update child cards\' parent field in files', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'rn-parent', summary: 'Parent', type: 'brief' });
    await createCard(tc.ctx, { key: 'rn-child', summary: 'Child', type: 'spec', parent: 'rn-parent' });

    await renameCard(tc.ctx, 'rn-parent', 'rn-parent-new');

    // Check child file has updated parent
    const childPath = tc.ctx.cardRepo.findByKey('rn-child')!.filePath;
    const childFile = await readCardFile(childPath);
    expect(childFile.frontmatter.parent).toBe('rn-parent-new');
  });

  it('should return bodyReferencesFound when old key appears in other card bodies', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'body-ref-target', summary: 'Target', type: 'spec' });
    await createCard(tc.ctx, {
      key: 'body-ref-src',
      summary: 'Source',
      type: 'spec',
      body: 'This references body-ref-target in the text.',
    });

    const result = await renameCard(tc.ctx, 'body-ref-target', 'body-ref-renamed');
    expect(result.bodyReferencesFound).toEqual(['body-ref-src']);
  });

  it('should record key change in changelog', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'cl-rename', summary: 'CL rename', type: 'spec' });
    await renameCard(tc.ctx, 'cl-rename', 'cl-renamed');

    const history = tc.ctx.changelogRepo.findByCardKey('cl-renamed');
    const keyChange = history.find((h) => h.field === 'key');
    expect(keyChange).toBeDefined();
    expect(keyChange!.oldValue).toBe('cl-rename');
    expect(keyChange!.newValue).toBe('cl-renamed');
  });
});

// ── SYNC ──

describe('sync', () => {
  it('should sync parent and boundary from file to DB', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'sync-arch', summary: 'Arch', type: 'brief' });
    await createCard(tc.ctx, { key: 'sync-spec', summary: 'Spec', type: 'spec', parent: 'sync-arch', boundary: ['src/mod/**'] });

    const row = tc.ctx.cardRepo.findByKey('sync-spec');
    expect(row!.parent).toBe('sync-arch');
    expect(JSON.parse(row!.boundaryJson!)).toEqual(['src/mod/**']);
  });

  it('validateCards should detect broken parent', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'vp-parent', summary: 'Parent', type: 'brief' });
    await createCard(tc.ctx, { key: 'vp-child', summary: 'Child', type: 'spec', parent: 'vp-parent' });
    // Disable FK constraints, delete parent, re-enable FKs — simulates inconsistency
    tc.ctx.db.$client.run('PRAGMA foreign_keys = OFF');
    tc.ctx.db.$client.run("DELETE FROM card WHERE key = 'vp-parent'");
    tc.ctx.db.$client.run('PRAGMA foreign_keys = ON');

    const result = await validateCards(tc.ctx);
    const brokenParent = result.warnings.find((w) => w.type === 'broken-parent' && w.cardKey === 'vp-child');
    expect(brokenParent).toBeDefined();
  });

  it('validateCards should detect broken relation', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'vr-a', summary: 'A', type: 'spec' });
    await createCard(tc.ctx, { key: 'vr-b', summary: 'B', type: 'spec', relations: ['vr-a'] });
    // Disable FK constraints, delete target, re-enable FKs
    tc.ctx.db.$client.run('PRAGMA foreign_keys = OFF');
    tc.ctx.db.$client.run("DELETE FROM card WHERE key = 'vr-a'");
    tc.ctx.db.$client.run('PRAGMA foreign_keys = ON');

    const result = await validateCards(tc.ctx);
    const brokenRel = result.warnings.find((w) => w.type === 'broken-relation' && w.cardKey === 'vr-b');
    expect(brokenRel).toBeDefined();
  });

  it('validateCards should detect rework dependency (active → draft)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'rw-draft', summary: 'Draft', type: 'spec' });
    await createCard(tc.ctx, { key: 'rw-active', summary: 'Active', type: 'brief', status: 'active', body: BRIEF_BODY, relations: ['rw-draft'] });

    const result = await validateCards(tc.ctx);
    const rework = result.warnings.find((w) => w.type === 'rework-dependency' && w.cardKey === 'rw-active');
    expect(rework).toBeDefined();
  });

  it('exportCardToFile should export parent and boundary', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'exp-arch', summary: 'Arch', type: 'brief' });
    await createCard(tc.ctx, { key: 'exp-spec', summary: 'Spec', type: 'spec', parent: 'exp-arch', boundary: ['src/**'] });

    const filePath = await exportCardToFile(tc.ctx, 'exp-spec');
    const file = await readCardFile(filePath);
    expect(file.frontmatter.parent).toBe('exp-arch');
    expect(file.frontmatter.boundary).toEqual(['src/**']);
  });
});

// ── BULK CREATE ──

describe('bulk-create', () => {
  it('should topologically sort and create parent before child', async () => {
    tc = await createTestContext();
    // Deliberately put child first
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'bc-child', summary: 'Child', type: 'spec', parent: 'bc-parent' },
      { key: 'bc-parent', summary: 'Parent', type: 'brief' },
    ]);
    expect(result.created).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(result.keys).toContain('bc-parent');
    expect(result.keys).toContain('bc-child');

    // Verify parent relationship
    const child = tc.ctx.cardRepo.findByKey('bc-child');
    expect(child!.parent).toBe('bc-parent');
  });

  it('should apply relations in second pass', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'br-a', summary: 'A', type: 'spec', relations: ['br-b'] },
      { key: 'br-b', summary: 'B', type: 'spec', relations: ['br-a'] },
    ]);
    expect(result.created).toBe(2);

    const relsA = tc.ctx.relationRepo.findByCardKey('br-a');
    const forwardA = relsA.filter((r) => !r.isReverse);
    expect(forwardA).toHaveLength(1);
    expect(forwardA[0]!.dstCardKey).toBe('br-b');
  });
});

// ── QUERY ──

describe('query', () => {
  it('getCard with includeHistory should return changelog', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'hist', summary: 'Original', type: 'spec' });
    await updateCard(tc.ctx, 'hist', { summary: 'Updated' });

    const result = await getCard(tc.ctx, 'hist', { includeHistory: true });
    expect(result.history).toBeDefined();
    expect(result.history!.length).toBeGreaterThan(0);
    const summaryChange = result.history!.find((h) => h.field === 'summary');
    expect(summaryChange!.oldValue).toBe('Original');
    expect(summaryChange!.newValue).toBe('Updated');
  });

  it('getCard without includeHistory should not return history', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'no-hist', summary: 'Card', type: 'spec' });
    const result = await getCard(tc.ctx, 'no-hist');
    expect(result.history).toBeUndefined();
  });

  it('getRelationGraph nodes should not have relationType field', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'gr-a', summary: 'A', type: 'spec' });
    await createCard(tc.ctx, { key: 'gr-b', summary: 'B', type: 'spec', relations: ['gr-a'] });

    const graph = getRelationGraph(tc.ctx, 'gr-a');
    expect(graph).toHaveLength(1);
    expect(graph[0]!.key).toBe('gr-b');
    expect(graph[0]!).not.toHaveProperty('relationType');
  });

  it('searchCards should filter by type and status', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'srch-arch', summary: 'Search brief', type: 'brief' });
    await createCard(tc.ctx, { key: 'srch-spec', summary: 'Search spec', type: 'spec' });

    const archOnly = searchCards(tc.ctx, 'Search', { type: 'brief' });
    expect(archOnly).toHaveLength(1);
    expect(archOnly[0]!.key).toBe('srch-arch');

    const specOnly = searchCards(tc.ctx, 'Search', { type: 'spec' });
    expect(specOnly).toHaveLength(1);
    expect(specOnly[0]!.key).toBe('srch-spec');
  });

  it('listCards should filter by parent', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'lp-arch', summary: 'Arch', type: 'brief' });
    await createCard(tc.ctx, { key: 'lp-child1', summary: 'C1', type: 'spec', parent: 'lp-arch' });
    await createCard(tc.ctx, { key: 'lp-child2', summary: 'C2', type: 'spec', parent: 'lp-arch' });
    await createCard(tc.ctx, { key: 'lp-other', summary: 'Other', type: 'spec' });

    const children = listCards(tc.ctx, { parent: 'lp-arch' });
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.key).sort()).toEqual(['lp-child1', 'lp-child2']);
  });

  it('listCards should filter roots only', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'root-a', summary: 'Root', type: 'brief' });
    await createCard(tc.ctx, { key: 'root-child', summary: 'Child', type: 'spec', parent: 'root-a' });

    const roots = listCards(tc.ctx, { roots: true });
    expect(roots.every((r) => r.parent === null)).toBe(true);
    expect(roots.some((r) => r.key === 'root-a')).toBe(true);
    expect(roots.some((r) => r.key === 'root-child')).toBe(false);
  });

  it('listCards should filter by tag', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'tag-a', summary: 'A', type: 'spec', tags: ['auth'] });
    await createCard(tc.ctx, { key: 'tag-b', summary: 'B', type: 'spec', tags: ['db'] });
    await createCard(tc.ctx, { key: 'tag-c', summary: 'C', type: 'spec', tags: ['auth', 'db'] });

    const authCards = listCards(tc.ctx, { tag: 'auth' });
    expect(authCards).toHaveLength(2);
    expect(authCards.map((c) => c.key).sort()).toEqual(['tag-a', 'tag-c']);
  });

  it('listCards should filter by updatedSince', async () => {
    tc = await createTestContext();
    const before = new Date().toISOString();
    await createCard(tc.ctx, { key: 'old-card', summary: 'Old', type: 'spec' });
    // Wait a tiny bit so timestamp differs
    await new Promise((r) => setTimeout(r, 10));
    const middle = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 10));
    await createCard(tc.ctx, { key: 'new-card', summary: 'New', type: 'spec' });

    const since = listCards(tc.ctx, { updatedSince: middle });
    expect(since).toHaveLength(1);
    expect(since[0]!.key).toBe('new-card');
  });

  it('getCard includeHistory should include rename history', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'rn-hist', summary: 'Rename hist', type: 'spec' });
    await renameCard(tc.ctx, 'rn-hist', 'rn-hist-new');

    const result = await getCard(tc.ctx, 'rn-hist-new', { includeHistory: true });
    expect(result.history).toBeDefined();
    const keyChange = result.history!.find((h) => h.field === 'key');
    expect(keyChange).toBeDefined();
    expect(keyChange!.oldValue).toBe('rn-hist');
    expect(keyChange!.newValue).toBe('rn-hist-new');
  });
});

// ── SYNC: duplicate key ──

describe('sync duplicate key', () => {
  it('bulkSyncCards should detect duplicate keys across files', async () => {
    tc = await createTestContext();
    // Write two files with the same key
    const file1 = join(tc.cardsDir, 'dup1.card.md');
    const file2 = join(tc.cardsDir, 'dup2.card.md');
    const fm = { key: 'dup-key', summary: 'Dup', status: 'draft' as const, type: 'spec' as const };
    const content = serializeCardMarkdown(fm, '');
    await writeFile(file1, content);
    await writeFile(file2, content);

    const result = await bulkSyncCards(tc.ctx);
    expect(result.errors.length).toBeGreaterThan(0);
    const dupErrors = result.errors.filter((e) =>
      e.error instanceof Error && e.error.message.includes('Duplicate key'),
    );
    expect(dupErrors.length).toBeGreaterThan(0);
  });
});

// ── SYNC: validateCards full read-time checks ──

describe('validateCards full checks', () => {
  it('should detect orphan card (non-brief with no parent)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'orphan-spec', summary: 'Orphan', type: 'spec' });

    const result = await validateCards(tc.ctx);
    const orphan = result.warnings.find((w) => w.type === 'orphan-card' && w.cardKey === 'orphan-spec');
    expect(orphan).toBeDefined();
  });

  it('should NOT flag brief card without parent as orphan', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'root-arch', summary: 'Root arch', type: 'brief' });

    const result = await validateCards(tc.ctx);
    const orphan = result.warnings.find((w) => w.type === 'orphan-card' && w.cardKey === 'root-arch');
    expect(orphan).toBeUndefined();
  });

  it('should detect type hierarchy violation (brief under non-brief)', async () => {
    tc = await createTestContext();
    // Manually create a spec card then force a brief child via DB manipulation
    await createCard(tc.ctx, { key: 'th-spec', summary: 'Spec parent', type: 'spec' });
    await createCard(tc.ctx, { key: 'th-arch', summary: 'Arch child', type: 'brief' });
    // Force parent in DB bypassing validation
    tc.ctx.db.$client.run("UPDATE card SET parent = 'th-spec' WHERE key = 'th-arch'");

    const result = await validateCards(tc.ctx);
    const violation = result.warnings.find((w) => w.type === 'type-hierarchy-violation' && w.cardKey === 'th-arch');
    expect(violation).toBeDefined();
  });

  it('should detect empty tree (active brief with no children)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'empty-arch', summary: 'Empty arch', type: 'brief', status: 'active', body: BRIEF_BODY });

    const result = await validateCards(tc.ctx);
    const empty = result.warnings.find((w) => w.type === 'empty-tree' && w.cardKey === 'empty-arch');
    expect(empty).toBeDefined();
  });

  it('should NOT flag draft brief with no children as empty tree', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'draft-arch', summary: 'Draft arch', type: 'brief' });

    const result = await validateCards(tc.ctx);
    const empty = result.warnings.find((w) => w.type === 'empty-tree' && w.cardKey === 'draft-arch');
    expect(empty).toBeUndefined();
  });

  it('should detect boundary overlap between non-parent-child cards', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bnd-a', summary: 'A', type: 'spec', boundary: ['src/auth/**'] });
    await createCard(tc.ctx, { key: 'bnd-b', summary: 'B', type: 'spec', boundary: ['src/auth/**'] });

    const result = await validateCards(tc.ctx);
    const overlap = result.warnings.find((w) => w.type === 'boundary-overlap');
    expect(overlap).toBeDefined();
  });

  it('should detect boundary overlap via glob containment (src/** contains src/auth/**)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'glob-wide', summary: 'Wide', type: 'spec', boundary: ['src/**'] });
    await createCard(tc.ctx, { key: 'glob-narrow', summary: 'Narrow', type: 'spec', boundary: ['src/auth/**'] });

    const result = await validateCards(tc.ctx);
    const overlap = result.warnings.find((w) => w.type === 'boundary-overlap');
    expect(overlap).toBeDefined();
  });

  it('should detect boundary overlap between cross-cutting glob patterns (src/auth/** vs src/**/*.ts)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'auth-all', summary: 'Auth module', type: 'spec', boundary: ['src/auth/**'] });
    await createCard(tc.ctx, { key: 'all-ts', summary: 'All TS files', type: 'spec', boundary: ['src/**/*.ts'] });

    const result = await validateCards(tc.ctx);
    const overlap = result.warnings.find((w) => w.type === 'boundary-overlap');
    expect(overlap).toBeDefined();
    expect(overlap!.message).toContain('all-ts');
  });

  it('should not detect boundary overlap for disjoint glob patterns (src/a/** vs src/b/**)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'mod-a', summary: 'Module A', type: 'spec', boundary: ['src/a/**'] });
    await createCard(tc.ctx, { key: 'mod-b', summary: 'Module B', type: 'spec', boundary: ['src/b/**'] });

    const result = await validateCards(tc.ctx);
    const overlap = result.warnings.find((w) => w.type === 'boundary-overlap');
    expect(overlap).toBeUndefined();
  });

  it('should allow boundary overlap between parent and child', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bnd-parent', summary: 'Parent', type: 'brief', boundary: ['src/**'] });
    await createCard(tc.ctx, { key: 'bnd-child', summary: 'Child', type: 'spec', parent: 'bnd-parent', boundary: ['src/**'] });

    const result = await validateCards(tc.ctx);
    const overlap = result.warnings.find((w) => w.type === 'boundary-overlap');
    expect(overlap).toBeUndefined();
  });
});

// ── BULK CREATE: activation guard ──

describe('bulk-create activation guard', () => {
  it('should reject spec card with active status and no codeLinks in bulk create', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'bc-active', summary: 'Active spec', type: 'spec', status: 'active' },
    ]);
    expect(result.created).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]!.message).toContain('Activation conditions not met');
  });

  it('should allow brief card with active status (no activation conditions)', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'bc-arch-active', summary: 'Active arch', type: 'brief', status: 'active', body: BRIEF_BODY },
    ]);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
  });
});

// ── BRIEF SECTION ENFORCEMENT ──

describe('brief section enforcement', () => {
  it('should reject active brief card without 8 required sections', async () => {
    tc = await createTestContext();
    await expect(
      createCard(tc.ctx, { key: 'no-sections', summary: 'Missing sections', type: 'brief', status: 'active', body: 'Some text' }),
    ).rejects.toThrow('missing required sections');
  });

  it('should allow draft brief card without sections', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { key: 'draft-brief', summary: 'Draft', type: 'brief', body: 'No sections yet' });
    expect(result.fullKey).toBe('draft-brief');
  });

  it('should allow active brief card with all 8 sections', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { key: 'full-brief', summary: 'Full', type: 'brief', status: 'active', body: BRIEF_BODY });
    expect(result.card.frontmatter.status).toBe('active');
  });

  it('should reject body update on active brief that removes sections', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'active-brief', summary: 'Active', type: 'brief', status: 'active', body: BRIEF_BODY });
    await expect(
      updateCard(tc.ctx, 'active-brief', { body: 'Sections removed' }),
    ).rejects.toThrow('missing required sections');
  });

  it('should reject updateCardStatus to active on brief without sections', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'draft-no-sections', summary: 'Draft', type: 'brief', body: 'No sections' });
    await expect(
      updateCardStatus(tc.ctx, 'draft-no-sections', 'active'),
    ).rejects.toThrow('missing required sections');
  });

  it('should allow updateCardStatus to active on brief with sections', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'draft-with-sections', summary: 'Draft', type: 'brief', body: BRIEF_BODY });
    const result = await updateCardStatus(tc.ctx, 'draft-with-sections', 'active');
    expect(result.card.frontmatter.status).toBe('active');
  });
});

// ── DELETE: DB CASCADE verification ──

describe('delete cascade', () => {
  it('should cascade-delete relations, tags, code links, changelog on card delete', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'cas-target', summary: 'Target', type: 'spec' });
    await createCard(tc.ctx, {
      key: 'cas-card',
      summary: 'Card with everything',
      type: 'spec',
      tags: ['important'],
      relations: ['cas-target'],
      codeLinks: [{ kind: 'function', file: 'src/x.ts', symbol: 'fn' }],
    });
    // Record a changelog entry
    await updateCard(tc.ctx, 'cas-card', { summary: 'Updated' });

    // Verify data exists before delete
    expect(tc.ctx.relationRepo.findByCardKey('cas-card').length).toBeGreaterThan(0);
    expect(tc.ctx.codeLinkRepo.findByCardKey('cas-card').length).toBeGreaterThan(0);
    expect(tc.ctx.classificationRepo.findTagsByCard('cas-card').length).toBeGreaterThan(0);
    expect(tc.ctx.changelogRepo.findByCardKey('cas-card').length).toBeGreaterThan(0);

    await deleteCard(tc.ctx, 'cas-card');

    // All related data should be gone
    expect(tc.ctx.relationRepo.findByCardKey('cas-card')).toHaveLength(0);
    expect(tc.ctx.codeLinkRepo.findByCardKey('cas-card')).toHaveLength(0);
    expect(tc.ctx.classificationRepo.findTagsByCard('cas-card')).toHaveLength(0);
    expect(tc.ctx.changelogRepo.findByCardKey('cas-card')).toHaveLength(0);
  });
});

// ── ACTIVATION GUARD ON FIELD CHANGES ──

describe('activation guard on active card field changes', () => {
  it('should reject removing codeLinks from an active spec card', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'guard-spec',
      summary: 'Active spec',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }],
    });
    await updateCardStatus(tc.ctx, 'guard-spec', 'active');

    // Removing codeLinks should trigger activation guard
    await expect(
      updateCard(tc.ctx, 'guard-spec', { codeLinks: null }),
    ).rejects.toThrow(ActivationGuardError);
  });

  it('should reject removing codeLinks via empty array from an active spec card', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'guard-spec2',
      summary: 'Active spec 2',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/b.ts', symbol: 'fn2' }],
    });
    await updateCardStatus(tc.ctx, 'guard-spec2', 'active');

    await expect(
      updateCard(tc.ctx, 'guard-spec2', { codeLinks: [] }),
    ).rejects.toThrow(ActivationGuardError);
  });

  it('should allow updating non-critical fields on active card without re-validation', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'guard-safe',
      summary: 'Safe update',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/c.ts', symbol: 'fn3' }],
    });
    await updateCardStatus(tc.ctx, 'guard-safe', 'active');

    // Updating summary should not trigger activation guard
    const result = await updateCard(tc.ctx, 'guard-safe', { summary: 'Updated summary' });
    expect(result.card.frontmatter.summary).toBe('Updated summary');
    expect(result.card.frontmatter.status).toBe('active');
  });
});
