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
export type {
  CardStatus,
  CardType,
  CardPriority,
  AcceptanceCriterion,
  CardRelation,
  CardFrontmatter,
  CardFile,
  CodeLink,
} from './src/card/types';
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
export { bulkCreateCards, type BulkCreateResult } from './src/ops/bulk-create';
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
export {
  verifyAcceptance,
  listUnverified,
  getCardHistory,
  type VerifyAcceptanceResult,
  type UnverifiedCard,
} from './src/ops/acceptance';
export {
  generateContext,
  checkDrift,
  checkInteractions,
  type ContextPack,
  type GenerateContextOptions,
  type DriftResult,
  type CheckDriftOptions,
  type InteractionResult,
} from './src/ops/context';
export {
  preChangeCheck,
  regressionGuard,
  type PreChangeResult,
  type RegressionResult,
  type AffectedCard,
  type AtRiskAcceptance,
  type RiskLevel,
} from './src/ops/impact';

// ---- Repository interfaces (for testing/mocking) ----
export type {
  CardRepository,
  RelationRepository,
  ClassificationRepository,
  CodeLinkRepository,
  ChangelogRepository,
  CardRow,
  RelationRow,
  CodeLinkRow,
  ChangelogRow,
  CardListFilter,
} from './src/db/repository';

// ---- Pure utilities ----
export { normalizeSlug, parseFullKey, buildCardPath } from './src/card/card-key';
export { parseCardMarkdown, serializeCardMarkdown } from './src/card/markdown';
export { validateCardInput, LIMITS } from './src/card/validation';
export type { ValidationInput } from './src/card/validation';

// ---- DB (CLI integration) ----
export { migrateEmberdeck, type EmberdeckDb } from './src/db/connection';

// ---- MCP (optional — available when @modelcontextprotocol/sdk is installed) ----
export { registerEmberdeckTools } from './src/mcp/tools';

// ---- Safe operations (concurrency / rollback) ----
export {
  withRetry,
  withCardLock,
  safeWriteOperation,
  type RetryOptions,
  type SafeWriteOptions,
} from './src/ops/safe';

// ---- Config file loader ----
export {
  loadConfig,
  loadConfigFromPath,
  validateRawConfig,
  mergeCliArgs,
  buildDefaultConfig,
  DEFAULT_CARDS_DIR,
  DEFAULT_DB_PATH,
  DEFAULT_CARD_EXTENSION,
  DEFAULT_STATUSES,
  DEFAULT_LIMITS,
} from './src/config-file';
export type {
  EmberdeckFileConfig,
  ConfigLimits,
  ConfigError,
} from './src/config-file';
