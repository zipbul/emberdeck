// ---- Setup ----
export { setupEmberdeck, teardownEmberdeck } from './src/setup';
export type { EmberdeckOptions, EmberdeckContext } from './src/config';

// ---- Types ----
export type {
  CardStatus,
  CardType,
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
  ParentValidationError,
  ActivationGuardError,
  BoundaryValidationError,
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
export { deleteCard, type DeleteCardOptions } from './src/ops/delete';
export { renameCard, type RenameCardResult } from './src/ops/rename';
export {
  getCard,
  getCards,
  listCards,
  searchCards,
  listCardRelations,
  getCardContext,
  getRelationGraph,
  getCardTree,
  type CardContext,
  type RelatedCard,
  type GetCardContextOptions,
  type GetCardResult,
  type GetCardsResult,
  type CardSummaryRow,
  type SearchCardsOptions,
  type RelationGraphNode,
  type RelationGraphOptions,
  type CardTreeNode,
} from './src/ops/query';
export {
  syncCardFromFile,
  removeCardByFile,
  bulkSyncCards,
  validateCards,
  exportCardToFile,
  type BulkSyncResult,
  type CardValidationResult,
  type ValidationWarning,
} from './src/ops/sync';
export {
  ensureReindexed,
  resolveCardCodeLinks,
  findCardsBySymbol,
  validateCodeLinks,
  type ResolvedCodeLink,
  type BrokenLink,
  type ValidateCodeLinksResult,
  type SymbolMatchResult,
} from './src/ops/link';
export {
  checkDrift,
  checkInteractions,
  type DriftResult,
  type DriftCard,
  type DriftHealth,
  type DriftType,
  type SymbolChangeDetail,
  type CheckDriftOptions,
  type InteractionResult,
  type CardInteraction,
  type ImportDependency,
  type SharedSymbol,
  type UndefinedRelation,
} from './src/ops/context';
export {
  preChangeCheck,
  regressionGuard,
  type PreChangeResult,
  type RegressionResult,
  type AffectedCard,
  type RiskLevel,
} from './src/ops/impact';
export {
  syncSpecAnnotations,
  writeSpecAnnotations,
  syncSymbolChanges,
  getLinkCoverage,
  getUncoveredSymbols,
  suggestCardScope,
  type SpecSyncResult,
  type WriteSpecResult,
  type SymbolSyncResult,
  type LinkCoverageResult,
  type UncoveredResult,
  type UncoveredSymbol,
  type GetUncoveredSymbolsOptions,
  type CardSuggestion,
  type SuggestCardScopeOptions,
} from './src/ops/spec-sync';
export {
  analyze,
  type AnalyzeResult,
  type AnalyzeHealth,
  type AnalyzeCoverage,
  type UnlinkedSymbol,
  type DriftedCardSummary,
  type AnalyzeOptions,
} from './src/ops/analyze';

// ---- Glossary ----
export {
  defineGlossary,
  lookupGlossary,
  removeGlossary,
  renameGlossary,
  type DefineGlossaryInput,
  type DefineGlossaryResult,
  type LookupGlossaryResult,
  type RemoveGlossaryResult,
  type RenameGlossaryResult,
  findCardsByGlossaryWord,
  type GlossaryCardMatch,
  resetEmberdeck,
  type ResetResult,
} from './src/ops/glossary';
export {
  readGlossary,
  writeGlossary,
  glossaryFilePath,
  GLOSSARY_LIMITS,
  GlossaryParseError,
  GlossaryValidationError,
  type GlossaryEntry,
} from './src/glossary/io';
export { withGlossaryLock } from './src/glossary/lock';
export { validateCardGlossaryField, validateGlossaryEntry } from './src/glossary/validation';
export { buildGlossaryMatcher, crossValidateGlossary, type GlossaryCrossWarning } from './src/glossary/cross-validate';

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
} from './src/config-file';
export type {
  EmberdeckFileConfig,
  ConfigError,
} from './src/config-file';
