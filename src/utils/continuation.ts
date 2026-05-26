import { tokenCountWithEstimation } from './tokens.js'

/**
 * Heuristics to detect if the agent intends to continue its task
 * but stopped (potentially due to truncation or missed tool calls).
 */

export const CONTINUATION_SIGNALS = [
  // English: Action-transition phrases (requires intent + action)
  /\bso now (i|let me|we) (need to|have to|should|must|will) (do|create|write|edit|update|fix|implement|add|run|check|make|build|set up|start|begin|apply|identify|inspect|analyze|review|search)\b/i,
  /\bnow i('ll| will) (do|create|write|edit|update|fix|implement|add|run|check|make|build|set up|go|proceed|start|begin|apply|identify|inspect|analyze|review|search)\b/i,
  /\bi (will|shall|now|need to|have to|must|should) (now )?(do|create|write|edit|update|fix|implement|add|run|check|make|build|set up|go|proceed|start|begin|apply|identify|inspect|analyze|review|search)\b/i,
  /\blet me (go ahead and |now )?(do|create|write|edit|update|fix|implement|add|run|check|make|build|set up|proceed|start|begin|apply|update|create|identify|inspect|analyze|review|search|summarize)\b/i,
  /\btime to (do|create|write|edit|update|fix|implement|add|run|check|make|build|get started|begin|start|inspect|analyze|review|search)\b/i,
  /\b(moving on to|next step is to|starting to|proceeding to|applying (the|these) changes|inspecting|analyzing|reviewing|searching)\b/i,
  // French: Support for common continuation phrasing (relaxed boundaries for accents and apostrophes)
  /(^|\s)(je passe (à|au)|ensuite|l'étape suivante est de|je continue avec|au suivant|passons à|je reviens vers vous|je suis en train d'|je vais maintenant)(\s|$|[a-zà-ÿ])/i,
  /(^|\s)(je (vais|dois|dois maintenant|vais maintenant) (faire|créer|écrire|modifier|ajouter|tester|vérifier|lancer|exécuter|procéder|démarrer|commencer|identifier|analyser|inspecter|revoir|chercher))(\s|$|[a-zà-ÿ])/i,
  /(^|\s)((lancement|exécution|vérification|modification|mise à jour|analyse|inspection|recherche) de)(\s|$|[a-zà-ÿ])/i,
  // Universal: Sentence ending with a colon indicates intent to list/act
  /:\s*$/,
  // Universal: Open task marker indicates pending work
  /◻/,
]

export const COMPLETION_MARKERS = /\b(done|finished|completed|complete|summary|that's all|that is all|all set|hope this helps|let me know if|no issues|lgtm)\b/i

export type ContinuationResult = {
  shouldNudge: boolean
  reason?: 'possible_truncation' | 'continuation_signal'
}

export const UNFINISHED_SENTIMENT_SIGNALS = [
  // English trailing connectors
  /\b(and|with|the|to|of|for|at|by|in|on|a|an|is|are|was|were|my|your|his|her|its|our|their|if|as|but|or|so|which|that)\s*$/i,
  // French trailing connectors
  /\b(et|avec|le|la|les|un|une|de|du|des|pour|au|aux|dans|sur|par|à|en|si|car|mais|ou|donc|ni|que|ce|ma|ta|sa|mes|tes|ses|notre|votre|leur|nos|vos|leurs)\s*$/i,
  // Trailing non-terminal punctuation
  /[,;]\s*$/,
  // Unclosed code block starter
  /```[a-z]*\s*$/i,
]

/**
 * Analyzes assistant text to determine if a continuation nudge is required.
 */
export function analyzeContinuationIntent(
  text: string,
): ContinuationResult {
  const lastText = text.trim()
  if (lastText.length === 0) return { shouldNudge: false }
  
  const lowerText = lastText.toLowerCase()

  // 1. High-Confidence Structural Truncation signals (Strongest - Ignore completion markers)
  
  // Check for unclosed markdown code blocks
  const codeBlockCount = (lastText.match(/```/g) || []).length
  const hasUnclosedCodeBlock = codeBlockCount % 2 !== 0

  // Check for unclosed structural elements (brackets, parens, braces)
  const unclosedPairs = [['(', ')'], ['[', ']'], ['{', '}']]
  const hasUnclosedPair = unclosedPairs.some(([open, close]) => {
    const openCount = (lastText.match(new RegExp('\\' + open, 'g')) || []).length
    const closeCount = (lastText.match(new RegExp('\\' + close, 'g')) || []).length
    return openCount > closeCount
  })

  // Check for trailing connectors (e.g., "... and", "... with")
  const hasUnfinishedSuffix = UNFINISHED_SENTIMENT_SIGNALS.some(re => re.test(lastText))

  if (hasUnclosedCodeBlock || hasUnclosedPair || hasUnfinishedSuffix) {
    // Structural cut-offs always trigger a nudge, even if "done" was said earlier.
    return { shouldNudge: true, reason: 'possible_truncation' }
  }

  // 2. Late Intent-based signals (Overriding earlier completion markers)

  // Check if continuation signals match in the last 120 characters
  const lateWindowSize = 120
  const lateText = lowerText.slice(-lateWindowSize)
  
  const hasLateContinuationSignal = CONTINUATION_SIGNALS.some(re => {
    const match = lateText.match(re)
    if (!match) return false
    
    // Check if any completion marker follows THIS specific continuation signal in the late window
    const afterMatch = lateText.slice(match.index! + match[0].length)
    const hasLaterCompletion = COMPLETION_MARKERS.test(afterMatch)
    
    // Very strong action intents (I will now, Let me, Je vais) override any later markers
    const strongAction = /\b(let me|i will|i'll|je vais|je suis en train)\b/i.test(match[0])
    
    return strongAction || !hasLaterCompletion
  })

  if (hasLateContinuationSignal) {
    // If the sentence is punctuated but has a transition word, only nudge if 
    // it's a strong 1st person intent or open tasks are present.
    const hasTerminalPunctuation = /[.!??"'`)\]]\s*$/.test(lastText) || lastText.endsWith('`')
    if (hasTerminalPunctuation) {
      const strongIntent = /\b(i (will|shall|need to|must|should|now)|let (me|us)|je (vais|reviens)|passons à|moving on to|next step is to)\b/i.test(lowerText) || 
                           /je suis en train d'/i.test(lowerText) || /◻/.test(lastText)
      const endsWithColon = /:\s*$/.test(lastText)
      if (strongIntent || endsWithColon) {
        return { shouldNudge: true, reason: 'continuation_signal' }
      }
    } else {
      return { shouldNudge: true, reason: 'continuation_signal' }
    }
  }

  // 3. Completion Marker Guard (Final check for sound, completed messages)
  if (COMPLETION_MARKERS.test(lowerText)) {
    return { shouldNudge: false }
  }

  // Global fallback for unpunctuated signals (must be a clear transition)
  const hasTerminalPunctuation = /[.!??"'`)\]]\s*$/.test(lastText) || lastText.endsWith('`')
  if (
    CONTINUATION_SIGNALS.some(re => re.test(lowerText)) && 
    !hasTerminalPunctuation
  ) {
    return { shouldNudge: true, reason: 'continuation_signal' }
  }

  return { shouldNudge: false }
}
