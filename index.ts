// ---- Setup ----
export { setupEmberdeck, teardownEmberdeck } from './src/setup';
export type { EmberdeckOptions, EmberdeckContext } from './src/config';
export {
  DEFAULT_RELATION_TYPES,
  addRelationType,
  removeRelationType,
  listRelationTypes,
} from './src/config';

// ---- Types ----
export type { CardStatus, CardRelation, CardFrontmatter, CardFile, CodeLink } from './src/card/types';
export {
  CardKeyError,
  CardValidationError,
  CardNotFoundError,
  CardAlreadyExistsError,
  CardRenameSamePathError,
  RelationTypeError,
  GildashNotConfiguredError,
  CompensationError,
} from './src/card/errors';

// ---- Operations ----
export { createCard, type CreateCardInput, type CreateCardResult } from './src/ops/create';
export {
  updateCard,
  updateCardStatus,
  type UpdateCardFields,
  type UpdateCardResult,
} from './src/ops/update';
export { deleteCard } from './src/ops/delete';
export { renameCard, type RenameCardResult } from './src/ops/rename';
export {
  getCard,
  listCards,
  searchCards,
  listCardRelations,
  getCardContext,
  getRelationGraph,
  type CardContext,
  type RelationGraphNode,
  type RelationGraphOptions,
} from './src/ops/query';
export {
  syncCardFromFile,
  removeCardByFile,
  bulkSyncCards,
  validateCards,
  exportCardToFile,
  type BulkSyncResult,
  type CardValidationResult,
} from './src/ops/sync';
export {
  resolveCardCodeLinks,
  findCardsBySymbol,
  findAffectedCards,
  validateCodeLinks,
  type ResolvedCodeLink,
  type BrokenLink,
} from './src/ops/link';

// ---- Repository interfaces (테스트/목킹용) ----
export type {
  CardRepository,
  RelationRepository,
  ClassificationRepository,
  CodeLinkRepository,
  CardRow,
  RelationRow,
  CodeLinkRow,
} from './src/db/repository';

// ---- Pure utilities (CLI에서 키 검증만 필요할 때) ----
export { normalizeSlug, parseFullKey, buildCardPath } from './src/card/card-key';
export { parseCardMarkdown, serializeCardMarkdown } from './src/card/markdown';

// ---- DB (CLI 통합용) ----
export { migrateEmberdeck, type EmberdeckDb } from './src/db/connection';

// ---- MCP (optional — @modelcontextprotocol/sdk 설치 시 사용 가능) ----
export { registerEmberdeckTools } from './src/mcp/tools';

// ---- Safe operations (concurrency / rollback) ----
export {
  withRetry,
  withCardLock,
  safeWriteOperation,
  type RetryOptions,
  type SafeWriteOptions,
} from './src/ops/safe';
