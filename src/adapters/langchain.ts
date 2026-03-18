// context-accordion — LangChain adapter

import type { AccordionBundle, AccordionPacket } from '../types'

/**
 * Minimal Document shape — matches LangChain's Document interface
 * without requiring langchain as a dependency.
 *
 * @interface AccordionDocument
 */
export interface AccordionDocument {
  pageContent: string
  metadata: {
    tier: string
    priority: number
    summary: string
    tokenEstimate: number
  }
}

/**
 * Converts an AccordionBundle into an array of LangChain-compatible Documents.
 * Each packet becomes one Document, preserving tier metadata.
 *
 * @param bundle - The accordion bundle containing packets to convert.
 * @returns An array of AccordionDocument objects, one for each packet in the bundle.
 * @example
 * import { toDocuments } from 'context-accordion/langchain'
 * const docs = toDocuments(bundle)
 * const chain = RetrievalQAChain.fromLLM(llm, vectorStore.asRetriever())
 */
export function toDocuments(bundle: AccordionBundle): AccordionDocument[] {
  return bundle.packets.map((p: AccordionPacket) => ({
    pageContent: p.content,
    metadata: {
      tier: p.tier,
      priority: p.priority,
      summary: p.summary,
      tokenEstimate: Math.ceil(p.content.length / 4),
    },
  }))
}

/**
 * Renders the full bundle as a single string — useful as a
 * SystemMessage in a LangChain chat chain.
 *
 * @param bundle - The accordion bundle containing packets to render.
 * @returns A string containing all packet contents joined by double newlines.
 */
export function toSystemMessage(bundle: AccordionBundle): string {
  return bundle.packets.map(p => p.content).join('\n\n').trim()
}
