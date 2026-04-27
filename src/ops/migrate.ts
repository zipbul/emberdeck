/**
 * Card migration: legacy markdown body → structured `brief:` namespace.
 *
 * DRY-RUN: This module never writes to disk. It only computes the proposed
 * `BriefBody` (and warnings/unmapped sections) so the caller can review and
 * apply the change manually.
 */

import type { EmberdeckContext } from '../config';
import type {
  BriefAssumption,
  BriefBody,
  BriefCriterion,
  BriefExternal,
  BriefFlow,
  BriefGoal,
  BriefLimit,
  BriefNonGoal,
  BriefPolicy,
  CardFile,
} from '../card/types';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError, CardValidationError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { parseSections, type ParsedSection } from '../brief/validate';
import { validateBriefRefs } from '../brief/validate-refs';

export interface MigrateCardOptions {
  cardKey: string;
  /** Auto-fill cross-refs heuristically (covers/governs/verifies). Default: false */
  autoLinkRefs?: boolean;
}

export interface MigrateCardResult {
  cardKey: string;
  filePath: string;
  /** The original markdown body that was parsed. */
  beforeBody: string;
  /** The proposed brief namespace body. */
  newBriefBody: BriefBody;
  /** Section headings encountered in the body that did not map to any brief field. */
  unmappedSections: string[];
  /** Soft warnings about heuristic decisions or missing data. */
  warnings: string[];
  /** Whether validateBriefRefs would pass on `newBriefBody`. */
  validationStatus: string;
}

const RECOGNIZED_SECTIONS = new Set([
  'motivation',
  'scope',
  'scenario',
  'rule',
  'constraint',
  'risk',
  'criteria',
  'decision',
]);

// ── Helpers ────────────────────────────────────────────────────────

function padId(prefix: string, n: number, width = 3): string {
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

function splitBullets(body: string): string[] {
  // Extract bullet items (`- ...`, `* ...`, `+ ...`).
  // Multi-line bullets (continuation indent) are joined.
  const lines = body.split('\n');
  const items: string[] = [];
  let current: string | null = null;
  for (const raw of lines) {
    const m = raw.match(/^\s*[-*+]\s+(.*)$/);
    if (m) {
      if (current !== null) items.push(current.trim());
      current = m[1] ?? '';
    } else if (current !== null) {
      // Continuation: indented or blank-then-text. Append non-empty trimmed.
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        current += ' ' + trimmed;
      } else {
        items.push(current.trim());
        current = null;
      }
    }
  }
  if (current !== null) items.push(current.trim());
  return items.filter((s) => s.length > 0);
}

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function findSection(
  sections: ParsedSection[],
  normalized: string,
): ParsedSection | undefined {
  return sections.find((s) => s.normalizedName === normalized);
}

function findSubBlock(body: string, label: string): string | null {
  // Look for "Covers:", "Excludes:", "Assumes:" style sub-labels.
  // Returns text following the label up to the next label or end.
  const labelRe = new RegExp(`(?:^|\\n)\\s*(?:[-*+]\\s+)?\\*?\\*?(${escapeReg(label)})\\*?\\*?\\s*[:：]\\s*`, 'i');
  const m = labelRe.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Stop at next sub-label of common kind
  const stopRe = /\n\s*(?:[-*+]\s+)?\*?\*?(Covers|Excludes|Assumes|Includes|Out of scope|Non-goals|Assumptions)\*?\*?\s*[:：]/i;
  const rest = body.slice(start);
  const stop = stopRe.exec(rest);
  const segment = stop ? rest.slice(0, stop.index) : rest;
  return segment.trim();
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractIdPrefixedItems(
  body: string,
  idPattern: RegExp,
): Array<{ id: string; text: string }> {
  // Match patterns like "R-001: text" or "- SC-001: text". Each item runs
  // until the next ID match or end.
  const lines = body.split('\n');
  const items: Array<{ id: string; text: string }> = [];
  let current: { id: string; text: string } | null = null;
  for (const raw of lines) {
    const stripped = raw.replace(/^\s*[-*+]\s+/, '').trim();
    const m = stripped.match(idPattern);
    if (m) {
      if (current) items.push(current);
      current = { id: m[1] ?? m[0], text: stripped.slice((m[0] ?? '').length).replace(/^\s*[:：]\s*/, '').trim() };
    } else if (current) {
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        current.text += (current.text.length > 0 ? ' ' : '') + trimmed;
      }
    }
  }
  if (current) items.push(current);
  return items;
}

