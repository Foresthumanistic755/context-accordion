import { EmbeddingProvider } from '../types'

/**
 * Configuration options for OllamaEmbedding provider.
 */
export interface OllamaEmbeddingOptions {
  /** Base URL of the Ollama server (default: http://localhost:11434) */
  url?: string
  /** Model to use for embeddings (default: nomic-embed-text) */
  model?: string
}

/**
 * Embedding provider that uses a local Ollama instance.
 *
 * @example
 * ```typescript
 * const ollama = new OllamaEmbedding({ url: 'http://localhost:11434', model: 'nomic-embed-text' })
 * const embedding = await ollama.embed('Hello, world!')
 * ```
 */
export class OllamaEmbedding implements EmbeddingProvider {
  private readonly url: string
  private readonly model: string

  constructor(options: OllamaEmbeddingOptions = {}) {
    this.url = options.url ?? 'http://localhost:11434'
    this.model = options.model ?? 'nomic-embed-text'
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.url}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    })

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as { embedding: number[] }
    return data.embedding
  }
}

/**
 * Configuration options for OpenAIEmbedding provider.
 */
export interface OpenAIEmbeddingOptions {
  /** OpenAI API key (defaults to OPENAI_API_KEY environment variable) */
  apiKey?: string
  /** Model to use for embeddings (default: text-embedding-3-small) */
  model?: string
}

/**
 * Embedding provider that uses OpenAI's embedding API.
 *
 * @example
 * ```typescript
 * const openai = new OpenAIEmbedding({ apiKey: process.env.OPENAI_API_KEY, model: 'text-embedding-3-small' })
 * const embedding = await openai.embed('Hello, world!')
 * ```
 */
export class OpenAIEmbedding implements EmbeddingProvider {
  private readonly apiKey: string
  private readonly model: string

  constructor(options: OpenAIEmbeddingOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    this.model = options.model ?? 'text-embedding-3-small'
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> }
    return data.data[0]?.embedding ?? []
  }
}

/** Union type of all available embedding providers */
export type AnyEmbeddingProvider = OllamaEmbedding | OpenAIEmbedding
