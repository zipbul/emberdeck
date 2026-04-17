/**
 * Lifecycle status of a card.
 *
 * - `draft` — Card authoring in progress or intentional rework. codeLinks are treated as planned.
 * - `active` — Code and spec are structurally aligned.
 * - `drifted` — Code has diverged from spec. System auto-detects and transitions.
 */
export type CardStatus = 'draft' | 'active' | 'drifted';

/**
 * Card type classifying the nature of the spec.
 *
 * - `brief` — Upstream decisions: why it exists, scope, constraints, policies. Not bound to code.
 * - `spec` — Downstream contracts: verifiable behaviors bound to code via codeLinks.
 */
export type CardType = 'brief' | 'spec';

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
  /** Card type (brief, spec). Required. */
  type: CardType;
  /** Parent card key. Same type or one level up in hierarchy. */
  parent?: string;
  /** File/directory glob patterns this card is responsible for. */
  boundary?: string[];
  /** List of related card keys. Direction is from the declaring card. */
  relations?: string[];
  /** List of source code symbol references. */
  codeLinks?: CodeLink[];
  /** List of tags for categorization. Stored as lowercase. */
  tags?: string[];
  /** Glossary words declared by this card. Each must exist in glossary.yaml. */
  glossary?: string[];
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
