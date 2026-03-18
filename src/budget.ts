// context-accordion — token budget enforcement

import type { AccordionPacket } from './types'

/**
 * Estimates the number of tokens in a given text using a character-based approximation.
 * Uses the standard 4 characters per token ratio (GPT-style tokenization).
 * @param text - The input string to estimate tokens for
 * @returns The estimated token count
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Enforces a token budget across a set of accordion packets.
 * Packets are sorted by priority in descending order (highest priority first).
 * Lower-priority packets are truncated or dropped to fit within the maxTokens limit.
 * @param packets - The array of AccordionPacket objects to process
 * @param maxTokens - The maximum token budget allowed
 * @returns A new array of packets that fit within the token budget
 */
export function enforceBudget(
  packets: AccordionPacket[],
  maxTokens: number
): AccordionPacket[] {
  const neverDropPackets = packets.filter(p => p.tier === 'identity' || p.tier === 'task')
  const canDropPackets = packets.filter(p => p.tier !== 'identity' && p.tier !== 'task')

  // Sort can-drop by priority (highest first)
  const sortedCanDrop = [...canDropPackets].sort((a, b) => b.priority - a.priority)
  
  const result: AccordionPacket[] = []
  let currentTokens = 0
  
  // First add never-drop packets (they're never dropped, but CAN be truncated)
  for (const packet of neverDropPackets) {
    const packetTokens = estimateTokens(packet.content)
    
    // Never-drop packets are ALWAYS added (but can be truncated)
    if (currentTokens + packetTokens <= maxTokens) {
      result.push(packet)
      currentTokens += packetTokens
    } else {
      // Add truncated version - use remaining budget or at least some content
      const remaining = Math.max(0, maxTokens - currentTokens)
      const content = remaining > 0 
        ? packet.content.slice(0, remaining * 4) + '\n\n[Truncated — token budget reached]'
        : packet.content.slice(0, 200) + '\n\n[Truncated — token budget reached]'
      
      result.push({ ...packet, content })
      currentTokens += Math.min(packetTokens, remaining > 0 ? remaining : 200)
    }
  }
  
  // Then add can-drop packets as budget allows
  for (const packet of sortedCanDrop) {
    const packetTokens = estimateTokens(packet.content)
    
    if (currentTokens + packetTokens <= maxTokens) {
      result.push(packet)
      currentTokens += packetTokens
    } else {
      const remaining = maxTokens - currentTokens
      // Keep if at least 200 tokens remain — truncate rather than drop
      if (remaining >= 200) {
        result.push({
          ...packet,
          content: packet.content.slice(0, remaining * 4) + '\n\n[Truncated — token budget reached]',
        })
        currentTokens += remaining
      }
      // Budget exhausted
      break
    }
  }
  
  return result
}

/**
 * Priority mapping for packet tiers. Higher values indicate higher priority.
 * Packets with higher priority are retained first when enforcing token budgets.
 * Identity and Task tiers are never dropped (priority >= 80).
 */
export const TIER_PRIORITY: Record<string, number> = {
  identity:   100,  // never dropped
  handoff:     90,  // agent-to-agent continuity
  experience:  85,  // learned lessons
  task:        80,  // the actual work — never dropped
  goal:        70,  // broader objective
  repo:        60,  // codebase context
  archive:     50,  // prior similar tasks — dropped first
}
