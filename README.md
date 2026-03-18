# context-accordion

> Token-efficient, layered context delivery for AI agents.

Context is always available — just collapsed by default. Like an accordion: all the notes exist, you only press the ones you need right now.

Built by the [Harbor](https://github.com/harbor-office/harbor) team. Inspired by the problem of agents drowning in context they didn't ask for.

---

## The Problem

Every AI agent framework today does one of two things:

1. **Dump everything** — shove the full history, full codebase, full goal tree into every prompt. Expensive, slow, hits context limits fast.
2. **Summarize and forget** — compress context down to a summary and throw away the original. Cheap, but the agent can never go deeper when it needs to.

Both are wrong. The full content should never be discarded — it should be *collapsed*, retrievable on demand.

## The Solution: Context Accordion

Four memory tiers. Each tier is always available but only loaded when needed:

```
L0  Identity       — always loaded    ~500 tokens    who am I, what can I do
L1  Session        — always loaded    ~2000 tokens   what am I doing right now
L2  Experience     — loaded on start  ~1000 tokens   what have I learned before
L3  Archive        — retrieved        ~1500 tokens   what happened in similar past runs
```

The agent starts with L0 + L1. It can expand L2 and L3 at any point during a run. Budget enforcement ensures the total never exceeds the model's context window.

With the Accordion, you start at ~500 tokens (L0+L1) vs ~5000+ for a naive dump.
The agent expands tiers on-demand, typically adding 500-2000 tokens when needed.

This is different from RAG. RAG retrieves documents. The Accordion retrieves *structured context tiers* — each with a known token budget, priority, and expansion policy.

---

## Install

```bash
npm install context-accordion
# or
bun add context-accordion
```

---

## Quick Start

```typescript
import { AccordionComposer } from 'context-accordion'

const composer = new AccordionComposer({
  maxTokens: 8000,
  vectorStore: {
    url: process.env.QDRANT_URL, // optional — enables L3 archive tier
  },
})

// Compose context for an agent run
const bundle = await composer.compose(
  {
    id: 'builder',
    identity: 'You are a senior software engineer. You write clean, tested code.',
    experiencePath: './agents/builder/experience.md', // L2 — learned lessons
  },
  {
    id: 'issue-123',
    title: 'Fix authentication bug in login flow',
    description: 'Users are getting logged out after 5 minutes...',
    priority: 'high',
    type: 'bug',
  },
  {
    includePriorTasks: true, // triggers L3 semantic retrieval
  },
)

// bundle.packets — ordered, budget-enforced context packets
// bundle.totalTokens — actual token usage
// bundle.maxTokens — budget ceiling

// Render to a prompt string
const prompt = composer.render(bundle)
```

---

## Accordion Expansion (On-Demand Retrieval)

The agent can request deeper context mid-run:

```typescript
// Expand a specific tier during a run
const expanded = await composer.expand(bundle, {
  tier: 'archive',       // L3 — pull from vector store
  reason: 'Need to check how similar auth bugs were fixed before',
  limit: 5,
})

// Or expand experience tier
const withExperience = await composer.expand(bundle, {
  tier: 'experience',    // L2 — load full experience.md
  experiencePath: './agents/builder/experience.md', // required for experience tier
})
```

All expansion events are logged so you can see exactly what context the agent actually needed.

---

## Token Budget Enforcement

Packets are priority-ordered. If the total exceeds `maxTokens`, lower-priority packets are truncated or dropped — never the identity or active task.

```
Priority order (highest → lowest):
100  Identity      — never dropped
90   Handoff       — dropped last
85   Experience    — dropped before handoff
80   Task/Issue    — never dropped
70   Goal          — dropped before task
60   Repository    — dropped before goal
50   Archive       — dropped first
```

---

## Vector Store (L3 Archive)

The archive tier uses Qdrant for semantic retrieval of relevant prior tasks. When an agent starts a new task, the top-N most similar past tasks are retrieved and injected as context.

```typescript
// Index a completed task
await composer.index({
  taskId: 'issue-123',
  content: 'Fixed auth bug by extending JWT expiry...',
  metadata: { type: 'bug', resolution: 'fixed' },
})

// Retrieval happens automatically during compose() when includePriorTasks: true
```

Qdrant is optional. If `vectorStore` is not configured, L3 is silently skipped.

---

## Embedding Providers

For L3 archive retrieval, configure an embedding provider:

```typescript
import { AccordionComposer, OllamaEmbedding } from 'context-accordion'

const composer = new AccordionComposer({
  maxTokens: 8000,
  vectorStore: { url: 'http://localhost:6333' },
  embeddingProvider: new OllamaEmbedding(), // or new OpenAIEmbedding()
})
```

---

## Framework Adapters

Works with any agent framework:

```typescript
// LangChain
import { toDocuments, toSystemMessage } from 'context-accordion/langchain'
const docs = toDocuments(bundle)

// Vercel AI SDK
import { accordionSystemPrompt } from 'context-accordion/ai-sdk'

// Raw string (any framework)
const systemPrompt = composer.render(bundle)
```

---

## Experience Distillation (L2)

The L2 tier is a plain markdown file that accumulates learned lessons over time. You write to it however you want — manually, or via an automated distillation loop:

```typescript
import { distill } from 'context-accordion/distill'

// After a batch of runs, distill lessons into experience.md
await distill({
  runs: recentFailedRuns,
  experiencePath: './agents/builder/experience.md',
  model: 'ollama/deepseek-r1:8b', // cheap local model is fine
})
```

---

## Configuration

```typescript
const composer = new AccordionComposer({
  maxTokens: 8000,           // default token budget
  cacheTtl: 300_000,         // ms — cache static packets (default: 5 min)
  vectorStore: {
    url: 'http://localhost:6333',
    collection: 'tasks',
    vectorSize: 1536,
  },
  onExpand: (event) => {     // hook — log expansion events
    console.log(`Agent expanded ${event.tier}: ${event.reason}`)
  },
})
```

---

## Why not just use a long context window?

You could. But:
- Long context = slower inference, higher cost
- Models attend poorly to content buried in the middle of huge prompts
- You lose visibility into what context the agent actually used
- Budget enforcement forces you to think about what context actually matters

The Accordion gives you the best of both worlds: full recall when needed, minimal tokens by default.

---

## License

MIT — use it in anything, commercial or otherwise.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome.

Built with ❤️ by the Harbor team.
