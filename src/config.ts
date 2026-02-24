import type { Gildash } from '@zipbul/gildash';
import type { EmberdeckDb } from './db/connection';
import type { CardRepository, RelationRepository, ClassificationRepository, CodeLinkRepository } from './db/repository';

export const DEFAULT_RELATION_TYPES = [
  'depends-on',
  'references',
  'related',
  'extends',
  'conflicts',
] as const;

export type DefaultRelationType = (typeof DEFAULT_RELATION_TYPES)[number];

export interface EmberdeckOptions {
  /** 카드 .card.md 파일이 저장되는 절대 경로 디렉토리 */
  cardsDir: string;
  /** SQLite DB 파일 절대 경로. ':memory:' 허용 */
  dbPath: string;
  /** 허용 관계 타입. 미지정 시 DEFAULT_RELATION_TYPES 사용 */
  allowedRelationTypes?: readonly string[];
  /** gildash 활성화용 프로젝트 루트 절대 경로. 미지정 시 코드 링크 기능 비활성 */
  projectRoot?: string;
  /** gildash ignore 패턴. 기본값: ['node_modules', 'dist', '.zipbul'] */
  gildashIgnore?: string[];
}

export interface EmberdeckContext {
  cardsDir: string;
  db: EmberdeckDb;
  cardRepo: CardRepository;
  relationRepo: RelationRepository;
  classificationRepo: ClassificationRepository;
  codeLinkRepo: CodeLinkRepository;
  allowedRelationTypes: readonly string[];
  /** gildash 인스턴스. projectRoot 미설정 또는 초기화 실패 시 undefined */
  gildash?: Gildash;
}

/**
 * ctx의 허용 관계 타입 목록에 새 타입을 추가.
 * 이미 존재하면 무시 (중복 방지).
 */
export function addRelationType(ctx: EmberdeckContext, type: string): void {
  if (!ctx.allowedRelationTypes.includes(type)) {
    ctx.allowedRelationTypes = [...ctx.allowedRelationTypes, type];
  }
}

/**
 * ctx의 허용 관계 타입 목록에서 타입 제거.
 * 존재하지 않으면 무해.
 */
export function removeRelationType(ctx: EmberdeckContext, type: string): void {
  ctx.allowedRelationTypes = ctx.allowedRelationTypes.filter((t) => t !== type);
}

/**
 * ctx의 현재 허용 관계 타입 목록 반환.
 */
export function listRelationTypes(ctx: EmberdeckContext): readonly string[] {
  return ctx.allowedRelationTypes;
}
