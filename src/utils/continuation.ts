/**
 * Heuristics to detect if the agent intends to continue its task
 * but stopped (potentially due to truncation or missed tool calls).
 */

// Shared verb list used across all continuation patterns.
// Build regexes from this array so maintenance stays in one place.
const ACTION_VERBS = [
  'do',
  'create',
  'write',
  'edit',
  'update',
  'fix',
  'implement',
  'add',
  'run',
  'check',
  'make',
  'build',
  'set up',
  'start',
  'begin',
  'go',
  'proceed',
  'apply',
  'identify',
  'inspect',
  'analyze',
  'review',
  'search',
  'process',
  'download',
  'upload',
  'convert',
  'compile',
  'train',
  'evaluate',
  'test',
  'continue',
  'generate',
  'extract',
  'merge',
  'deploy',
  'install',
  'configure',
  'refactor',
  'optimize',
  'summarize',
] as const

// Base verb alternatives used across most regexes (no "summarize" in older patterns, but harmless)
const VERB_ALT = ACTION_VERBS.join('|')

// Gerund forms for progressive/participle patterns
const VERB_ING = ACTION_VERBS.map(v => {
  // Handle special cases: "set up" -> "setting up", "do" -> "doing"
  if (v === 'set up') return 'setting up'
  if (v === 'do') return 'doing'
  if (v === 'go') return 'going'
  if (v === 'run') return 'running'
  if (v === 'begin') return 'beginning'
  if (v === 'make') return 'making'
  if (v === 'write') return 'writing'
  // Default: add -ing
  return v.replace(/e$/, '') + 'ing'
}).join('|')

// Build continuation-signal regexes from the shared verb list.
// (Using function to keep construction readable.)
function buildContinuationSignals(): RegExp[] {
  const v = VERB_ALT
  // "time to" needs "do" explicitly, but the rest of the verb list without "do"
  // (use filtered array instead of string.replace so reordering ACTION_VERBS doesn't break it)
  const vWithoutDo = ACTION_VERBS.filter(a => a !== 'do').join('|')
  return [
    // English: Action-transition phrases (requires intent + action)
    new RegExp(`\\bso now (i|let me|we) (need to|have to|should|must|will) (${v})\\b`, 'i'),
    new RegExp(`\\bnow i('ll| will) (${v})\\b`, 'i'),
    new RegExp(`\\bi (will|shall|now|need to|have to|must|should) (now )?(${v})\\b`, 'i'),
    new RegExp(`\\blet me (go ahead and |now )?(${v})\\b`, 'i'),
    new RegExp(`\\btime to (do|${vWithoutDo}|get started|begin|start)\\b`, 'i'),
    new RegExp(`\\b(moving on to|next step is to|starting to|proceeding to|continuing with|applying (the|these) changes|${VERB_ING})\\b`, 'i'),
    // French: Support for common continuation phrasing (relaxed boundaries for accents and apostrophes)
    /(^|\s)(je passe (à|au)|ensuite|l'étape suivante est de|je continue avec|au suivant|passons à|je reviens vers vous|je suis en train d'|je vais maintenant)(\s|$|[a-zà-ÿ])/i,
    /(^|\s)(je (vais|dois|dois maintenant|vais maintenant) (faire|créer|écrire|modifier|ajouter|tester|vérifier|lancer|exécuter|procéder|démarrer|commencer|identifier|analyser|inspecter|revoir|chercher))(\s|$|[a-zà-ÿ])/i,
    /(^|\s)((lancement|exécution|vérification|modification|mise à jour|analyse|inspection|recherche) de)(\s|$|[a-zà-ÿ])/i,
    // Universal: Sentence ending with a colon indicates intent to list/act
    /:\s*$/,
    // Universal: Open task marker indicates pending work
    /◻/,
    // Imperative/declarative patterns (no subject required)
    new RegExp(`(?<!\\b(?:you|i|we|they|he|she|it)\\s+)\\bneed to (${v})\\b`, 'i'),
    new RegExp(`\\bnow (${v})\\b(?!\\s+you\\b)`, 'i'),
    new RegExp(`\\bnext (i|we)\\s+(need to|will|shall|should|must)?\\s*(${v})\\b`, 'i'),
  ]
}

