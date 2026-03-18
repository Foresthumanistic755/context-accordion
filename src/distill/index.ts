/**
 * Experience Distillation Module
 * 
 * Automatically extracts lessons from failed/partial runs and appends them to experience.md.
 * Uses Ollama's chat API to generate insights from failure scenarios.
 * 
 * @module distill
 */

import { readFileSync, appendFileSync, existsSync } from 'fs'

export interface DistillRun {
  taskId: string
  title: string
  description: string
  outcome: 'success' | 'failure' | 'partial'
  error?: string
  lessons?: string
}

export interface DistillOptions {
  runs: DistillRun[]
  experiencePath: string
  model: string
  ollamaUrl?: string
}

export interface DistillResult {
  added: string
  runsProcessed: number
  errors: string[]
}

/**
 * Distills lessons from failed/partial runs into experience.md.
 * 
 * Filters runs to only failed/partial outcomes, calls Ollama to generate
 * insights, and appends formatted lessons to the experience markdown file.
 * 
 * @example
 * ```typescript
 * import { distill } from 'context-accordion/distill'
 * 
 * await distill({
 *   runs: recentFailedRuns,
 *   experiencePath: './agents/builder/experience.md',
 *   model: 'ollama/deepseek-r1:8b',
 * })
 * ```
 * 
 * @param options - Configuration for distillation
 * @param options.runs - Array of runs to analyze
 * @param options.experiencePath - Path to experience.md file
 * @param options.model - Ollama model to use for generating insights
 * @param options.ollamaUrl - Ollama API URL (default: http://localhost:11434)
 * @returns Result containing added content and any errors
 */
export async function distill(options: DistillOptions): Promise<DistillResult> {
  const { runs, experiencePath, model, ollamaUrl = 'http://localhost:11434' } = options
  
  const failedRuns = runs.filter(run => run.outcome !== 'success')
  const errors: string[] = []
  
  if (failedRuns.length === 0) {
    return { added: '', runsProcessed: 0, errors: [] }
  }

  let distilledContent = ''

  for (const run of failedRuns) {
    try {
      const lessons = await generateLessons(run, model, ollamaUrl)
      
      const date = new Date().toISOString().split('T')[0]
      const entry = formatEntry(run, lessons, date)
      distilledContent += entry
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      errors.push(`Failed to generate lessons for task ${run.taskId}: ${errorMsg}`)
    }
  }

  if (distilledContent) {
    try {
      appendFileSync(experiencePath, distilledContent, 'utf-8')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      errors.push(`Failed to write to ${experiencePath}: ${errorMsg}`)
    }
  }

  return {
    added: distilledContent,
    runsProcessed: failedRuns.length,
    errors,
  }
}

async function generateLessons(run: DistillRun, model: string, ollamaUrl: string): Promise<string> {
  const prompt = buildPrompt(run)
  
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      stream: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as { message?: { content?: string } }
  
  if (!data.message?.content) {
    throw new Error('Invalid response from Ollama: missing message content')
  }

  return data.message.content.trim()
}

function buildPrompt(run: DistillRun): string {
  let prompt = `Analyze this failed/partial task and extract actionable lessons:\n\n`
  prompt += `Task: ${run.title}\n`
  prompt += `Description: ${run.description}\n`
  prompt += `Outcome: ${run.outcome}\n`
  
  if (run.error) {
    prompt += `Error: ${run.error}\n`
  }
  
  if (run.lessons) {
    prompt += `User notes: ${run.lessons}\n`
  }
  
  prompt += `\nProvide 2-4 specific, actionable lessons that could prevent this failure in the future. `
  prompt += `Format each lesson as a brief, practical tip.`
  
  return prompt
}

function formatEntry(run: DistillRun, llmLessons: string, date: string): string {
  let entry = `## Lessons — ${date}\n\n`
  entry += `### Task: ${run.title}\n`
  entry += `**Outcome:** ${run.outcome}\n`
  entry += `**What happened:** ${run.description}\n`
  
  if (run.error) {
    entry += `**Error:** ${run.error}\n`
  }
  
  entry += `**Lessons:** ${llmLessons}\n\n`
  entry += `---\n\n`
  
  return entry
}
