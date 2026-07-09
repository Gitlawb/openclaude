import {
  extractTaskSignals,
  type ExtractTaskSignalsInput,
  type TaskSignals,
} from './taskSignals.js'

export type TaskTier = 'trivial' | 'standard' | 'hard' | 'vision'

export type ComplexityResult = {
  tier: TaskTier
  signals: TaskSignals
  reasons: string[]
}

/**
 * Heuristic task complexity classifier.
 * Rule order is intentional (first match wins for special cases).
 */
export function classifyComplexity(
  input: ExtractTaskSignalsInput,
): ComplexityResult {
  const signals = extractTaskSignals(input)
  const reasons: string[] = []

  if (signals.hasImage || signals.visionKeywords) {
    reasons.push(
      signals.hasImage
        ? 'image attachment present'
        : 'vision-related keywords in prompt',
    )
    return { tier: 'vision', signals, reasons }
  }

  if (
    signals.architectureKeywords ||
    signals.hardTaskKeywords ||
    signals.multiFileHints
  ) {
    if (signals.architectureKeywords) reasons.push('architecture/redesign keywords')
    if (signals.hardTaskKeywords) reasons.push('hard debugging/ops keywords')
    if (signals.multiFileHints) reasons.push('multi-file / whole-project hints')
    return { tier: 'hard', signals, reasons }
  }

  // Very short prompts with no file path → trivial (greetings, one-liners)
  if (signals.charCount > 0 && signals.charCount < 80 && signals.pathMentions === 0) {
    reasons.push(`short prompt (${signals.charCount} chars) without path`)
    return { tier: 'trivial', signals, reasons }
  }

  if (signals.pathMentions > 0) {
    reasons.push(`${signals.pathMentions} path mention(s)`)
  }
  if (signals.readOnlyHints) {
    reasons.push('read-only intent hints')
  }
  if (reasons.length === 0) {
    reasons.push('default standard complexity')
  }

  return { tier: 'standard', signals, reasons }
}
