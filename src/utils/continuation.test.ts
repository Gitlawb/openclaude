import { describe, test, expect } from 'bun:test'
import { analyzeContinuationIntent, checkStructuralTruncation } from './continuation.js'

describe('checkStructuralTruncation', () => {
  test('detects unclosed code blocks', () => {
    expect(checkStructuralTruncation("```typescript\nconst a = 1\n").hasUnclosedCodeBlock).toBe(true)
    expect(checkStructuralTruncation("```typescript\nconst a = 1\n```").hasUnclosedCodeBlock).toBe(false)
    expect(checkStructuralTruncation("```\nblock 1\n```\n```\nblock 2").hasUnclosedCodeBlock).toBe(true)
    expect(checkStructuralTruncation("```\nblock 1\n```\n```\nblock 2\n```").hasUnclosedCodeBlock).toBe(false)
  })

  test('detects unclosed brackets and delimiters', () => {
    expect(checkStructuralTruncation("foo(bar").hasUnclosedPair).toBe(true)
    expect(checkStructuralTruncation("foo(bar)").hasUnclosedPair).toBe(false)
    expect(checkStructuralTruncation("foo[0").hasUnclosedPair).toBe(true)
    expect(checkStructuralTruncation("foo[0]").hasUnclosedPair).toBe(false)
    expect(checkStructuralTruncation("const x = {").hasUnclosedPair).toBe(true)
    expect(checkStructuralTruncation("const x = {}").hasUnclosedPair).toBe(false)
  })

  test('handles clean balanced text', () => {
    const result = checkStructuralTruncation("All tasks are finished. No issues.")
    expect(result.hasUnclosedCodeBlock).toBe(false)
    expect(result.hasUnclosedPair).toBe(false)
  })
})

describe('analyzeContinuationIntent', () => {
  test('handles case-insensitive continuation intents', () => {
    expect(analyzeContinuationIntent("NOW I WILL UPDATE THE CODE").shouldNudge).toBe(true)
    expect(analyzeContinuationIntent("let me inspect the files").shouldNudge).toBe(true)
    expect(analyzeContinuationIntent("LET ME INSPECT THE FILES").shouldNudge).toBe(true)
    expect(analyzeContinuationIntent("NEED TO PROCESS THE FILES.").shouldNudge).toBe(true)
    expect(analyzeContinuationIntent("task finished").shouldNudge).toBe(false)
    expect(analyzeContinuationIntent("TASK FINISHED").shouldNudge).toBe(false)
  })

  test('properly handles terminal punctuation and completion markers', () => {
    expect(analyzeContinuationIntent("The download is complete. Now processing the files.").shouldNudge).toBe(true)
    expect(analyzeContinuationIntent("All tests pass. Task done.").shouldNudge).toBe(false)
    expect(analyzeContinuationIntent("All tests pass. Done.").shouldNudge).toBe(false)
    expect(analyzeContinuationIntent("The analysis is complete and no code changes are needed here").shouldNudge).toBe(false)
  })

  test('detects code fence starter with long language info string', () => {
    const longLang = "customlanguageidentifierthatislongerthansixtycharactersandnumbers"
    expect(analyzeContinuationIntent(`Here is the code:\n\`\`\`${longLang}`).shouldNudge).toBe(true)
  })

  test('returns false for complete closed code blocks', () => {
    expect(analyzeContinuationIntent("```ts\nconst a = 1\n```").shouldNudge).toBe(false)
  })
})
