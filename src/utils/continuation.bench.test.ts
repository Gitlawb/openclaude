import { describe, test, expect } from 'bun:test'
import { analyzeContinuationIntent as analyzeContinuationIntent_Optimized } from './continuation.js'

// Pre-optimization baseline implementation embedded for head-to-head parity and benchmark comparisons
const ACTION_VERBS = [
  'do', 'create', 'write', 'edit', 'update', 'fix', 'implement', 'add', 'run',
  'check', 'make', 'build', 'set up', 'start', 'begin', 'go', 'proceed', 'apply',
  'identify', 'inspect', 'analyze', 'review', 'search', 'process', 'download',
  'upload', 'convert', 'compile', 'train', 'evaluate', 'test', 'continue',
  'generate', 'extract', 'merge', 'deploy', 'install', 'configure', 'refactor',
  'optimize', 'summarize',
] as const

const VERB_ALT = ACTION_VERBS.join('|')
const VERB_ING = ACTION_VERBS.map(v => {
  if (v === 'set up') return 'setting up'
  if (v === 'do') return 'doing'
  if (v === 'go') return 'going'
  if (v === 'run') return 'running'
  if (v === 'begin') return 'beginning'
  if (v === 'make') return 'making'
  if (v === 'write') return 'writing'
  return v.replace(/e$/, '') + 'ing'
}).join('|')

function buildContinuationSignalsOriginal(): RegExp[] {
  const v = VERB_ALT
  const vWithoutDo = ACTION_VERBS.filter(a => a !== 'do').join('|')
  return [
    new RegExp(`\\bso now (i|let me|we) (need to|have to|should|must|will) (${v})\\b`, 'i'),
    new RegExp(`\\bnow i('ll| will) (${v})\\b`, 'i'),
    new RegExp(`\\bi (will|shall|now|need to|have to|must|should) (now )?(${v})\\b`, 'i'),
    new RegExp(`\\blet me (go ahead and |now )?(${v})\\b`, 'i'),
    new RegExp(`\\btime to (do|${vWithoutDo}|get started|begin|start)\\b`, 'i'),
    new RegExp(`\\b(moving on to|next step is to|starting to|proceeding to|continuing with|applying (the|these) changes|${VERB_ING})\\b`, 'i'),
    /(^|\s)(je passe (à|au)|ensuite|l'étape suivante est de|je continue avec|au suivant|passons à|je reviens vers vous|je suis en train d'|je vais maintenant)(\s|$|[a-zà-ÿ])/i,
    /(^|\s)(je (vais|dois|dois maintenant|vais maintenant) (faire|créer|écrire|modifier|ajouter|tester|vérifier|lancer|exécuter|procéder|démarrer|commencer|identifier|analyser|inspecter|revoir|chercher))(\s|$|[a-zà-ÿ])/i,
    /(^|\s)((lancement|exécution|vérification|modification|mise à jour|analyse|inspection|recherche) de)(\s|$|[a-zà-ÿ])/i,
    /:\s*$/,
    /◻/,
    new RegExp(`(?<!\\b(?:you|i|we|they|he|she|it)\\s+)\\bneed to (${v})\\b`, 'i'),
    new RegExp(`\\bnow (${v})\\b(?!\\s+you\\b)`, 'i'),
    new RegExp(`\\bnext (i|we)\\s+(need to|will|shall|should|must)?\\s*(?:${v})\\b`, 'i'),
  ]
}

