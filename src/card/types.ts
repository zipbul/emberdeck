export type CardStatus =
  | 'draft'
  | 'accepted'
  | 'implementing'
  | 'implemented'
  | 'deprecated';

export interface CardRelation {
  type: string;
  target: string;
}

export interface CodeLink {
  /** gildash SymbolKind (e.g. 'function' | 'class' | 'variable' | ...) */
  kind: string;
  /** 프로젝트 루트 기준 상대 경로 (e.g. 'src/auth/token.ts') */
  file: string;
  /** 정확한 심볼 이름 (e.g. 'refreshToken') */
  symbol: string;
}

export interface CardFrontmatter {
  key: string;
  summary: string;
  status: CardStatus;
  tags?: string[];
  keywords?: string[];
  constraints?: unknown;
  relations?: CardRelation[];
  codeLinks?: CodeLink[];
}

export interface CardFile {
  frontmatter: CardFrontmatter;
  body: string;
  filePath?: string;
}
