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

  test('handles inline triple backticks inside closed code blocks without false cut-off', () => {
    expect(analyzeContinuationIntent("```ts\nconst fence = '```'\n```").shouldNudge).toBe(false)
  })

  test('evaluates all matches of continuation signals in lateText window', () => {
    expect(analyzeContinuationIntent("Now process the files. Done. Now update the code.").shouldNudge).toBe(true)
  })

  test('does not treat language-tagged line as closing fence for open code block', () => {
    expect(checkStructuralTruncation("```markdown\n```ts\nconst x = 1").hasUnclosedCodeBlock).toBe(true)
    expect(checkStructuralTruncation("```markdown\n```ts\nconst x = 1\n```").hasUnclosedCodeBlock).toBe(false)
  })

  test('requires closing fence to have at least opening fence backtick length', () => {
    // 4-backtick opening fence cannot be closed by a 3-backtick fence
    expect(checkStructuralTruncation("````markdown\n```\nconst x = 1").hasUnclosedCodeBlock).toBe(true)
    // 4-backtick opening fence is closed by a 4-backtick fence
    expect(checkStructuralTruncation("````markdown\n```\nconst x = 1\n````").hasUnclosedCodeBlock).toBe(false)
  })

  test('ignores bracket disparity inside closed code blocks', () => {
    expect(checkStructuralTruncation("```ts\nconst re = /\\(/\nconst x = [1, 2\n```").hasUnclosedPair).toBe(false)
    expect(checkStructuralTruncation("```ts\nconst re = /\\(/\nconst x = [1, 2\n```\n(").hasUnclosedPair).toBe(true)
  })

  test('handles punctuated French intent patterns and action phrases', () => {
    expect(analyzeContinuationIntent("L'étape suivante est de créer le composant.").shouldNudge).toBe(true)
    expect(analyzeContinuationIntent("Starting to build the package.").shouldNudge).toBe(true)
    expect(analyzeContinuationIntent("Time to compile the source.").shouldNudge).toBe(true)
  })
})
