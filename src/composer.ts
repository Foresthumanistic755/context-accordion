// context-accordion — AccordionComposer
// Main entry point. Framework-agnostic, zero required dependencies.

import { v4 as uuid } from 'uuid'
import { promises as fs } from 'fs'
import { enforceBudget, estimateTokens, TIER_PRIORITY } from './budget'
import type {
  AccordionBundle,
  AccordionConfig,
  AccordionPacket,
  AgentConfig,
  ComposeOptions,
  ExpandOptions,
  ExpansionEvent,
  GoalContext,
  HandoffContext,
  IndexTaskOptions,
  RepoContext,
  TaskContext,
  TierLevel,
} from './types'

const DEFAULT_MAX_TOKENS = 8000
const DEFAULT_CACHE_TTL = 1000 * 60 * 5 // 5 minutes

export class AccordionComposer {
  private config: AccordionConfig
  private sessionId: string
  private sessionCache: Map<string, AccordionPacket> = new Map()

  // Static cache shared across instances — keyed by content hash
  private static cache: Map<string, { packet: AccordionPacket; expires: number }> = new Map()

  /**
   * Creates a new AccordionComposer instance.
   * 
   * **Alpha Status:** This package is in alpha (0.x.x). The API may change in breaking
   * ways until version 1.0.0. For Harbor integration stability, pin to a specific
   * version tag and use the official framework adapters.
   * 
   * @param config - Optional configuration object for customizing composer behavior
   */
  constructor(config: AccordionConfig = {}) {
    this.config = config
    this.sessionId = uuid()
  }

  // ---------------------------------------------------------------------------
  // compose() — build a full bundle for an agent run
  // ---------------------------------------------------------------------------

  /**
   * Builds a complete accordion bundle for an agent run.
   * 
   * **Error Handling:** This method never throws. If a tier cannot be loaded
   * (e.g., experience.md not found), it is silently skipped. The returned bundle
   * will contain only the tiers that could be successfully assembled.
   * 
   * @param agent - The agent configuration including identity and experience settings
   * @param task - The task context containing title, description, and related metadata
   * @param options - Optional composition options for customizing bundle generation
   * @returns A promise that resolves to an AccordionBundle with all assembled packets
   */
  async compose(
    agent: AgentConfig,
    task: TaskContext,
    options: ComposeOptions = {}
  ): Promise<AccordionBundle> {
    const maxTokens = options.maxTokens ?? agent.maxTokens ?? this.config.maxTokens ?? DEFAULT_MAX_TOKENS
    const packets: AccordionPacket[] = []

    // L0 — Identity (always loaded, highest priority)
    const identityPacket = this.getCached(`identity:${agent.id}`)
      ?? this.buildIdentityPacket(agent)
    this.setCache(`identity:${agent.id}`, identityPacket)
    packets.push(identityPacket)

    // L1 — Task (always loaded)
    packets.push(this.buildTaskPacket(task))

    // L1 — Goal (if provided)
    if (task.goal) packets.push(this.buildGoalPacket(task.goal))

    // L1 — Repo (if provided)
    if (task.repo) packets.push(this.buildRepoPacket(task.repo))

    // L1 — Handoff (if provided)
    if (task.handoff) packets.push(this.buildHandoffPacket(task.handoff))

    // L2 — Experience (loaded from file if path provided)
    if (agent.experiencePath) {
      const expPacket = await this.buildExperiencePacket(agent.id, agent.experiencePath)
      if (expPacket) packets.push(expPacket)
    }

    // L3 — Archive (semantic retrieval from vector store)
    if (options.includePriorTasks && this.config.vectorStore) {
      const archivePackets = await this.retrieveArchive(task, options.priorTaskLimit ?? 3)
      packets.push(...archivePackets)
    }

    const finalPackets = enforceBudget(packets, maxTokens)
    const totalTokens = finalPackets.reduce((sum, p) => sum + estimateTokens(p.content), 0)

    return {
      agentId: agent.id,
      taskId: task.id,
      sessionId: this.sessionId,
      packets: finalPackets,
      totalTokens,
      maxTokens,
      expansionLog: [],
    }
  }

  // ---------------------------------------------------------------------------
  // expand() — on-demand tier expansion mid-run
  // ---------------------------------------------------------------------------

