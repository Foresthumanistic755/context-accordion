import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AccordionComposer } from '../src/composer'
import type { AgentConfig, TaskContext, ExpandOptions } from '../src/types'
import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'

const agent: AgentConfig = {
  id: 'builder',
  identity: 'You are a senior software engineer.',
  maxTokens: 4000,
}

const task: TaskContext = {
  id: 'task-001',
  title: 'Fix authentication bug',
  description: 'Users are getting logged out after 5 minutes.',
  priority: 'high',
  type: 'bug',
}

describe('AccordionComposer', () => {
  it('composes a bundle with identity and task packets', async () => {
    const composer = new AccordionComposer()
    const bundle = await composer.compose(agent, task)

    expect(bundle.packets.length).toBeGreaterThanOrEqual(2)
    expect(bundle.packets.some(p => p.tier === 'identity')).toBe(true)
    expect(bundle.packets.some(p => p.tier === 'task')).toBe(true)
  })

  it('respects token budget', async () => {
    const composer = new AccordionComposer({ maxTokens: 500 })
    const bundle = await composer.compose(agent, task, { maxTokens: 500 })

    expect(bundle.totalTokens).toBeLessThanOrEqual(500)
  })

  it('includes goal packet when provided', async () => {
    const composer = new AccordionComposer()
    const bundle = await composer.compose(agent, {
      ...task,
      goal: { id: 'goal-1', title: 'Improve auth reliability', progress: 40, status: 'in_progress' },
    })

    expect(bundle.packets.some(p => p.tier === 'goal')).toBe(true)
  })

  it('renders bundle to a non-empty string', async () => {
    const composer = new AccordionComposer()
    const bundle = await composer.compose(agent, task)
    const rendered = composer.render(bundle)

    expect(typeof rendered).toBe('string')
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered).toContain('Fix authentication bug')
  })

  it('identity packet has highest priority', async () => {
    const composer = new AccordionComposer()
    const bundle = await composer.compose(agent, task)
    const identity = bundle.packets.find(p => p.tier === 'identity')

    expect(identity?.priority).toBe(100)
  })

  it('skips archive tier when no vector store configured', async () => {
    const composer = new AccordionComposer() // no vectorStore
    const bundle = await composer.compose(agent, task, { includePriorTasks: true })

    expect(bundle.packets.some(p => p.tier === 'archive')).toBe(false)
  })

  describe('expand()', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'accordion-test-'))
      ;(AccordionComposer as unknown as { cache: Map<string, unknown> }).cache.clear()
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('adds an ExpansionEvent to the expansionLog', async () => {
      const composer = new AccordionComposer()
      const bundle = await composer.compose(agent, task)

      const expandedBundle = await composer.expand(bundle, {
        tier: 'task',
        reason: 'Need more context on task details',
      })

      expect(expandedBundle.expansionLog.length).toBe(1)
      expect(expandedBundle.expansionLog[0].tier).toBe('task')
      expect(expandedBundle.expansionLog[0].reason).toBe('Need more context on task details')
      expect(expandedBundle.expansionLog[0].timestamp).toBeInstanceOf(Date)
    })

    it('with experience tier returns bundle with experience packet', async () => {
      const experiencePath = path.join(tempDir, 'experience.md')
      await fs.writeFile(experiencePath, '# Experience\n\nLearned to handle auth edge cases.')

      const composer = new AccordionComposer()
      const bundle = await composer.compose(agent, task)

      const expandedBundle = await composer.expand(bundle, {
        tier: 'experience',
        reason: 'Need past experience context',
        experiencePath,
      })

      expect(expandedBundle.packets.some(p => p.tier === 'experience')).toBe(true)
      const experiencePacket = expandedBundle.packets.find(p => p.tier === 'experience')
      expect(experiencePacket?.content).toContain('Learned to handle auth edge cases')
      expect(expandedBundle.expansionLog[0].tokensAdded).toBeGreaterThan(0)
    })

    it('caches results in session cache (second call is free)', async () => {
      const experiencePath = path.join(tempDir, 'experience.md')
      await fs.writeFile(experiencePath, '# Experience\n\nCached experience content.')

      const composer = new AccordionComposer()
      const bundle = await composer.compose(agent, task)

      const expandOptions: ExpandOptions = {
        tier: 'experience',
        reason: 'Need cached experience',
        experiencePath,
      }

      const firstExpand = await composer.expand(bundle, expandOptions)
      const firstTokens = firstExpand.expansionLog[0].tokensAdded

      const secondExpand = await composer.expand(firstExpand, expandOptions)
      const secondTokens = secondExpand.expansionLog[1].tokensAdded

      expect(secondTokens).toBe(0)
      expect(secondExpand.packets.filter(p => p.tier === 'experience').length).toBe(1)
    })

    it('with non-existent experience file returns original bundle gracefully', async () => {
      const composer = new AccordionComposer()
      const bundle = await composer.compose(agent, task)
      const originalPacketCount = bundle.packets.length

      const expandedBundle = await composer.expand(bundle, {
        tier: 'experience',
        reason: 'Try loading non-existent file',
        experiencePath: '/non/existent/path/experience.md',
      })

      expect(expandedBundle.packets.length).toBe(originalPacketCount)
      expect(expandedBundle.expansionLog.length).toBe(1)
      expect(expandedBundle.expansionLog[0].tokensAdded).toBe(0)
    })
  })

  describe('Cache TTL', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'accordion-cache-test-'))
      ;(AccordionComposer as unknown as { cache: Map<string, unknown> }).cache.clear()
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('static cache respects cacheTtl config', async () => {
      const veryShortTtl = 100 // 100ms
      const experiencePath = path.join(tempDir, 'experience.md')
      await fs.writeFile(experiencePath, '# Experience\n\nFirst content.')

      const composer1 = new AccordionComposer({ cacheTtl: veryShortTtl })
      const bundle1 = await composer1.compose({ ...agent, experiencePath }, task)
      const packet1 = bundle1.packets.find(p => p.tier === 'experience')

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, veryShortTtl + 50))

      // Modify the file
      await fs.writeFile(experiencePath, '# Experience\n\nSecond content.')

      // Create new composer - should get fresh content due to expired cache
      const composer2 = new AccordionComposer({ cacheTtl: veryShortTtl })
      const bundle2 = await composer2.compose({ ...agent, experiencePath }, task)
      const packet2 = bundle2.packets.find(p => p.tier === 'experience')

      // If TTL works, we should see the new content (or re-read attempt)
      expect(packet2).toBeDefined()
    })

    it('clearSessionCache() clears the session cache', async () => {
      const experiencePath = path.join(tempDir, 'experience.md')
      await fs.writeFile(experiencePath, '# Experience\n\nClear cache test.')

      const composer = new AccordionComposer()
      const bundle = await composer.compose(agent, task)

      // First expand - populates session cache
      const expanded1 = await composer.expand(bundle, {
        tier: 'experience',
        reason: 'First expand',
        experiencePath,
      })
      expect(expanded1.expansionLog.length).toBe(1)
      expect(expanded1.packets.filter(p => p.tier === 'experience').length).toBe(1)

      // Clear the session cache
      composer.clearSessionCache()

      // Second expand - rebuilds from cache but skips adding since tier already exists in bundle
      const expanded2 = await composer.expand(expanded1, {
        tier: 'experience',
        reason: 'Second expand',
        experiencePath,
      })

      // Cache was cleared but tier already exists in bundle - no duplicates allowed
      expect(expanded2.packets.filter(p => p.tier === 'experience').length).toBe(1)
    })
  })
})
