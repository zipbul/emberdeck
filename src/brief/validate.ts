/**
 * Brief validation module.
 *
 * Validates brief card bodies against the 8 required brief sections,
 * with L1 (structural) and L2 (lexical/INCOSE-based) quality checks.
 */

import type { EmberdeckContext } from '../config';

// ── Required Sections ──────────────────────────────────────────────

/**
 * The 8 universal brief sections derived from cross-format analysis
 * (IEEE SRS, Google Design Doc, RFC, PRD, BMC, Service Blueprint)
 * + domain gap analysis across 6 domains.
 */
export const REQUIRED_BRIEF_SECTIONS = [
  'motivation',
  'scope',
  'scenario',
  'rule',
  'constraint',
  'risk',
  'criteria',
  'decision',
] as const;

export type BriefSection = (typeof REQUIRED_BRIEF_SECTIONS)[number];

// ── L2: Ambiguous Terms (INCOSE-based) ─────────────────────────────

/**
 * Terms that indicate weak or ambiguous requirements.
 * Based on INCOSE 42 Rules (R7 vague, R8 escape, R9 open-ended, R34 unmeasurable).
 */
export const AMBIGUOUS_TERMS = [
  // INCOSE R7: Vague terms
  'some', 'several', 'many', 'few', 'adequate', 'sufficient',
  'reasonable', 'appropriate', 'normal', 'typical',
  // INCOSE R8: Escape clauses
  'where possible', 'as appropriate', 'if practical',
  'as needed', 'when necessary',
  // INCOSE R9: Open-ended clauses
  'etc', 'and so on', 'such as', 'including but not limited to',
  // INCOSE R34: Unmeasurable performance
  'fast', 'user-friendly', 'easy', 'intuitive', 'robust',
  'flexible', 'scalable', 'efficient',
] as const;

/**
 * L1 placeholder patterns that indicate stub content.
 */
const PLACEHOLDER_PATTERNS = [
  /^\s*tbd\s*$/i,
  /^\s*todo\s*$/i,
  /^\s*fixme\s*$/i,
  /^\s*tbc\s*$/i,
  /^\s*n\/a\s*$/i,
  /^\s*\.{3}\s*$/,
  /^\s*-\s*$/,
];

// ── Section Parsing ────────────────────────────────────────────────

interface ParsedSection {
  heading: string;
  normalizedName: string;
  body: string;
  lineNumber: number;
}

/**
 * Parse `## ` headings from markdown body and extract section name + content.
 */
export function parseSections(body: string): ParsedSection[] {
  const lines = body.split('\n');
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  const bodyLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headingMatch = line.match(/^##\s+(.+)$/);

    if (headingMatch) {
      // Flush previous section
      if (current) {
        current.body = bodyLines.join('\n').trim();
        sections.push(current);
        bodyLines.length = 0;
      }

      const heading = headingMatch[1]!.trim();
      current = {
        heading,
        normalizedName: heading.toLowerCase().replace(/[^a-z0-9]/g, ''),
        body: '',
        lineNumber: i + 1,
      };
    } else if (current) {
      bodyLines.push(line);
    }
  }

  // Flush last section
  if (current) {
    current.body = bodyLines.join('\n').trim();
    sections.push(current);
  }

  return sections;
}

// ── Quality Checks ─────────────────────────────────────────────────

type SectionStatus = 'ok' | 'error' | 'warning';

interface SectionResult {
  cardKey: string;
  heading: string;
  status: SectionStatus;
  errors: string[];
  warnings: string[];
}

/**
 * Count content units in text. A content unit is a sentence or a list item.
 * This avoids penalizing list-heavy sections (e.g., Scope with bullet points).
 */
function countContentUnits(text: string): number {
  // Count list items (lines starting with - * + or numbered)
  const listItems = (text.match(/^\s*[-*+]\s+.+/gm) ?? []).length
    + (text.match(/^\s*\d+[.)]\s+.+/gm) ?? []).length;

  // Strip markdown formatting for sentence counting
  const cleaned = text
    .replace(/^#{1,6}\s+.*$/gm, '') // sub-headings
    .replace(/^```[\s\S]*?^```/gm, '') // code blocks
    .replace(/^\s*[-*+]\s+.*$/gm, '') // list items (already counted)
    .replace(/^\s*\d+[.)]\s+.*$/gm, '') // numbered items (already counted)
    .trim();

  // Count sentences in remaining prose
  let sentences = 0;
  if (cleaned) {
    sentences = cleaned.split(/[.!?。]\s+|[.!?。]$/).filter((s) => s.trim().length > 0).length;
  }

  return listItems + sentences;
}

/**
 * L1: Structural quality checks.
 * Returns errors (hard failures).
 */
function checkL1(sectionBody: string): string[] {
  const errors: string[] = [];

  if (!sectionBody || sectionBody.trim().length === 0) {
    errors.push('Section body is empty');
    return errors;
  }

  // Check for placeholder-only content
  const trimmed = sectionBody.trim();
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(trimmed)) {
      errors.push(`Section contains only placeholder: "${trimmed}"`);
      return errors;
    }
  }

  // Check minimum content units (sentences + list items)
  if (countContentUnits(sectionBody) < 2) {
    errors.push('Section has fewer than 2 content units (sentences or list items) — likely a stub');
  }

  return errors;
}

/**
 * L2: Lexical quality checks (INCOSE-based).
 * Returns warnings (soft signals).
 */
function checkL2(sectionBody: string): string[] {
  const warnings: string[] = [];
  const lowerBody = sectionBody.toLowerCase();

  for (const term of AMBIGUOUS_TERMS) {
    // Word boundary match to avoid false positives (e.g., "some" in "someone")
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(lowerBody)) {
      // Find which INCOSE rule this belongs to
      const rule = getINCOSERule(term);
      warnings.push(`Ambiguous term "${term}" (${rule})`);
    }
  }

  return warnings;
}

