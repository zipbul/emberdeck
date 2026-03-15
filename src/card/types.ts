/**
 * Lifecycle status of a card.
 *
 * - `draft` — Initial authoring in progress. Not yet reviewed.
 * - `accepted` — Review complete. Awaiting implementation.
 * - `implementing` — Implementation in progress.
 * - `implemented` — Implementation complete.
 * - `deprecated` — No longer valid.
 */
export type CardStatus =
  | 'draft'
  | 'accepted'
  | 'implementing'
  | 'implemented'
  | 'deprecated';

/**
 * A unidirectional relation record between cards.
 * Reverse relations are auto-generated in the DB and are not directly represented by this interface.
 */
export interface CardRelation {
  /** Relation type. Must be a value registered in `EmberdeckContext.allowedRelationTypes`. */
  type: string;
  /** The target card's fullKey (e.g. `'auth-token'`, `'api/rate-limit'`). */
  target: string;
}

/**
 * A record linking a card to a source code symbol (gildash integration).
 * Code link functionality is only enabled when `EmberdeckOptions.projectRoot` is configured.
 */
export interface CodeLink {
  /** gildash SymbolKind (e.g. `'function'` | `'class'` | `'variable'` | ...) */
  kind: string;
  /** Relative path from the project root (e.g. `'src/auth/token.ts'`) */
  file: string;
  /** Exact symbol name (e.g. `'refreshToken'`) */
  symbol: string;
}

/**
 * YAML frontmatter structure of a `.card.md` file.
 * Converted to/from markdown files via `serializeCardMarkdown` / `parseCardMarkdown`.
 */
export interface CardFrontmatter {
  /** Unique card identifier. Must match the file path slug. */
  key: string;
  /** Required one-line summary of the card. */
  summary: string;
  /** Current lifecycle status of the card. */
  status: CardStatus;
  /** List of tags for categorization. */
  tags?: string[];
  /** List of keywords for search. */
  keywords?: string[];
  /** Free-form constraints. No schema defined. */
  constraints?: unknown;
  /** List of relations to other cards. */
  relations?: CardRelation[];
  /** List of source code symbol references. */
  codeLinks?: CodeLink[];
}

/**
 * Complete representation of a card read from a file.
 * Converted to/from disk via `readCardFile` / `writeCardFile`.
 */
export interface CardFile {
  /** Parsed frontmatter object. */
  frontmatter: CardFrontmatter;
  /** Markdown body below the frontmatter. */
  body: string;
  /** Absolute path to the card file. Computed via `buildCardPath(cardsDir, key)`. */
  filePath?: string;
}