  /**
   * Expands an existing accordion bundle with additional tiers on-demand.
   * 
   * **Error Handling:** This method never throws. If expansion fails (e.g., file not found,
   * vector store unreachable), the original bundle is returned with a logged expansion event.
   * The `tokensAdded` field will be 0 to indicate no new content was added.
   * 
   * @param bundle - The existing accordion bundle to expand
   * @param options - Expansion options specifying tier, reason, and optional settings
   * @returns A promise that resolves to the expanded AccordionBundle
   */
  async expand(bundle: AccordionBundle, options: ExpandOptions): Promise<AccordionBundle> {
    const cacheKey = `expand:${options.tier}:${options.reason}`
    const cachedPacket = this.sessionCache.get(cacheKey)
    
    if (cachedPacket) {
      const tierExists = bundle.packets.some(p => p.tier === cachedPacket.tier)
      if (tierExists) {
        const event: ExpansionEvent = {
          tier: options.tier,
          reason: options.reason,
          tokensAdded: 0,
          timestamp: new Date(),
        }
        this.config.onExpand?.(event)
        
        return {
          ...bundle,
          expansionLog: [...bundle.expansionLog, event],
        }
      }
      
      const tokensAdded = estimateTokens(cachedPacket.content)
      const event: ExpansionEvent = {
        tier: options.tier,
        reason: options.reason,
        tokensAdded,
        timestamp: new Date(),
      }
      this.config.onExpand?.(event)
      
      return {
        ...bundle,
        packets: [...bundle.packets, cachedPacket],
        totalTokens: bundle.totalTokens + tokensAdded,
        expansionLog: [...bundle.expansionLog, event],
      }
    }

    try {
      if (options.tier === 'experience') {
        const packet = await this.buildExperiencePacket(bundle.agentId, options.experiencePath ?? '')
        if (packet) {
          const tierExists = bundle.packets.some(p => p.tier === packet.tier)
          if (tierExists) {
            const event: ExpansionEvent = {
              tier: options.tier,
              reason: options.reason,
              tokensAdded: 0,
              timestamp: new Date(),
            }
            this.config.onExpand?.(event)
            
            return {
              ...bundle,
              expansionLog: [...bundle.expansionLog, event],
            }
          }
          
          this.sessionCache.set(cacheKey, packet)
          const tokensAdded = estimateTokens(packet.content)
          const event: ExpansionEvent = {
            tier: options.tier,
            reason: options.reason,
            tokensAdded,
            timestamp: new Date(),
          }
          this.config.onExpand?.(event)
          
          return {
            ...bundle,
            packets: [...bundle.packets, packet],
            totalTokens: bundle.totalTokens + tokensAdded,
            expansionLog: [...bundle.expansionLog, event],
          }
        }
      } else if (options.tier === 'archive') {
        const task = { id: bundle.taskId ?? '', title: options.reason }
        const archivePackets = await this.retrieveArchive(task, options.limit ?? 3)
        if (archivePackets.length > 0) {
          const packet = archivePackets[0]
          const tierExists = bundle.packets.some(p => p.tier === packet.tier)
          if (tierExists) {
            const event: ExpansionEvent = {
              tier: options.tier,
              reason: options.reason,
              tokensAdded: 0,
              timestamp: new Date(),
            }
            this.config.onExpand?.(event)
            
            return {
              ...bundle,
              expansionLog: [...bundle.expansionLog, event],
            }
          }
          
          this.sessionCache.set(cacheKey, packet)
          const tokensAdded = estimateTokens(packet.content)
          const event: ExpansionEvent = {
            tier: options.tier,
            reason: options.reason,
            tokensAdded,
            timestamp: new Date(),
          }
          this.config.onExpand?.(event)
          
          return {
            ...bundle,
            packets: [...bundle.packets, packet],
            totalTokens: bundle.totalTokens + tokensAdded,
            expansionLog: [...bundle.expansionLog, event],
          }
        }
      } else {
        const existingPacket = bundle.packets.find(p => p.tier === options.tier)
        if (existingPacket?.expanded) {
          const event: ExpansionEvent = {
            tier: options.tier,
            reason: options.reason,
            tokensAdded: 0,
            timestamp: new Date(),
          }
          this.config.onExpand?.(event)
          
          return {
            ...bundle,
            expansionLog: [...bundle.expansionLog, event],
          }
        }
      }
    } catch {
      // Silently return original bundle on error
    }

    const event: ExpansionEvent = {
      tier: options.tier,
      reason: options.reason,
      tokensAdded: 0,
      timestamp: new Date(),
    }
    this.config.onExpand?.(event)

    return {
      ...bundle,
      expansionLog: [...bundle.expansionLog, event],
    }
  }