function getINCOSERule(term: string): string {
  const lower = term.toLowerCase();
  const vagueTerms = ['some', 'several', 'many', 'few', 'adequate', 'sufficient', 'reasonable', 'appropriate', 'normal', 'typical'];
  const escapeClauses = ['where possible', 'as appropriate', 'if practical', 'as needed', 'when necessary'];
  const openEnded = ['etc', 'and so on', 'such as', 'including but not limited to'];

  if (vagueTerms.includes(lower)) return 'INCOSE R7: vague term';
  if (escapeClauses.includes(lower)) return 'INCOSE R8: escape clause';
  if (openEnded.includes(lower)) return 'INCOSE R9: open-ended clause';
  return 'INCOSE R34: unmeasurable performance';
}

// ── Main Validation ────────────────────────────────────────────────

export interface BriefValidationResult {
  complete: boolean;
  present: string[];
  missing: string[];
  sections: Record<string, SectionResult>;
  qualityErrors: number;
  qualityWarnings: number;
}

/**
 * Validate a brief card (and its descendant briefs) for completeness.
 *
 * 1. Reads the target card + descendant brief cards (BFS via parent-child).
 * 2. Parses ## headings from all bodies.
 * 3. Checks required sections against REQUIRED_BRIEF_SECTIONS.
 * 4. Runs L1 + L2 quality checks on each section.
 */
export function validateBrief(
  ctx: EmberdeckContext,
  cardKey: string,
): BriefValidationResult {
  // Collect the target card + all descendant brief cards
  const targetCard = ctx.cardRepo.findByKey(cardKey);
  if (!targetCard) {
    throw new Error(`Card not found: "${cardKey}"`);
  }
  if (targetCard.type !== 'brief') {
    throw new Error(`Card "${cardKey}" is type "${targetCard.type}", expected "brief"`);
  }

  // BFS to find all descendant brief cards
  const cardsToCheck: Array<{ key: string; body: string }> = [];
  const queue = [cardKey];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const card = ctx.cardRepo.findByKey(current);
    if (!card) continue;
    if (card.type !== 'brief') continue;

    cardsToCheck.push({ key: card.key, body: card.body ?? '' });

    // Find children
    const children = ctx.cardRepo.findChildren(current);
    for (const child of children) {
      if (child.type === 'brief' && !visited.has(child.key)) {
        queue.push(child.key);
      }
    }
  }

  // Parse sections from all collected cards
  const allSections: Array<ParsedSection & { cardKey: string }> = [];
  for (const card of cardsToCheck) {
    const sections = parseSections(card.body);
    for (const section of sections) {
      allSections.push({ ...section, cardKey: card.key });
    }
  }

  // Match against required sections (case-insensitive)
  const sectionResults: Record<string, SectionResult> = {};
  const present: string[] = [];
  const missing: string[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const required of REQUIRED_BRIEF_SECTIONS) {
    const match = allSections.find(
      (s) => s.normalizedName === required,
    );

    if (!match) {
      missing.push(required);
      continue;
    }

    present.push(required);

    // Run quality checks
    const errors = checkL1(match.body);
    const warnings = checkL2(match.body);

    const status: SectionStatus =
      errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok';

    totalErrors += errors.length;
    totalWarnings += warnings.length;

    sectionResults[required] = {
      cardKey: match.cardKey,
      heading: `## ${match.heading}`,
      status,
      errors,
      warnings,
    };
  }

  return {
    complete: missing.length === 0 && totalErrors === 0,
    present,
    missing,
    sections: sectionResults,
    qualityErrors: totalErrors,
    qualityWarnings: totalWarnings,
  };
}

// ── Inline Validation (for create/update pipeline) ────────────────

/**
 * Validate that a brief card body contains all 8 required sections.
 * Lightweight check for use in createCard/updateCard — no DB context needed.
 *
 * @param body - Markdown body of the brief card.
 * @throws {Error} When required sections are missing.
  * @spec card-lifecycle/activation-guard
 */
export function validateBriefSections(body: string): void {
  const sections = parseSections(body);
  const presentNames = new Set(sections.map((s) => s.normalizedName));
  const missing = REQUIRED_BRIEF_SECTIONS.filter((s) => !presentNames.has(s));

  if (missing.length > 0) {
    throw new Error(
      `Brief card body is missing required sections: ${missing.join(', ')}`,
    );
  }
}

// ── Spec Section Validation ───────────────────────────────────────

/**
 * The 3 required spec sections:
 * - contract: behavioral guarantees (GIVEN/WHEN/THEN)
 * - invariant: conditions that always hold
 * - failure: violation → system behavior mapping
 */
export const REQUIRED_SPEC_SECTIONS = [
  'contract',
  'invariant',
  'failure',
] as const;

export type SpecSection = (typeof REQUIRED_SPEC_SECTIONS)[number];

/**
 * Validate that a spec card body contains all 3 required sections.
 * Lightweight check for use in createCard/updateCard — no DB context needed.
 *
 * @param body - Markdown body of the spec card.
 * @throws {Error} When required sections are missing.
  * @spec card-lifecycle/activation-guard
 */
export function validateSpecSections(body: string): void {
  const sections = parseSections(body);
  const presentNames = new Set(sections.map((s) => s.normalizedName));
  const missing = REQUIRED_SPEC_SECTIONS.filter((s) => !presentNames.has(s));

  if (missing.length > 0) {
    throw new Error(
      `Spec card body is missing required sections: ${missing.join(', ')}`,
    );
  }
}