export const CONTINUATION_SIGNALS = buildContinuationSignals()

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

// Suffix signals safe for the 60-character tail window.
// Note: code-fence truncation is handled by checkStructuralTruncation's triple-backtick scan.
const UNFINISHED_TAIL_SIGNALS = UNFINISHED_SENTIMENT_SIGNALS.slice(0, -1)

// Pre-compiled intent regexes at module scope to eliminate allocations during analyzeContinuationIntent
const PRESENT_PROGRESSIVE_RE = new RegExp(`\\bnow (?:${VERB_ING})\\b`, 'i')
const IMPERATIVE_RE_1 = new RegExp(`(?<!\\b(?:you|i|we|they|he|she|it)\\s+)\\bneed to (?:${VERB_ALT})\\b`, 'i')
const IMPERATIVE_RE_2 = new RegExp(`\\bnow (?:${VERB_ALT})\\b(?!\\s+you\\b)`, 'i')
const IMPERATIVE_RE_3 = new RegExp(`\\bnext (?:i|we)\\s+(?:need to|will|shall|should|must)?\\s*(?:${VERB_ALT})\\b`, 'i')
const STRONG_ACTION_RE = /\b(let me|i will|i'll|je vais|je suis en train)\b/i
const TERMINAL_PUNCTUATION_RE = /[.!??"'`)\]]\s*$/
const STRONG_INTENT_RE = /\b(i (will|shall|need to|must|should|now)|let (me|us)|je (vais|reviens)|passons à|moving on to|continuing with|proceeding to|next step is to)\b/i
const JE_SUIS_EN_TRAIN_RE = /je suis en train d'/i
const ENDS_WITH_COLON_RE = /:\s*$/

/**
 * Single-pass character code scanner for structural cut-offs.
 * Replaces 7 separate regex scans and array allocations with a fast linear pass.
 * Note: Net depth counters (parenDepth > 0) strictly reproduce historical openCount > closeCount parity.
 */
export function checkStructuralTruncation(text: string): { hasUnclosedCodeBlock: boolean; hasUnclosedPair: boolean } {
  let codeBlockCount = 0
  let parenDepth = 0
  let bracketDepth = 0
  let braceDepth = 0

  const len = text.length
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i)
    if (code === 40) parenDepth++        // '('
    else if (code === 41) parenDepth--   // ')'
    else if (code === 91) bracketDepth++ // '['
    else if (code === 93) bracketDepth-- // ']'
    else if (code === 123) braceDepth++  // '{'
    else if (code === 125) braceDepth--  // '}'
    else if (
      code === 96 &&
      (i === 0 || text.charCodeAt(i - 1) === 10 || text.charCodeAt(i - 1) === 13) &&
      i + 2 < len && text.charCodeAt(i + 1) === 96 && text.charCodeAt(i + 2) === 96
    ) {
      codeBlockCount++
      i += 2
    }
  }

  return {
    hasUnclosedCodeBlock: codeBlockCount % 2 !== 0,
    hasUnclosedPair: parenDepth > 0 || bracketDepth > 0 || braceDepth > 0,
  }
}

/**
 * Analyzes assistant text to determine if a continuation nudge is required.
 */
