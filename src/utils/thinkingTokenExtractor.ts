/**
 * Thinking Token Extractor - Production-grade thinking token analysis
 * 
 * Extracts and analyzes thinking tokens from assistant messages.
 * Provides detailed breakdown, statistics, and insights.
 */

import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import { jsonStringify } from './slowOperations.js'
import type { AssistantMessage, Message } from '../types/message.js'

export interface ThinkingBlock {
  type: 'thinking' | 'redacted_thinking'
  content: string
  tokens: number
}

export interface OutputBlock {
  type: 'text' | 'tool_use'
  content: string
  tokens: number
}

export interface ThinkingTokenBreakdown {
  thinking: number
  output: number
  total: number
  thinkingBlocks: ThinkingBlock[]
  outputBlocks: OutputBlock[]
}

export interface ThinkingAnalysis {
  hasThinking: boolean
  thinkingPercentage: number
  outputPercentage: number
  blockCount: number
  avgThinkingBlockSize: number
  avgOutputBlockSize: number
  totalTextLength: number
  reasoningComplexity: 'low' | 'medium' | 'high'
}

export class ThinkingTokenAnalyzer {
  /**
   * Extract detailed thinking vs output breakdown
   */
  static extract(message: AssistantMessage): ThinkingTokenBreakdown {
    const thinkingBlocks: ThinkingBlock[] = []
    const outputBlocks: OutputBlock[] = []
    let thinking = 0
    let output = 0

    for (const block of message.message.content) {
      if (block.type === 'thinking') {
        const tokens = roughTokenCountEstimation(block.thinking)
        thinking += tokens
        thinkingBlocks.push({
          type: 'thinking',
          content: block.thinking,
          tokens,
        })
      } else if (block.type === 'redacted_thinking') {
        const tokens = roughTokenCountEstimation(block.data)
        thinking += tokens
        thinkingBlocks.push({
          type: 'redacted_thinking',
          content: block.data,
          tokens,
        })
      } else if (block.type === 'text') {
        const tokens = roughTokenCountEstimation(block.text)
        output += tokens
        outputBlocks.push({
          type: 'text',
          content: block.text,
          tokens,
        })
      } else if (block.type === 'tool_use') {
        const content = jsonStringify(block.input)
        const tokens = roughTokenCountEstimation(content)
        output += tokens
        outputBlocks.push({
          type: 'tool_use',
          content,
          tokens,
        })
      }
    }

    return {
      thinking,
      output,
      total: thinking + output,
      thinkingBlocks,
      outputBlocks,
    }
  }

  /**
   * Simple extraction for quick use
   */
  static extractSimple(message: AssistantMessage): ThinkingTokenBreakdown {
    return this.extract(message)
  }

  /**
   * Analyze thinking patterns and provide insights
   */
  static analyze(message: AssistantMessage): ThinkingAnalysis {
    const breakdown = this.extract(message)
    const { thinking, output, total, thinkingBlocks, outputBlocks } = breakdown

    const hasThinking = thinking > 0
    const thinkingPercentage = total > 0 ? (thinking / total) * 100 : 0
    const outputPercentage = total > 0 ? (output / total) * 100 : 0

    const avgThinkingBlockSize = thinkingBlocks.length > 0
      ? thinkingBlocks.reduce((sum, b) => sum + b.tokens, 0) / thinkingBlocks.length
      : 0

    const avgOutputBlockSize = outputBlocks.length > 0
      ? outputBlocks.reduce((sum, b) => sum + b.tokens, 0) / outputBlocks.length
      : 0

    const totalTextLength = [...thinkingBlocks, ...outputBlocks].reduce(
      (sum, b) => sum + b.content.length,
      0,
    )

    // Complexity based on thinking percentage and block count
    let reasoningComplexity: 'low' | 'medium' | 'high' = 'low'
    if (thinkingPercentage > 30 || thinkingBlocks.length > 5) {
      reasoningComplexity = 'high'
    } else if (thinkingPercentage > 10 || thinkingBlocks.length > 2) {
      reasoningComplexity = 'medium'
    }

    return {
      hasThinking,
      thinkingPercentage: Math.round(thinkingPercentage * 10) / 10,
      outputPercentage: Math.round(outputPercentage * 10) / 10,
      blockCount: thinkingBlocks.length + outputBlocks.length,
      avgThinkingBlockSize: Math.round(avgThinkingBlockSize),
      avgOutputBlockSize: Math.round(avgOutputBlockSize),
      totalTextLength,
      reasoningComplexity,
    }
  }

  /**
   * Check if message has significant thinking
   */
  static hasSignificantThinking(
    message: AssistantMessage,
    thresholdPercent = 20,
  ): boolean {
    const analysis = this.analyze(message)
    return analysis.thinkingPercentage >= thresholdPercent
  }

  /**
   * Get thinking-only messages from an array
   */
  static filterThinkingMessages(messages: Message[]): AssistantMessage[] {
    return messages
      .filter((m): m is AssistantMessage => m.type === 'assistant')
      .filter(m => this.hasSignificantThinking(m))
  }

  /**
   * Calculate total thinking tokens across messages
   */
  static totalThinkingTokens(messages: Message[]): number {
    return messages
      .filter((m): m is AssistantMessage => m.type === 'assistant')
      .reduce((sum, m) => sum + this.extract(m).thinking, 0)
  }
}

/**
 * Legacy export for backward compatibility
 */
export function extractThinkingTokens(
  message: AssistantMessage,
): { thinking: number; output: number; total: number } {
  const result = ThinkingTokenAnalyzer.extract(message)
  return {
    thinking: result.thinking,
    output: result.output,
    total: result.total,
  }
}