  /**
   * Clears all cached packets from the session cache.
   * This removes all temporarily stored accordion packets for the current session.
   */
  clearSessionCache(): void {
    this.sessionCache.clear()
  }

  // ---------------------------------------------------------------------------
  // render() — flatten bundle to a string
  // ---------------------------------------------------------------------------

  /**
   * Renders an accordion bundle into a single prompt string.
   * 
   * **Error Handling:** This method never throws.
   * 
   * @param bundle - The accordion bundle to render
   * @returns A string containing all packet contents joined together
   */
  render(bundle: AccordionBundle): string {
    return bundle.packets
      .map(p => p.content)
      .join('\n\n')
      .trim()
  }

  // ---------------------------------------------------------------------------
  // index() — store a completed task in the vector archive (L3)
  // ---------------------------------------------------------------------------

  /**
   * Indexes a completed task into the vector archive for future retrieval.
   * 
   * **Error Handling:** This method never throws. If the vector store is not configured
   * or is unreachable, indexing is silently skipped.
   * 
   * @param options - The indexing options containing task content, ID, and metadata
   * @returns A promise that resolves when indexing is complete
   */
  async index(options: IndexTaskOptions): Promise<void> {
    if (!this.config.vectorStore || !this.config.embeddingProvider) return

    const embedding = await this.config.embeddingProvider.embed(options.content)

    // Dynamic import — qdrant is an optional peer dep
    const { QdrantClient } = await import('@qdrant/js-client-rest')
    const client = new QdrantClient({ url: this.config.vectorStore.url })
    const collection = this.config.vectorStore.collection ?? 'tasks'

    await client.upsert(collection, {
      wait: true,
      points: [{
        id: options.taskId,
        vector: embedding,
        payload: {
          ...options.metadata,
          taskId: options.taskId,
          content: options.content,
          indexedAt: new Date().toISOString(),
        },
      }],
    })
  }

  // ---------------------------------------------------------------------------
  // Packet builders
  // ---------------------------------------------------------------------------

  private buildIdentityPacket(agent: AgentConfig): AccordionPacket {
    const now = new Date()
    return {
      id: uuid(),
      tier: 'identity',
      priority: TIER_PRIORITY.identity,
      maxTokens: 1000,
      content: `${agent.identity}\n\n## Session\nDate: ${now.toISOString().split('T')[0]}\nAgent: ${agent.id}`,
      summary: `Agent: ${agent.id}`,
      expanded: true,
      createdAt: now,
    }
  }

  private buildTaskPacket(task: TaskContext): AccordionPacket {
    const lines = [
      `## Task: ${task.title}`,
      task.description ? `\n${task.description}` : '',
      task.priority ? `\nPriority: ${task.priority}` : '',
      task.type ? `Type: ${task.type}` : '',
      task.owner ? `Owner: ${task.owner}` : '',
      task.requirements?.length
        ? `\n### Requirements\n${task.requirements.map(r => `- ${r}`).join('\n')}`
        : '',
    ].filter(Boolean)

    return {
      id: uuid(),
      tier: 'task',
      priority: TIER_PRIORITY.task,
      maxTokens: 2000,
      content: lines.join('\n'),
      summary: `${task.title} (${task.type ?? 'task'})`,
      expanded: true,
      createdAt: new Date(),
    }
  }

  private buildGoalPacket(goal: GoalContext): AccordionPacket {
    return {
      id: uuid(),
      tier: 'goal',
      priority: TIER_PRIORITY.goal,
      maxTokens: 1000,
      content: [
        `## Goal: ${goal.title}`,
        goal.description ?? '',
        goal.progress !== undefined ? `Progress: ${goal.progress}%` : '',
        goal.status ? `Status: ${goal.status}` : '',
      ].filter(Boolean).join('\n'),
      summary: `Goal: ${goal.title}`,
      expanded: true,
      createdAt: new Date(),
    }
  }

