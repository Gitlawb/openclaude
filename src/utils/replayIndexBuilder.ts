import type {
  ReplayIndex,
  ReplayStep,
  ReplaySummary,
  ReplayRetryStep,
  ReplayToolStep,
  ReplayUserStep,
} from 'src/types/logs.js'
import { stableStringify } from './stableStringify.js'

/**
 * Truncates a string to a maximum length, adding ellipsis if truncated.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

/**
 * Creates a human-readable summary of tool input based on tool name and parameters.
 */
function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read':
    case 'Glob':
    case 'Grep':
      return `${toolName} ${input.pattern ?? input.file_path ?? input.filePath ?? ''}`
    case 'Edit':
      return `Edit ${input.file_path ?? input.filePath ?? ''}`
    case 'Write':
      return `Write ${input.file_path ?? input.filePath ?? ''}`
    case 'Bash':
      return `Bash: ${truncate(String(input.command ?? ''), 50)}`
    case 'WebFetch':
      return `Fetch ${truncate(String(input.url ?? ''), 50)}`
    case 'WebSearch':
      return `Search: ${truncate(String(input.query ?? ''), 50)}`
    default:
      return toolName
  }
}

function getToolAttemptSignature(
  toolName: string,
  input: Record<string, unknown>,
): string {
  try {
    return `${toolName}:${stableStringify(input)}`
  } catch {
    return `${toolName}:${JSON.stringify(Object.keys(input).sort())}`
  }
}

/**
 * Builder class for constructing ReplayIndex during a session.
 * Tracks tool executions, user messages, and calculates summary statistics.
 */
export class ReplayIndexBuilder {
  private steps: ReplayStep[] = []
  private stepCounter = 0
  private toolStartTimes = new Map<string, number>()
  private toolInputs = new Map<string, Record<string, unknown>>()
  private toolRepeatedAttemptNumbers = new Map<string, number>()
  private signatureExecutionCounts = new Map<string, number>()
  private sessionStart: string = new Date().toISOString()

  /**
   * Track a user message arriving in the session.
   */
  trackUserMessage(content: string, timestamp: string): void {
    this.steps.push({
      type: 'user',
      stepNumber: ++this.stepCounter,
      content: truncate(typeof content === 'string' ? content : JSON.stringify(content), 200),
      timestamp,
    })
  }

  /**
   * Track the start of a tool execution.
   */
  trackToolStart(toolUseId: string, toolName: string, input: Record<string, unknown>): void {
    this.toolStartTimes.set(toolUseId, Date.now())
    this.toolInputs.set(toolUseId, input)
    const signature = getToolAttemptSignature(toolName, input)
    const repeatedAttemptNumber = (this.signatureExecutionCounts.get(signature) ?? 0) + 1
    this.signatureExecutionCounts.set(signature, repeatedAttemptNumber)
    this.toolRepeatedAttemptNumbers.set(toolUseId, repeatedAttemptNumber)
  }

  /**
   * Track the completion of a tool execution.
   */
  trackToolEnd(
    toolUseId: string,
    toolName: string,
    resultStatus: ReplayToolStep['resultStatus'],
    resultPreview?: string,
    filesModified?: string[],
  ): void {
    const startTime = this.toolStartTimes.get(toolUseId) ?? Date.now()
    const durationMs = Date.now() - startTime
    const input = this.toolInputs.get(toolUseId) ?? {}
    const repeatedAttemptNumber = this.toolRepeatedAttemptNumbers.get(toolUseId) ?? 1

    this.steps.push({
      type: 'tool',
      stepNumber: ++this.stepCounter,
      toolName,
      toolUseId,
      input,
      inputSummary: summarizeToolInput(toolName, input),
      resultStatus,
      resultPreview: resultPreview ? truncate(resultPreview, 200) : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
      filesModified,
      repeatedAttemptNumber,
      isRepeatedAttempt: repeatedAttemptNumber > 1,
    })

    // Cleanup
    this.toolStartTimes.delete(toolUseId)
    this.toolInputs.delete(toolUseId)
    this.toolRepeatedAttemptNumbers.delete(toolUseId)
  }

  /**
   * Track a real retry event emitted by the runtime.
   */
  trackRetry(
    retryType: ReplayRetryStep['retryType'],
    reason: string,
    timestamp: string,
    options: {
      attempt?: number
      maxRetries?: number
      retryDelayMs?: number
      commands?: string[]
    } = {},
  ): void {
    this.steps.push({
      type: 'retry',
      stepNumber: ++this.stepCounter,
      retryType,
      reason: truncate(reason, 200),
      timestamp,
      ...(options.attempt !== undefined && { attempt: options.attempt }),
      ...(options.maxRetries !== undefined && { maxRetries: options.maxRetries }),
      ...(options.retryDelayMs !== undefined && {
        retryDelayMs: options.retryDelayMs,
      }),
      ...(options.commands && { commands: options.commands }),
    })
  }

  /**
   * Track an error that occurred during execution.
   */
  trackError(error: string): void {
    this.steps.push({
      type: 'error',
      stepNumber: ++this.stepCounter,
      error,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Build the final ReplayIndex with summary statistics.
   */
  build(sessionId: string): ReplayIndex {
    return {
      sessionId,
      version: 1,
      createdAt: new Date().toISOString(),
      summary: this.calculateSummary(),
      steps: this.steps,
    }
  }

  /**
   * Calculate summary statistics from the tracked steps.
   */
  private calculateSummary(): ReplaySummary {
    const toolBreakdown: Record<string, number> = {}
    const filesModifiedSet = new Set<string>()
    let userRequests = 0
    let retryAttempts = 0
    let repeatedAttempts = 0

    for (const step of this.steps) {
      if (step.type === 'tool') {
        // Count tools by name
        toolBreakdown[step.toolName] = (toolBreakdown[step.toolName] ?? 0) + 1
        
        // Track modified files
        if (step.filesModified) {
          for (const file of step.filesModified) {
            filesModifiedSet.add(file)
          }
        }
        if (step.isRepeatedAttempt) {
          repeatedAttempts++
        }
      } else if (step.type === 'user') {
        userRequests++
      } else if (step.type === 'retry') {
        retryAttempts++
      }
    }

    const timestampValues = this.steps
      .map(step => Date.parse(step.timestamp))
      .filter(timestamp => Number.isFinite(timestamp))
    const startTimestamp =
      timestampValues.length > 0
        ? new Date(Math.min(...timestampValues)).toISOString()
        : this.sessionStart
    const endTimestamp =
      timestampValues.length > 0
        ? new Date(Math.max(...timestampValues)).toISOString()
        : new Date().toISOString()
    const durationMs =
      timestampValues.length > 0
        ? Math.max(0, Date.parse(endTimestamp) - Date.parse(startTimestamp))
        : 0

    return {
      totalSteps: this.steps.length,
      toolBreakdown,
      filesModified: Array.from(filesModifiedSet),
      durationMs,
      startTimestamp,
      endTimestamp,
      userRequests,
      retryAttempts,
      repeatedAttempts,
    }
  }

  /**
   * Get current step count (for debugging/status).
   */
  get stepCount(): number {
    return this.stepCounter
  }
}
