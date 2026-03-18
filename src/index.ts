// context-accordion — public API

export { AccordionComposer } from './composer'
export { enforceBudget, estimateTokens, TIER_PRIORITY } from './budget'
export type {
  AccordionBundle,
  AccordionConfig,
  AccordionPacket,
  AgentConfig,
  ComposeOptions,
  ExpandOptions,
  ExpansionEvent,
  EmbeddingProvider,
  VectorStoreConfig,
  IndexTaskOptions,
  TaskContext,
  GoalContext,
  RepoContext,
  HandoffContext,
  TierLevel,
} from './types'

export { OllamaEmbedding, OpenAIEmbedding } from './embeddings'
export type { AnyEmbeddingProvider } from './embeddings'

export { distill } from './distill'
export type { DistillOptions } from './distill'