const CONTINUATION_SIGNALS_ORIGINAL = buildContinuationSignalsOriginal()
const COMPLETION_MARKERS_ORIGINAL = /\b(done|finished|completed|complete|summary|that's all|that is all|all set|hope this helps|let me know if|no issues|lgtm)\b/i
const UNFINISHED_SENTIMENT_SIGNALS_ORIGINAL = [
  /\b(and|with|the|to|of|for|at|by|in|on|a|an|is|are|was|were|my|your|his|her|its|our|their|if|as|but|or|so|which|that)\s*$/i,
  /\b(et|avec|le|la|les|un|une|de|du|des|pour|au|aux|dans|sur|par|à|en|si|car|mais|ou|donc|ni|que|ce|ma|ta|sa|mes|tes|ses|notre|votre|leur|nos|vos|leurs)\s*$/i,
  /[,;]\s*$/,
  /```[a-z]*\s*$/i,
]

function analyzeContinuationIntent_Original(text: string) {
  const lastText = text.trim()
  if (lastText.length === 0) return { shouldNudge: false }
  
  const lowerText = lastText.toLowerCase()

  const codeBlockCount = (lastText.match(/```/g) || []).length
  const hasUnclosedCodeBlock = codeBlockCount % 2 !== 0

  const unclosedPairs = [['(', ')'], ['[', ']'], ['{', '}']]
  const hasUnclosedPair = unclosedPairs.some(([open, close]) => {
    const openCount = (lastText.match(new RegExp('\\' + open, 'g')) || []).length
    const closeCount = (lastText.match(new RegExp('\\' + close, 'g')) || []).length
    return openCount > closeCount
  })

  const hasUnfinishedSuffix = UNFINISHED_SENTIMENT_SIGNALS_ORIGINAL.some(re => re.test(lastText))

  if (hasUnclosedCodeBlock || hasUnclosedPair || hasUnfinishedSuffix) {
    return { shouldNudge: true, reason: 'possible_truncation' }
  }

  const lateWindowSize = 120
  const lateText = lowerText.slice(-lateWindowSize)
  
  const hasLateContinuationSignal = CONTINUATION_SIGNALS_ORIGINAL.some(re => {
    const match = lateText.match(re)
    if (!match) return false
    
    const afterMatch = lateText.slice(match.index! + match[0].length)
    const hasLaterCompletion = COMPLETION_MARKERS_ORIGINAL.test(afterMatch)
    
    const strongAction = /\b(let me|i will|i'll|je vais|je suis en train)\b/i.test(match[0])
    
    return strongAction || !hasLaterCompletion
  })

  if (hasLateContinuationSignal) {
    const hasTerminalPunctuation = /[.!??"'`)\]]\s*$/.test(lastText) || lastText.endsWith('`')
    if (hasTerminalPunctuation) {
      const strongIntent = /\b(i (will|shall|need to|must|should|now)|let (me|us)|je (vais|reviens)|passons à|moving on to|continuing with|proceeding to|next step is to)\b/i.test(lowerText) || 
                           /je suis en train d'/i.test(lowerText) || /◻/.test(lastText)
      const presentProgressive = new RegExp(`\\bnow (?:${VERB_ING})\\b`, 'i').test(lateText)
      const hasImperativeSignal = new RegExp(`(?<!\\b(?:you|i|we|they|he|she|it)\\s+)\\bneed to (?:${VERB_ALT})\\b`, 'i').test(lateText) ||
        new RegExp(`\\bnow (?:${VERB_ALT})\\b(?!\\s+you\\b)`, 'i').test(lateText) ||
        new RegExp(`\\bnext (?:i|we)\\s+(?:need to|will|shall|should|must)?\\s*(?:${VERB_ALT})\\b`, 'i').test(lateText)
      const endsWithColon = /:\s*$/.test(lastText)
      if (strongIntent || endsWithColon || presentProgressive || hasImperativeSignal) {
        return { shouldNudge: true, reason: 'continuation_signal' }
      }
    } else {
      return { shouldNudge: true, reason: 'continuation_signal' }
    }
  }

  if (COMPLETION_MARKERS_ORIGINAL.test(lowerText) && !hasLateContinuationSignal && !CONTINUATION_SIGNALS_ORIGINAL.some(re => re.test(lowerText))) {
    return { shouldNudge: false }
  }

  const hasTerminalPunctuation = /[.!??"'`)\]]\s*$/.test(lastText) || lastText.endsWith('`')
  if (
    CONTINUATION_SIGNALS_ORIGINAL.some(re => re.test(lowerText)) && 
    !hasTerminalPunctuation
  ) {
    return { shouldNudge: true, reason: 'continuation_signal' }
  }

  return { shouldNudge: false }
}

describe('Direct Head-to-Head Performance Benchmark', () => {
  const testDataset = [
    "Task 1 complete. Now I will update src/utils/continuation.ts and run test cases.",
    "Setup is complete. Here is the code:\n```typescript\nfunction run() {",
    "Task complete. Please inspect (src/query.ts",
    "Now create the component.",
    "Need to process the files.",
    "Next I will fix the bug.",
    "The analysis is complete and no code changes are needed here",
    "All tests pass. Task done.",
    "I updated package.json and src/query.ts and added tests.",
    "This should be ready after the latest test updates.",
    "Task 1 finished. I will now run tests.",
    "No issues in the first file. I will now inspect the next one.",
    "Now I'll test the endpoint.",
    "Need to deploy the changes.",
    "Next we need to add tests.",
    "You need to process these files.",
    "Compilation finished. Now deploying the build.",
    "All set. Now testing the endpoint.",
    "The download is complete. Now processing the files.",
    "Done. Now installing dependencies."
  ]

  test('Exact Parity Verification Across Dataset', () => {
    for (const text of testDataset) {
      const orig = analyzeContinuationIntent_Original(text)
      const opt = analyzeContinuationIntent_Optimized(text)
      expect(opt.shouldNudge).toBe(orig.shouldNudge)
      expect(opt.reason).toBe(orig.reason)
    }
  })

  const runBench = process.env.BENCHMARK === '1' ? test : test.skip

  runBench('Live Head-to-Head Benchmark Execution (200,000 Total Calls across Dataset)', () => {
    const iterations = 10000

    // Warmup JIT for both implementations
    for (const text of testDataset) {
      for (let i = 0; i < 200; i++) {
        analyzeContinuationIntent_Original(text)
        analyzeContinuationIntent_Optimized(text)
      }
    }

    // Measure Original Time and Heap
    Bun.gc(true)
    const memBeforeOriginal = process.memoryUsage().heapUsed
    const startOriginal = performance.now()
    for (let k = 0; k < iterations; k++) {
      for (const text of testDataset) {
        analyzeContinuationIntent_Original(text)
      }
    }
    const totalOriginalTimeMs = performance.now() - startOriginal
    const memAfterOriginal = process.memoryUsage().heapUsed
    const originalHeapDeltaBytes = Math.max(0, memAfterOriginal - memBeforeOriginal)

    // Measure Optimized Time and Heap
    Bun.gc(true)
    const memBeforeOptimized = process.memoryUsage().heapUsed
    const startOptimized = performance.now()
    for (let k = 0; k < iterations; k++) {
      for (const text of testDataset) {
        analyzeContinuationIntent_Optimized(text)
      }
    }
    const totalOptimizedTimeMs = performance.now() - startOptimized
    const memAfterOptimized = process.memoryUsage().heapUsed
    const optimizedHeapDeltaBytes = Math.max(0, memAfterOptimized - memBeforeOptimized)

    const totalCalls = iterations * testDataset.length
    const originalNsPerOp = (totalOriginalTimeMs * 1000000) / totalCalls
    const optimizedNsPerOp = (totalOptimizedTimeMs * 1000000) / totalCalls
    const speedupMultiplier = totalOriginalTimeMs / totalOptimizedTimeMs

    console.log("\n==========================================================================")
    console.log("  HEAD-TO-HEAD LIVE TIMED BENCHMARK (ORIGINAL vs OPTIMIZED CODE)")
    console.log("==========================================================================")
    console.log(`  Total Evaluated Calls:         ${totalCalls.toLocaleString()}`)
    console.log(`  ORIGINAL Code Total Time:       ${totalOriginalTimeMs.toFixed(2)} ms (${originalNsPerOp.toFixed(2)} ns / op)`)
    console.log(`  OPTIMIZED Code Total Time:      ${totalOptimizedTimeMs.toFixed(2)} ms (${optimizedNsPerOp.toFixed(2)} ns / op)`)
    console.log(`  Measured Real Speedup Gain:     ${speedupMultiplier.toFixed(2)}x Faster`)
    console.log(`  Sampled Heap Delta BEFORE:      ${(originalHeapDeltaBytes / 1024 / 1024).toFixed(2)} MB`)
    console.log(`  Sampled Heap Delta AFTER:       ${(optimizedHeapDeltaBytes / 1024 / 1024).toFixed(2)} MB`)
    console.log("==========================================================================\n")

    expect(typeof speedupMultiplier).toBe('number')
  }, 30000)
})