export function analyzeContinuationIntent(
  text: string,
): ContinuationResult {
  const lastText = text.trim()
  if (lastText.length === 0) return { shouldNudge: false }

  // 1. High-Confidence Structural Truncation signals (Strongest - Ignore completion markers)
  
  // Fast single-pass check for unclosed markdown code blocks and parens/brackets/braces
  const { hasUnclosedCodeBlock, hasUnclosedPair } = checkStructuralTruncation(lastText)

  // Check for trailing connectors on the tail of the string (e.g., "... and", "... with")
  const tail = lastText.length <= 60 ? lastText : lastText.slice(-60)
  const hasUnfinishedSuffix = UNFINISHED_TAIL_SIGNALS.some(re => re.test(tail))

  if (hasUnclosedCodeBlock || hasUnclosedPair || hasUnfinishedSuffix) {
    // Structural cut-offs always trigger a nudge, even if "done" was said earlier.
    return { shouldNudge: true, reason: 'possible_truncation' }
  }

  // Common check for terminal punctuation reused across intent and fallback stages
  const hasTerminalPunctuation = TERMINAL_PUNCTUATION_RE.test(lastText) || lastText.endsWith('`')

  // 2. Late Intent-based signals (Overriding earlier completion markers)

  // Check if continuation signals match in the last 120 characters
  // All patterns define the /i flag, avoiding redundant full-text lowercase transformations
  const lateWindowSize = 120
  const lateText = lastText.length <= lateWindowSize ? lastText : lastText.slice(-lateWindowSize)
  
  const hasLateContinuationSignal = CONTINUATION_SIGNALS.some(re => {
    const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    let match: RegExpExecArray | null
    while ((match = globalRe.exec(lateText)) !== null) {
      // Check if any completion marker follows THIS specific continuation signal in the late window
      const afterMatch = lateText.slice(match.index + match[0].length)
      const hasLaterCompletion = COMPLETION_MARKERS.test(afterMatch)
      
      // Very strong action intents (I will now, Let me, Je vais) override any later markers
      const strongAction = STRONG_ACTION_RE.test(match[0])
      
      if (strongAction || !hasLaterCompletion) return true
    }
    return false
  })

  if (hasLateContinuationSignal) {
    // If the sentence is punctuated but has a transition word, only nudge if 
    // it's a strong 1st person intent or open tasks are present.
    if (hasTerminalPunctuation) {
      const strongIntent = STRONG_INTENT_RE.test(lastText) || 
                           JE_SUIS_EN_TRAIN_RE.test(lastText) || /◻/.test(lastText)
      const presentProgressive = PRESENT_PROGRESSIVE_RE.test(lateText)
      // Imperative/declarative patterns also signal intent when punctuated
      // (e.g. "Need to process files.", "Now create the component.", "Next we need to add tests.")
      // Use lateText (last 120 chars) for consistency with the late-window intent check above.
      const hasImperativeSignal = IMPERATIVE_RE_1.test(lateText) ||
        IMPERATIVE_RE_2.test(lateText) ||
        IMPERATIVE_RE_3.test(lateText)
      const endsWithColon = ENDS_WITH_COLON_RE.test(lastText)
      if (strongIntent || endsWithColon || presentProgressive || hasImperativeSignal) {
        return { shouldNudge: true, reason: 'continuation_signal' }
      }
    } else {
      return { shouldNudge: true, reason: 'continuation_signal' }
    }
  }

  // 3. Completion Marker Guard (Final check for sound, completed messages)
  // Only block continuation if no continuation signal is present (prevents false
  // positives when "complete" or "done" appears mid-sentence, e.g. "The download
  // is complete. Now processing the files...")
  let hasGlobalContinuationSignal: boolean | undefined = undefined
  const getHasGlobalSignal = () => (hasGlobalContinuationSignal ??= CONTINUATION_SIGNALS.some(re => re.test(lastText)))

  if (COMPLETION_MARKERS.test(lastText) && !hasLateContinuationSignal && !getHasGlobalSignal()) {
    return { shouldNudge: false }
  }

  // Global fallback for unpunctuated signals (must be a clear transition)
  if (
    !hasTerminalPunctuation && 
    getHasGlobalSignal()
  ) {
    return { shouldNudge: true, reason: 'continuation_signal' }
  }

  return { shouldNudge: false }
}
