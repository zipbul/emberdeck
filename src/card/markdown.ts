import type {
  CardFile,
  CardFrontmatter,
  CardStatus,
  CardType,
  CodeLink,
} from './types';
import { CardValidationError } from './errors';

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function isCardStatus(value: unknown): value is CardStatus {
  return value === 'draft' || value === 'active' || value === 'drifted';
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CardValidationError(`Invalid frontmatter field: ${field}`);
  }
  return value;
}

function normalizeTags(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new CardValidationError('Invalid frontmatter field: tags');
  }

  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new CardValidationError('Invalid frontmatter field: tags');
    }
    out.push(item.toLowerCase());
  }

  return out;
}

function normalizeCodeLinks(value: unknown): CodeLink[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new CardValidationError('Invalid frontmatter field: codeLinks');
  }

  const out: CodeLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      throw new CardValidationError('Invalid frontmatter field: codeLinks');
    }
    const cl = item as Record<string, unknown>;
    out.push({
      kind: asString(cl.kind, 'codeLinks[].kind'),
      file: asString(cl.file, 'codeLinks[].file'),
      symbol: asString(cl.symbol, 'codeLinks[].symbol'),
    });
  }
  return out;
}

const VALID_CARD_TYPES = ['intent', 'spec'];

function normalizeCardType(value: unknown): CardType {
  if (typeof value !== 'string' || !VALID_CARD_TYPES.includes(value)) {
    throw new CardValidationError(`Invalid frontmatter field: type (expected one of: ${VALID_CARD_TYPES.join(', ')})`);
  }
  return value as CardType;
}

function normalizeRelations(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new CardValidationError('Invalid frontmatter field: relations');
  }

  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new CardValidationError('Invalid frontmatter field: relations (each item must be a non-empty string)');
    }
    out.push(item);
  }
  return out;
}

function normalizeBoundary(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new CardValidationError('Invalid frontmatter field: boundary');
  }

  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new CardValidationError('Invalid frontmatter field: boundary (each item must be a non-empty string)');
    }
    out.push(item);
  }
  return out;
}

function coerceFrontmatter(doc: unknown): CardFrontmatter {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new CardValidationError('Invalid frontmatter: expected YAML object');
  }

  const fm = doc as Record<string, unknown>;

  const status = fm['status'];
  if (!isCardStatus(status)) {
    throw new CardValidationError('Invalid frontmatter field: status');
  }

  const out: CardFrontmatter = {
    key: asString(fm['key'], 'key'),
    summary: asString(fm['summary'], 'summary'),
    status,
    type: normalizeCardType(fm['type']),
  };

  if (fm['parent'] != null) {
    out.parent = asString(fm['parent'], 'parent');
  }

  const boundary = normalizeBoundary(fm['boundary']);
  if (boundary !== undefined) out.boundary = boundary;

  const relations = normalizeRelations(fm['relations']);
  if (relations !== undefined) out.relations = relations;

  const codeLinks = normalizeCodeLinks(fm['codeLinks']);
  if (codeLinks !== undefined) out.codeLinks = codeLinks;

  const tags = normalizeTags(fm['tags']);
  if (tags !== undefined) out.tags = tags;

  return out;
}

/** @spec card-model */
export function parseCardMarkdown(markdown: string): CardFile {
  const normalized = normalizeNewlines(markdown);
  const lines = normalized.split('\n');

  if (lines[0] !== '---') {
    throw new CardValidationError('Missing YAML frontmatter');
  }

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      end = i;
      break;
    }
  }

  if (end === -1) {
    throw new CardValidationError('Unterminated YAML frontmatter');
  }

  const yamlText = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');

  let doc: unknown;
  try {
    doc = Bun.YAML.parse(yamlText);
  } catch (err) {
    throw new CardValidationError(
      `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (Array.isArray(doc)) {
    throw new CardValidationError('Invalid frontmatter: multi-document YAML is not allowed');
  }

  const frontmatter = coerceFrontmatter(doc);
  return { frontmatter, body };
}

/** @spec card-model */
export function serializeCardMarkdown(frontmatter: CardFrontmatter, body: string): string {
  const yaml = (Bun.YAML.stringify(frontmatter) ?? '').trimEnd();
  const header = `---\n${yaml}\n---\n`;
  return header + body;
}