interface ParsedScenario {
  id: string;
  kind: 'happy' | 'failure';
  given: string;
  when: string;
  then: string;
}

function parseScenarios(body: string): ParsedScenario[] {
  // Split on "### " sub-headings. For each, look for kind hints and Given/When/Then.
  const lines = body.split('\n');
  const blocks: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | null = null;
  let preamble: string[] = [];
  for (const raw of lines) {
    const m = raw.match(/^###\s+(.+)$/);
    if (m) {
      if (current) blocks.push(current);
      current = { heading: (m[1] ?? '').trim(), lines: [] };
    } else if (current) {
      current.lines.push(raw);
    } else {
      preamble.push(raw);
    }
  }
  if (current) blocks.push(current);

  const scenarios: ParsedScenario[] = [];
  let happyCount = 0;
  let failureCount = 0;

  // If no ### sub-headings, try to parse the whole body as one scenario.
  if (blocks.length === 0) {
    const one = parseGivenWhenThen(body);
    if (one) {
      const kind: 'happy' | 'failure' = guessKind('', body);
      const idx = kind === 'happy' ? ++happyCount : ++failureCount;
      scenarios.push({
        id: `S-${kind === 'happy' ? 'H' : 'F'}-${String(idx).padStart(2, '0')}`,
        kind,
        given: one.given,
        when: one.when,
        then: one.then,
      });
    }
    return scenarios;
  }

  for (const block of blocks) {
    const text = block.lines.join('\n');
    const gwt = parseGivenWhenThen(text) ?? {
      given: 'TBD',
      when: 'TBD',
      then: 'TBD',
    };
    const kind = guessKind(block.heading, text);
    const idx = kind === 'happy' ? ++happyCount : ++failureCount;
    scenarios.push({
      id: `S-${kind === 'happy' ? 'H' : 'F'}-${String(idx).padStart(2, '0')}`,
      kind,
      given: gwt.given,
      when: gwt.when,
      then: gwt.then,
    });
  }
  return scenarios;
}

function parseGivenWhenThen(text: string): { given: string; when: string; then: string } | null {
  // Try to find Given/When/Then anywhere in the text.
  const givenM = /(?:^|\n)\s*(?:[-*+]\s+)?\*?\*?Given\*?\*?\s*[:：]?\s*(.+?)(?=\n\s*(?:[-*+]\s+)?\*?\*?(?:When|Then)\*?\*?\s*[:：]|$)/is.exec(text);
  const whenM = /(?:^|\n)\s*(?:[-*+]\s+)?\*?\*?When\*?\*?\s*[:：]?\s*(.+?)(?=\n\s*(?:[-*+]\s+)?\*?\*?(?:Then|Given)\*?\*?\s*[:：]|$)/is.exec(text);
  const thenM = /(?:^|\n)\s*(?:[-*+]\s+)?\*?\*?Then\*?\*?\s*[:：]?\s*(.+?)(?=\n\s*(?:[-*+]\s+)?\*?\*?(?:Given|When)\*?\*?\s*[:：]|$)/is.exec(text);
  if (!givenM && !whenM && !thenM) return null;
  const collapse = (s: string | undefined): string =>
    (s ?? '').replace(/\s+/g, ' ').trim() || 'TBD';
  return {
    given: collapse(givenM?.[1]),
    when: collapse(whenM?.[1]),
    then: collapse(thenM?.[1]),
  };
}

function guessKind(heading: string, body: string): 'happy' | 'failure' {
  const h = (heading + ' ' + body).toLowerCase();
  // Korean and English happy/failure cues.
  const failureCues = ['fail', 'failure', 'error', 'unhappy', 'edge', 'p2', 'sad', 'failure', 'error', 'fault', 'exception'];
  const happyCues = ['happy', 'p1', 'success', 'ok', 'normal', 'success', 'normal'];
  for (const c of happyCues) if (h.includes(c)) return 'happy';
  for (const c of failureCues) if (h.includes(c)) return 'failure';
  return 'happy';
}

function extractMustKeyword(text: string): BriefPolicy['keyword'] {
  const upper = text.toUpperCase();
  const order: BriefPolicy['keyword'][] = [
    'MUST NOT',
    'SHALL NOT',
    'SHOULD NOT',
    'MUST',
    'SHALL',
    'SHOULD',
    'MAY',
  ];
  for (const k of order) {
    const re = new RegExp(`\\b${escapeReg(k)}\\b`);
    if (re.test(upper)) return k;
  }
  return 'MUST';
}

function guessCriterionType(
  text: string,
): { type: BriefCriterion['type']; measure: BriefCriterion['measure'] } {
  // numeric: contains a number with a comparator/percent/unit
  const numericM = /([<>]=?|=)\s*(-?\d+(?:\.\d+)?)\s*([%a-zA-Z/]*)/.exec(text);
  if (numericM) {
    const cmp = (numericM[1] ?? '=') as '<' | '<=' | '=' | '>=' | '>';
    const value = Number.parseFloat(numericM[2] ?? '0');
    const unit = (numericM[3] ?? '').trim() || 'count';
    return { type: 'numeric', measure: { value, comparator: cmp, unit } };
  }
  // Number alone like "0 errors" / "100%" → numeric =
  const plain = /\b(\d+(?:\.\d+)?)(\s*%)?/.exec(text);
  if (plain) {
    const value = Number.parseFloat(plain[1] ?? '0');
    const unit = plain[2] ? '%' : 'count';
    return { type: 'numeric', measure: { value, comparator: '=', unit } };
  }
  const lower = text.toLowerCase();
  if (/\b(test|verify|check|inspect|review|audit)\b/.test(lower)) {
    return {
      type: 'verification',
      measure: { method: 'manual review', reference: text.slice(0, 80) || 'TBD' },
    };
  }
  // binary fallback
  return { type: 'binary', measure: { predicate: text.slice(0, 200) || 'TBD' } };
}

// ── Section converters ────────────────────────────────────────────

function convertMotivation(section: ParsedSection | undefined): { problem: string; impact: BriefBody['context']['impact'] } {
  const text = section?.body.trim() ?? '';
  if (text.length === 0) {
    return { problem: 'TBD (fill in during migration)', impact: [{ statement: 'TBD' }] };
  }
  // First paragraph → problem; remaining paragraphs → impact statements.
  const paragraphs = splitParagraphs(text);
  const problem = paragraphs[0] ?? text;
  const impact = paragraphs.slice(1).map((p) => ({ statement: p }));
  if (impact.length === 0) impact.push({ statement: problem });
  return { problem, impact };
}

function convertScope(section: ParsedSection | undefined): {
  goals: BriefGoal[];
  non_goals: BriefNonGoal[];
  assumptions: BriefAssumption[];
} {
  if (!section) {
    return { goals: [], non_goals: [], assumptions: [] };
  }
  const body = section.body;

  // Try labeled sub-blocks first
  const coversText = findSubBlock(body, 'Covers') ?? findSubBlock(body, 'Includes') ?? findSubBlock(body, 'Goals');
  const excludesText = findSubBlock(body, 'Excludes') ?? findSubBlock(body, 'Non-goals') ?? findSubBlock(body, 'Out of scope');
  const assumesText = findSubBlock(body, 'Assumes') ?? findSubBlock(body, 'Assumptions');

  const coversItems = coversText ? splitBullets(coversText) : [];
  const excludesItems = excludesText ? splitBullets(excludesText) : [];
  const assumesItems = assumesText ? splitBullets(assumesText) : [];

  // Fallback: if no labeled sub-blocks, treat all top-level bullets as goals.
  let fallbackGoals: string[] = [];
  if (coversItems.length === 0 && excludesItems.length === 0 && assumesItems.length === 0) {
    fallbackGoals = splitBullets(body);
  }

  const goalsSrc = coversItems.length > 0 ? coversItems : fallbackGoals;
  const goals: BriefGoal[] = goalsSrc.map((s, i) => ({
    id: padId('G', i + 1),
    statement: s,
  }));
  const non_goals: BriefNonGoal[] = excludesItems.map((s, i) => ({
    id: padId('NG', i + 1),
    statement: s,
  }));
  const assumptions: BriefAssumption[] = assumesItems.map((s, i) => ({
    id: padId('A', i + 1),
    statement: s,
  }));

  return { goals, non_goals, assumptions };
}

function convertScenario(section: ParsedSection | undefined): BriefFlow[] {
  if (!section) return [];
  const parsed = parseScenarios(section.body);
  return parsed.map((s) => ({
    id: s.id,
    kind: s.kind,
    given: s.given,
    when: s.when,
    then: s.then,
    covers: [],
  }));
}

function convertRule(section: ParsedSection | undefined): BriefPolicy[] {
  if (!section) return [];
  // Try ID-prefixed items first (R-001: ...)
  const tagged = extractIdPrefixedItems(section.body, /^(R-\d{3,})/);
  if (tagged.length > 0) {
    return tagged.map((t) => ({
      id: t.id,
      subject: 'TBD',
      keyword: extractMustKeyword(t.text),
      predicate: t.text || 'TBD',
      governs: [],
    }));
  }
  // Fallback: bullets
  const bullets = splitBullets(section.body);
  return bullets.map((b, i) => ({
    id: padId('R', i + 1),
    subject: 'TBD',
    keyword: extractMustKeyword(b),
    predicate: b,
    governs: [],
  }));
}

function convertConstraint(section: ParsedSection | undefined): BriefExternal[] {
  if (!section) return [];
  const tagged = extractIdPrefixedItems(section.body, /^(C-\d{3,})/);
  const items = tagged.length > 0
    ? tagged.map((t) => ({ id: t.id, statement: t.text }))
    : splitBullets(section.body).map((b, i) => ({ id: padId('C', i + 1), statement: b }));
  return items.map((it) => ({
    id: it.id,
    statement: it.statement || 'TBD',
    reference: { title: 'existing-system', locator: 'TBD (fill in during migration)' },
  }));
}

function convertRisk(section: ParsedSection | undefined): BriefLimit[] {
  if (!section) return [];
  const tagged = extractIdPrefixedItems(section.body, /^(KL-\d{3,})/);
  if (tagged.length > 0) {
    return tagged.map((t) => ({ id: t.id, statement: t.text || 'TBD' }));
  }
  const bullets = splitBullets(section.body);
  return bullets.map((b, i) => ({ id: padId('KL', i + 1), statement: b }));
}

function convertCriteria(section: ParsedSection | undefined): BriefCriterion[] {
  if (!section) return [];
  const tagged = extractIdPrefixedItems(section.body, /^(SC-\d{3,})/);
  const items = tagged.length > 0
    ? tagged.map((t) => ({ id: t.id, text: t.text }))
    : splitBullets(section.body).map((b, i) => ({ id: padId('SC', i + 1), text: b }));
  return items.map((it) => {
    const guessed = guessCriterionType(it.text);
    return {
      id: it.id,
      type: guessed.type,
      measure: guessed.measure,
      verifies: [],
    };
  });
}

function convertDecision(section: ParsedSection | undefined): BriefBody['rationale'] {
  const text = section?.body.trim() ?? '';
  if (text.length === 0) {
    return {
      alternatives: [
        { option: 'TBD (chosen)', pros: ['fill in during migration'], cons: ['fill in during migration'] },
        { option: 'TBD (alternative)', pros: ['fill in during migration'], cons: ['fill in during migration'] },
      ],
      chosen: { option: 'TBD (chosen)', reasoning: 'TBD (fill in during migration)' },
      addresses: [],
    };
  }
  // Use the first paragraph as the chosen reasoning.
  const paragraphs = splitParagraphs(text);
  const first = paragraphs[0] ?? text;
  const second = paragraphs[1] ?? '';
  return {
    alternatives: [
      { option: 'chosen', pros: [first], cons: ['fill in during migration'] },
      {
        option: 'alternative (placeholder)',
        pros: ['fill in during migration'],
        cons: [second || 'fill in during migration'],
      },
    ],
    chosen: { option: 'chosen', reasoning: first },
    addresses: [],
  };
}

// ── Main entry ────────────────────────────────────────────────────

export async function migrateCardToNamespace(
  ctx: EmberdeckContext,
  options: MigrateCardOptions,
): Promise<MigrateCardResult> {
  const key = parseFullKey(options.cardKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  if (!(await Bun.file(filePath).exists())) throw new CardNotFoundError(key);
  const file: CardFile = await readCardFile(filePath);

  if (file.frontmatter.type !== 'brief') {
    throw new CardValidationError(
      `Card "${key}" is type "${file.frontmatter.type}" — only brief cards can be migrated.`,
    );
  }

  if (file.frontmatter.brief !== undefined) {
    throw new CardValidationError(
      `Card "${key}" already has a structured \`brief:\` namespace; nothing to migrate.`,
    );
  }

  const beforeBody = file.body;
  const sections = parseSections(beforeBody);

  // Map by normalized name.
  const sec = (name: string): ParsedSection | undefined => findSection(sections, name);

  const warnings: string[] = [];
  const unmappedSections: string[] = [];
  for (const s of sections) {
    if (!RECOGNIZED_SECTIONS.has(s.normalizedName)) {
      unmappedSections.push(s.heading);
    }
  }

  // Per-section conversions
  const context = convertMotivation(sec('motivation'));
  if (!sec('motivation')) warnings.push('missing ## Motivation section — context.problem set to placeholder');

  const scope = convertScope(sec('scope'));
  if (!sec('scope')) warnings.push('missing ## Scope section — goals/non_goals/assumptions left empty');
  if (scope.goals.length === 0) warnings.push('failed to extract goals from Scope — at least 1 goal is required');

  const flow = convertScenario(sec('scenario'));
  if (!sec('scenario')) warnings.push('missing ## Scenario section — flow left empty');
  if (flow.length === 0) warnings.push('failed to extract flow from Scenario — at least 1 happy + 1 failure are required');
  const hasHappy = flow.some((f) => f.kind === 'happy');
  const hasFailure = flow.some((f) => f.kind === 'failure');
  if (flow.length > 0 && !hasHappy) warnings.push('no happy scenario found — only failure detected');
  if (flow.length > 0 && !hasFailure) warnings.push('no failure scenario found — only happy detected');

  const policy = convertRule(sec('rule'));
  if (!sec('rule')) warnings.push('missing ## Rule section — policy left empty');

  const external = convertConstraint(sec('constraint'));
  if (!sec('constraint')) warnings.push('missing ## Constraint section — external left empty');
  if (external.length > 0) {
    warnings.push('cannot infer reference.locator from Constraint — fill in manually');
  }

  const limits = convertRisk(sec('risk'));
  if (!sec('risk')) warnings.push('missing ## Risk section — limits left empty');

  const criteria = convertCriteria(sec('criteria'));
  if (!sec('criteria')) warnings.push('missing ## Criteria section — criteria left empty');

  const rationale = convertDecision(sec('decision'));
  if (!sec('decision')) warnings.push('missing ## Decision section — rationale set to placeholder');
  warnings.push('one rationale.alternatives entry is a placeholder — fill in manually');

  // Auto cross-refs
  if (options.autoLinkRefs === true) {
    const firstGoal = scope.goals[0]?.id;
    if (firstGoal !== undefined) {
      for (const f of flow) {
        if (f.covers.length === 0) f.covers = [firstGoal];
      }
    } else {
      warnings.push('autoLinkRefs: no goals available — cannot populate flow.covers');
    }

    const allFlowIds = flow.map((f) => f.id);
    if (allFlowIds.length > 0) {
      for (const p of policy) {
        if (p.governs.length === 0) p.governs = [...allFlowIds];
      }
      for (const c of criteria) {
        if (c.verifies.length === 0) c.verifies = [...allFlowIds];
      }
    }

    const firstAddrId = external[0]?.id ?? limits[0]?.id;
    if (firstAddrId !== undefined && rationale.addresses.length === 0) {
      rationale.addresses = [firstAddrId];
    }
  } else {
    warnings.push('cross-refs (covers/governs/verifies/addresses) left empty — pass autoLinkRefs=true or fill in manually');
  }

  const newBriefBody: BriefBody = {
    context,
    scope,
    flow,
    design: {
      overview: 'TBD (fill in during migration)',
      components: [],
      data_flow: [],
      invariants: [],
    },
    policy,
    external,
    compatibility: { guarantees: [] },
    limits,
    criteria,
    rationale,
  };

  let validationStatus = 'passes';
  try {
    validateBriefRefs(newBriefBody);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    validationStatus = `fails: ${msg}`;
  }

  return {
    cardKey: key,
    filePath,
    beforeBody,
    newBriefBody,
    unmappedSections,
    warnings,
    validationStatus,
  };
}
