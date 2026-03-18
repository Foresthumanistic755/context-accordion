import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/ai-sdk': 'src/adapters/ai-sdk.ts',
    'adapters/langchain': 'src/adapters/langchain.ts',
    'distill/index': 'src/distill/index.ts',
    'embeddings/index': 'src/embeddings/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
})