  private buildRepoPacket(repo: RepoContext): AccordionPacket {
    return {
      id: uuid(),
      tier: 'repo',
      priority: TIER_PRIORITY.repo,
      maxTokens: 1500,
      content: [
        `## Repository: ${repo.name}`,
        `Path: ${repo.path}`,
        repo.description ?? '',
        repo.techStack?.length ? `Stack: ${repo.techStack.join(', ')}` : '',
        repo.mainFiles?.length ? `Key files:\n${repo.mainFiles.map(f => `- ${f}`).join('\n')}` : '',
      ].filter(Boolean).join('\n'),
      summary: `Repo: ${repo.name}`,
      expanded: true,
      createdAt: new Date(),
    }
  }

  private buildHandoffPacket(handoff: HandoffContext): AccordionPacket {
    return {
      id: uuid(),
      tier: 'handoff',
      priority: TIER_PRIORITY.handoff,
      maxTokens: 1000,
      content: [
        `## Handoff from ${handoff.fromAgent}`,
        handoff.previousWork ? `### Previous Work\n${handoff.previousWork}` : '',
        handoff.notes ? `### Notes\n${handoff.notes}` : '',
        handoff.percentageComplete !== undefined
          ? `Completion: ${handoff.percentageComplete}%`
          : '',
      ].filter(Boolean).join('\n'),
      summary: `Handoff from ${handoff.fromAgent}`,
      expanded: true,
      createdAt: new Date(),
    }
  }

  private async buildExperiencePacket(
    agentId: string,
    experiencePath: string
  ): Promise<AccordionPacket | null> {
    const cacheKey = `experience:${agentId}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    try {
      const content = await fs.readFile(experiencePath, 'utf-8')
      if (!content.trim()) return null

      const packet: AccordionPacket = {
        id: uuid(),
        tier: 'experience',
        priority: TIER_PRIORITY.experience,
        maxTokens: 1000,
        content: `## Learned Experience\n${content}`,
        summary: 'Agent experience and learned lessons',
        expanded: true,
        createdAt: new Date(),
      }

      this.setCache(cacheKey, packet)
      return packet
    } catch {
      return null // experience.md not found — skip silently
    }
  }

  private async retrieveArchive(
    task: TaskContext,
    limit: number
  ): Promise<AccordionPacket[]> {
    if (!this.config.vectorStore || !this.config.embeddingProvider) return []

    try {
      const embedding = await this.config.embeddingProvider.embed(
        `${task.title} ${task.description ?? ''}`
      )

      const { QdrantClient } = await import('@qdrant/js-client-rest')
      const client = new QdrantClient({ url: this.config.vectorStore.url })
      const collection = this.config.vectorStore.collection ?? 'tasks'

      const results = await client.search(collection, {
        vector: embedding,
        limit: limit + 1,
        filter: {
          must_not: [{ key: 'taskId', match: { value: task.id } }],
        },
        with_payload: true,
      })

      if (!results.length) return []

      const content = results
        .map(r => {
          const title = (r.payload?.title as string) ?? r.id
          const desc = (r.payload?.content as string) ?? ''
          const score = (r.score * 100).toFixed(0)
          return `### ${title} (relevance: ${score}%)\n${desc}`
        })
        .join('\n\n')

      return [{
        id: uuid(),
        tier: 'archive',
        priority: TIER_PRIORITY.archive,
        maxTokens: 1500,
        content: `## Similar Past Tasks\n\n${content}`,
        summary: `${results.length} similar past tasks retrieved`,
        expanded: true,
        createdAt: new Date(),
      }]
    } catch {
      return [] // Qdrant unreachable — degrade gracefully
    }
  }

  // ---------------------------------------------------------------------------
  // Cache helpers
  // ---------------------------------------------------------------------------

  private getCached(key: string): AccordionPacket | null {
    const entry = AccordionComposer.cache.get(key)
    if (entry && entry.expires > Date.now()) {
      return { ...entry.packet, id: uuid(), createdAt: new Date() }
    }
    return null
  }

  private setCache(key: string, packet: AccordionPacket): void {
    AccordionComposer.cache.set(key, {
      packet,
      expires: Date.now() + (this.config.cacheTtl ?? DEFAULT_CACHE_TTL),
    })
  }
}
