/**
 * 카드의 라이프사이클 상태.
 *
 * - `draft` — 초기 작성 중. 검토 전.
 * - `accepted` — 리뷰 완료. 구현 대기.
 * - `implementing` — 구현 진행 중.
 * - `implemented` — 구현 완료.
 * - `deprecated` — 더 이상 유효하지 않음.
 */
export type CardStatus =
  | 'draft'
  | 'accepted'
  | 'implementing'
  | 'implemented'
  | 'deprecated';

/**
 * 카드 간 단방향 관계 레코드.
 * 역방향(reverse)은 DB에서 자동 생성되며 이 인터페이스로 직접 표현하지 않는다.
 */
export interface CardRelation {
  /** 관계 타입. `EmberdeckContext.allowedRelationTypes`에 등록된 값이어야 한다. */
  type: string;
  /** 대상 카드의 fullKey (e.g. `'auth-token'`, `'api/rate-limit'`). */
  target: string;
}

/**
 * 카드와 소스 코드 심볼을 연결하는 레코드 (gildash 통합).
 * `EmberdeckOptions.projectRoot`가 설정된 경우에만 코드 링크 기능이 활성화된다.
 */
export interface CodeLink {
  /** gildash SymbolKind (e.g. `'function'` | `'class'` | `'variable'` | ...) */
  kind: string;
  /** 프로젝트 루트 기준 상대 경로 (e.g. `'src/auth/token.ts'`) */
  file: string;
  /** 정확한 심볼 이름 (e.g. `'refreshToken'`) */
  symbol: string;
}

/**
 * `.card.md` 파일의 YAML frontmatter 구조.
 * `serializeCardMarkdown` / `parseCardMarkdown`으로 마크다운 파일과 상호변환된다.
 */
export interface CardFrontmatter {
  /** 카드 고유 식별자. 파일 경로 slug와 일치해야 한다. */
  key: string;
  /** 카드를 한 줄로 요약하는 필수 텍스트. */
  summary: string;
  /** 카드의 현재 라이프사이클 상태. */
  status: CardStatus;
  /** 분류용 태그 목록. */
  tags?: string[];
  /** 검색용 키워드 목록. */
  keywords?: string[];
  /** 자유 형식 제약 조건 맵. 스키마 미지정. */
  constraints?: Record<string, unknown>;
  /** 다른 카드와의 관계 목록. */
  relations?: CardRelation[];
  /** 소스 코드 심볼 참조 목록. */
  codeLinks?: CodeLink[];
}

/**
 * 파일에서 읽은 카드의 전체 표현.
 * `readCardFile` / `writeCardFile`로 디스크와 상호변환된다.
 */
export interface CardFile {
  /** 파싱된 frontmatter 객체. */
  frontmatter: CardFrontmatter;
  /** frontmatter 아래의 마크다운 본문. */
  body: string;
  /** 카드 파일의 절대 경로. `buildCardPath(cardsDir, key)`로 계산. */
  filePath?: string;
}
