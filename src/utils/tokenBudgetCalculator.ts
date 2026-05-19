import { roughTokenCountEstimation, roughTokenCountEstimationForMessages } from '../services/tokenEstimation.js'
import type { Message } from '../types/message.js'
import { getContextWindowForModel } from './context.js'
import { getModelMaxOutputTokens } from './context.js'

/**
 * Token Budget Calculator
 *
 * Pre-computes available tokens after system prompt, tools, and history.
 * Useful for preventing context overflow before it happens.
 */
export interface TokenBudget {
  total: number
  systemPrompt: number
  tools: number
  history: number
  reserved: number
  available: number
}

export function calculateTokenBudget(options: {
  model: string
  systemPrompt?: string
  toolsSchema?: string
  historyMessages?: readonly Message[] | number
  outputBuffer?: number
}): TokenBudget {
  const contextWindow = getContextWindowForModel(options.model)

  const systemPromptTokens = options.systemPrompt
    ? roughTokenCountEstimation(options.systemPrompt)
    : 0

  const toolsTokens = options.toolsSchema
    ? roughTokenCountEstimation(options.toolsSchema)
    : 0

  let historyTokens: number
  if (typeof options.historyMessages === 'number') {
    historyTokens = options.historyMessages * 100
  } else if (Array.isArray(options.historyMessages)) {
    historyTokens = roughTokenCountEstimationForMessages(options.historyMessages)
  } else {
    historyTokens = 0
  }

  const modelMaxOutput = getModelMaxOutputTokens(options.model)
  const outputBuffer = options.outputBuffer ?? modelMaxOutput.default
  const used = systemPromptTokens + toolsTokens + historyTokens
  const available = Math.max(0, contextWindow - used - outputBuffer)

  return {
    total: contextWindow,
    systemPrompt: systemPromptTokens,
    tools: toolsTokens,
    history: historyTokens,
    reserved: outputBuffer,
    available,
  }
}
