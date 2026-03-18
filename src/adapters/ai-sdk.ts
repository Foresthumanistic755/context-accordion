// context-accordion — Vercel AI SDK adapter

import type { AccordionBundle } from '../types'

/**
 * Renders an AccordionBundle as a system prompt string
 * for use with the Vercel AI SDK.
 *
 * @param bundle - The accordion bundle containing packets to render as a system prompt.
 * @returns A string containing all packet contents joined by double newlines.
 * @example
 * import { accordionSystemPrompt } from 'context-accordion/ai-sdk'
 * const { text } = await generateText({
 *   model: openai('gpt-4o'),
 *   system: accordionSystemPrompt(bundle),
 *   prompt: userMessage,
 * })
 */
export function accordionSystemPrompt(bundle: AccordionBundle): string {
  return bundle.packets
    .map(p => p.content)
    .join('\n\n')
    .trim()
}
