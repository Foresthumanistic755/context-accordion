# context-accordion — Publishing Checklist

Everything needed before the first public release. Ordered by dependency.
The final `npm publish` and GitHub push is done by the human owner.

---

## Stage 1 — Extract & Decouple (do first)

### 1.1 — Strip Harbor dependencies
- [ ] Remove all `@/lib/db` imports — replace with adapter interface
- [ ] Remove all `@/lib/agents/role-agent` imports — accept agent config as plain object
- [ ] Remove Drizzle ORM dependency entirely
- [ ] Remove `src/lib/db/schema` references
- [ ] `getBakedToolsForAgent()` — replace with optional config array, not a DB query
- [ ] Result: zero framework dependencies, zero DB dependencies

### 1.2 — Define clean public API
- [ ] `AccordionComposer` class — main entry point
- [ ] `compose(config)` — builds a PacketBundle
- [ ] `expand(bundle, options)` — on-demand tier expansion (implement the stub)
- [ ] `render(bundle)` — renders bundle to a prompt string
- [ ] `index(task)` — indexes a completed task into the vector store
- [ ] Export all types: `PacketBundle`, `PromptPacket`, `AccordionConfig`, `TierExpansion`

### 1.3 — Rename `PromptPacket` internal type
- [ ] Rename to `AccordionPacket` to avoid collision with other frameworks' types
- [ ] Update all internal references

---

## Stage 2 — Package Setup

### 2.1 — package.json
- [ ] Name: `context-accordion`
- [ ] Version: `0.1.0`
- [ ] Main: `dist/index.js`
- [ ] Types: `dist/index.d.ts`
- [ ] Exports map: `{ ".": "./dist/index.js", "./langchain": "./dist/adapters/langchain.js", "./ai-sdk": "./dist/adapters/ai-sdk.js" }`
- [ ] Peer deps: none (all optional)
- [ ] Keywords: `["ai", "agents", "context", "llm", "prompt-engineering", "rag", "token-efficiency"]`

### 2.2 — Build setup
- [ ] Add `tsup` for bundling (zero-config, outputs ESM + CJS + types)
- [ ] `tsup.config.ts` — entry: `src/index.ts`, format: `['esm', 'cjs']`, dts: true
- [ ] `tsconfig.json` — strict, target ES2022, moduleResolution bundler

### 2.3 — Dependencies
- [ ] `@qdrant/js-client-rest` — optional peer dep (only needed for L3)
- [ ] `uuid` — keep (tiny, no alternative needed)
- [ ] Everything else — zero runtime deps

---

## Stage 3 — Implement the Missing Pieces

### 3.1 — Real accordion expansion (the core mechanic — currently a stub)
- [ ] `expand(bundle, { tier, reason, limit })` — actually retrieves and injects content
- [ ] Session cache: expanded content stored in-memory for the run duration
- [ ] Re-expansion is free (cache hit)
- [ ] Emit `onExpand` event with tier, reason, tokens added

### 3.2 — Embedding provider abstraction
- [ ] Define `EmbeddingProvider` interface: `embed(text: string): Promise<number[]>`
- [ ] Built-in: `OllamaEmbedding` (uses `nomic-embed-text`, free, local)
- [ ] Built-in: `OpenAIEmbedding` (uses `text-embedding-3-small`)
- [ ] User can pass any custom provider

### 3.3 — Framework adapters
- [ ] `src/adapters/ai-sdk.ts` — `accordionSystemPrompt(bundle)` returns string for Vercel AI SDK
- [ ] `src/adapters/langchain.ts` — `AccordionContextLoader` as a LangChain document loader
- [ ] `src/adapters/raw.ts` — `render(bundle)` plain string, already exists

### 3.4 — Experience distillation helper
- [ ] `src/distill/index.ts` — `distill({ runs, experiencePath, model })` 
- [ ] Calls a local/remote LLM to synthesize lessons from failed runs
- [ ] Appends to `experience.md` with timestamp
- [ ] Optional — not required for core package

---

## Stage 4 — Tests

### 4.1 — Unit tests (vitest)
- [ ] `AccordionComposer.compose()` — correct tier ordering
- [ ] `enforceBudget()` — drops lowest priority first, never drops L0/L1
- [ ] `expand()` — returns expanded bundle with correct token delta
- [ ] `render()` — output string contains all packet content in order
- [ ] Cache TTL — expired cache returns fresh packet

### 4.2 — Integration tests
- [ ] Full compose → render → token count pipeline
- [ ] Qdrant integration test (requires running Qdrant — skip in CI if not available)
- [ ] Graceful degradation: Qdrant unreachable → L3 skipped, no throw

### 4.3 — CI
- [ ] GitHub Actions: `test.yml` — runs on push/PR, node 18 + 20
- [ ] No Qdrant in CI (mock the vector store)

---

## Stage 5 — Documentation

### 5.1 — README (already written — review before publish)
- [ ] Verify all code examples actually run against the final API
- [ ] Add benchmark: token usage comparison (accordion vs. naive dump)
- [ ] Add a real screenshot or ASCII diagram of the tier system

### 5.2 — CONTRIBUTING.md
- [ ] Setup instructions
- [ ] How to run tests
- [ ] PR guidelines

### 5.3 — CHANGELOG.md
- [ ] `0.1.0` — initial release entry

### 5.4 — JSDoc on all public methods
- [ ] `AccordionComposer` constructor
- [ ] `compose()`, `expand()`, `render()`, `index()`
- [ ] All exported types

---

## Stage 6 — Pre-publish Checklist

- [ ] `npm run build` — zero errors, zero type errors
- [ ] `npm run test` — all tests pass
- [ ] `npm pack` — inspect tarball, confirm only `dist/` and `README.md` are included
- [ ] `.npmignore` — exclude `src/`, `tests/`, `*.test.ts`, `todo.md`
- [ ] `package.json` `files` field set: `["dist", "README.md", "LICENSE"]`
- [ ] License file present: `LICENSE` (MIT)
- [ ] No secrets or `.env` files in the package
- [ ] `npm publish --dry-run` — confirm package name is available on npm

---

## Stage 7 — Launch

- [ ] Create GitHub repo: `context-accordion` (public)
- [ ] Push initial commit with message: `feat: initial release v0.1.0`
- [ ] Create GitHub release: tag `v0.1.0`, paste CHANGELOG entry
- [ ] `npm publish` (human does this step)
- [ ] Post on X/Twitter with demo snippet showing token savings
- [ ] Submit to:
  - [ ] [awesome-ai-agents](https://github.com/e2b-dev/awesome-ai-agents)
  - [ ] [awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps)
  - [ ] Hacker News Show HN post
  - [ ] r/LocalLLaMA

---

## Notes

- Keep the core zero-dependency. Qdrant, OpenAI, Ollama are all optional.
- The README benchmark (token savings) is the most important marketing asset — do this before launch.
- MIT license is the right call here (see license decision in Harbor docs).
