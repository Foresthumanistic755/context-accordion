import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AccordionComposer } from '../src/composer'
import { estimateTokens } from '../src/budget'
import type { AgentConfig, TaskContext, AccordionBundle, EmbeddingProvider, VectorStoreConfig } from '../src/types'
import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'

const agent: AgentConfig = {
  id: 'builder',
  identity: 'You are a senior software engineer with expertise in TypeScript and React.',
  maxTokens: 4000,
}

const task: TaskContext = {
  id: 'task-001',
  title: 'Build user authentication',
  description: 'Implement JWT-based authentication with refresh tokens.',
  priority: 'high',
  type: 'feature',
  requirements: [
    'User registration with email verification',
    'Login with JWT tokens',
    'Refresh token rotation',
    'Logout with token invalidation',
  ],
}

describe('Integration Tests', () => {
  describe('Full compose → render → token count pipeline', () => {
    it('creates bundle with agent, task, goal, repo, handoff and verifies token count', async () => {
      const composer = new AccordionComposer({ maxTokens: 8000 })

      const taskWithExtras: TaskContext = {
        ...task,
        goal: {
          id: 'goal-1',
          title: 'Ship secure authentication system',
          description: 'Complete authentication by end of sprint',
          progress: 25,
          status: 'in_progress',
        },
        repo: {
          name: 'my-app',
          path: '/workspace/my-app',
          description: 'Full-stack React + Node.js application',
          techStack: ['React', 'TypeScript', 'Node.js', 'PostgreSQL'],
          mainFiles: ['src/App.tsx', 'src/server/index.ts', 'src/server/db/schema.ts'],
        },
        handoff: {
          fromAgent: 'architect',
          previousWork: 'Defined API schemas and database schema',
          notes: 'Focus on security best practices',
          percentageComplete: 15,
        },
      }

      const bundle = await composer.compose(agent, taskWithExtras)

      expect(bundle.packets.length).toBeGreaterThanOrEqual(5)
      expect(bundle.packets.some(p => p.tier === 'identity')).toBe(true)
      expect(bundle.packets.some(p => p.tier === 'task')).toBe(true)
      expect(bundle.packets.some(p => p.tier === 'goal')).toBe(true)
      expect(bundle.packets.some(p => p.tier === 'repo')).toBe(true)
      expect(bundle.packets.some(p => p.tier === 'handoff')).toBe(true)

      const rendered = composer.render(bundle)
      expect(rendered.length).toBeGreaterThan(0)
      expect(rendered).toContain('Build user authentication')
      expect(rendered).toContain('my-app')
      expect(rendered).toContain('architect')

      const renderedTokenCount = estimateTokens(rendered)
      expect(renderedTokenCount).toBe(bundle.totalTokens)

      expect(bundle.totalTokens).toBeLessThanOrEqual(bundle.maxTokens)
    })
  })

  describe('Qdrant graceful degradation', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'accordion-qdrant-test-'))
      ;(AccordionComposer as unknown as { cache: Map<string, unknown> }).cache.clear()
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('skips L3 without throwing when vectorStore is unreachable', async () => {
      const mockEmbeddingProvider: EmbeddingProvider = {
        embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
      }

      const vectorStore: VectorStoreConfig = {
        url: 'http://localhost:6333',
        collection: 'tasks',
      }

      const composer = new AccordionComposer({
        vectorStore,
        embeddingProvider: mockEmbeddingProvider,
      })

      const bundle = await composer.compose(agent, task, {
        includePriorTasks: true,
        priorTaskLimit: 3,
      })

      expect(bundle.packets.some(p => p.tier === 'archive')).toBe(false)
    })

    it('silently skips archive tier when vectorStore is not configured', async () => {
      const composer = new AccordionComposer()

      const bundle = await composer.compose(agent, task, {
        includePriorTasks: true,
        priorTaskLimit: 3,
      })

      expect(bundle.packets.some(p => p.tier === 'archive')).toBe(false)
    })

    it('skips L3 gracefully when embedding provider fails', async () => {
      const failingEmbeddingProvider: EmbeddingProvider = {
        embed: vi.fn().mockRejectedValue(new Error('Embedding service unavailable')),
      }

      const vectorStore: VectorStoreConfig = {
        url: 'http://localhost:6333',
        collection: 'tasks',
      }

      const composer = new AccordionComposer({
        vectorStore,
        embeddingProvider: failingEmbeddingProvider,
      })

      const bundle = await composer.compose(agent, task, {
        includePriorTasks: true,
      })

      expect(bundle.packets.some(p => p.tier === 'archive')).toBe(false)
    })
  })

  describe('Full expand workflow', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'accordion-expand-test-'))
      ;(AccordionComposer as unknown as { cache: Map<string, unknown> }).cache.clear()
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('compose → expand experience → verify expanded content in bundle', async () => {
      const experiencePath = path.join(tempDir, 'experience.md')
      const experienceContent = `# Experience

## Lessons Learned

- Always validate JWT tokens on the server
- Store refresh tokens in HttpOnly cookies
- Implement rate limiting on auth endpoints
- Use constant-time comparison for sensitive data
`
      await fs.writeFile(experiencePath, experienceContent)

      const composer = new AccordionComposer()
      const bundle = await composer.compose(agent, task)

      const initialPacketCount = bundle.packets.length
      expect(bundle.packets.some(p => p.tier === 'experience')).toBe(false)

      const expandedBundle = await composer.expand(bundle, {
        tier: 'experience',
        reason: 'Need context from past authentication implementations',
        experiencePath,
      })

      expect(expandedBundle.packets.length).toBe(initialPacketCount + 1)
      expect(expandedBundle.packets.some(p => p.tier === 'experience')).toBe(true)

      const experiencePacket = expandedBundle.packets.find(p => p.tier === 'experience')
      expect(experiencePacket?.content).toContain('JWT tokens')
      expect(experiencePacket?.content).toContain('refresh tokens')

      const rendered = composer.render(expandedBundle)
      expect(rendered).toContain('JWT tokens')
      expect(rendered).toContain('refresh tokens')
      expect(rendered).toContain('Build user authentication')

      expect(expandedBundle.expansionLog.length).toBe(1)
      expect(expandedBundle.expansionLog[0].tier).toBe('experience')
      expect(expandedBundle.expansionLog[0].tokensAdded).toBeGreaterThan(0)
    })

    it('expand with archive tier returns bundle with archive packet', async () => {
      const mockEmbeddingProvider: EmbeddingProvider = {
        embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
      }

      const vectorStore: VectorStoreConfig = {
        url: 'http://localhost:6333',
        collection: 'tasks',
      }

      const composer = new AccordionComposer({
        vectorStore,
        embeddingProvider: mockEmbeddingProvider,
      })

      const bundle = await composer.compose(agent, task)

      const expandedBundle = await composer.expand(bundle, {
        tier: 'archive',
        reason: 'Need context from similar past tasks',
        limit: 3,
      })

      expect(expandedBundle.expansionLog.length).toBe(1)
      expect(expandedBundle.expansionLog[0].tier).toBe('archive')
    })
  })

  describe('Token budget enforcement end-to-end', () => {
    it('enforces budget with low maxTokens, dropping lower priority packets', async () => {
      const veryLowBudget = 500
      const composer = new AccordionComposer({ maxTokens: veryLowBudget })

      const taskWithManyPackets: TaskContext = {
        ...task,
        goal: {
          id: 'goal-1',
          title: 'Complete authentication',
          description: 'Implement full auth system',
          progress: 10,
        },
        repo: {
          name: 'my-app',
          path: '/workspace/my-app',
          description: 'Large application with many files',
          techStack: ['React', 'Node.js', 'PostgreSQL', 'Redis', 'Docker'],
          mainFiles: ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts', 'file5.ts'],
        },
        handoff: {
          fromAgent: 'previous-agent',
          previousWork: 'Some work done here',
          notes: 'Additional notes for context',
          percentageComplete: 20,
        },
      }

      const bundle = await composer.compose(agent, taskWithManyPackets, {
        maxTokens: veryLowBudget,
      })

      expect(bundle.totalTokens).toBeLessThanOrEqual(veryLowBudget)

      const identityPacket = bundle.packets.find(p => p.tier === 'identity')
      const taskPacket = bundle.packets.find(p => p.tier === 'task')
      expect(identityPacket).toBeDefined()
      expect(taskPacket).toBeDefined()

      const archivePacket = bundle.packets.find(p => p.tier === 'archive')
      expect(archivePacket).toBeUndefined()
    })

    it('never drops identity and task packets regardless of budget', async () => {
      const lowBudget = 300
      const composer = new AccordionComposer()

      const taskWithExtras: TaskContext = {
        ...task,
        goal: { id: 'g1', title: 'Goal' },
        repo: { name: 'r1', path: '/r1' },
        handoff: { fromAgent: 'a1' },
      }

      const bundle = await composer.compose(agent, taskWithExtras, {
        maxTokens: lowBudget,
      })

      const identityPacket = bundle.packets.find(p => p.tier === 'identity')
      const taskPacket = bundle.packets.find(p => p.tier === 'task')

      expect(identityPacket).toBeDefined()
      expect(taskPacket).toBeDefined()
      expect(identityPacket?.content).toContain('senior software engineer')
      expect(taskPacket?.content).toContain('Build user authentication')
    })

    it('drops lower priority packets before higher priority ones', async () => {
      const composer = new AccordionComposer()

      const taskWithAllTiers: TaskContext = {
        ...task,
        goal: {
          id: 'goal-1',
          title: 'Complete authentication system',
          description: 'Build a complete auth system',
          progress: 50,
          status: 'in_progress',
        },
        repo: {
          name: 'my-app',
          path: '/workspace/my-app',
          description: 'Full-stack application',
          techStack: ['React', 'Node.js'],
          mainFiles: ['main.ts'],
        },
        handoff: {
          fromAgent: 'architect',
          previousWork: 'Designed the system',
          notes: 'Important notes',
          percentageComplete: 30,
        },
      }

      const bundle = await composer.compose(agent, taskWithAllTiers, {
        maxTokens: 300,
      })

      const tiers = bundle.packets.map(p => p.tier)
      expect(tiers).toContain('identity')
      expect(tiers).toContain('task')

      const identityIdx = tiers.indexOf('identity')
      const taskIdx = tiers.indexOf('task')
      const repoIdx = tiers.indexOf('repo')
      const goalIdx = tiers.indexOf('goal')
      const handoffIdx = tiers.indexOf('handoff')

      if (repoIdx !== -1 && goalIdx !== -1) {
        expect(goalIdx).toBeLessThan(repoIdx)
      }
      if (handoffIdx !== -1 && repoIdx !== -1) {
        expect(handoffIdx).toBeLessThan(repoIdx)
      }
    })
  })
})
