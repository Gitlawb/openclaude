/**
 * PIF-C prompt provider abstraction.
 *
 * Decouples the resolver from any specific UI. CLI commands wire the readline
 * provider when stdin is a TTY; tests inject the stub provider with pre-canned
 * answers.
 */

import readline from 'node:readline'

export interface PromptProvider {
  /**
   * Render `question` (and optional suggested answers as a `[a/b/c]` hint),
   * accept the dev's response, return the trimmed string. Resolve to `null`
   * on EOF / Ctrl-D so the caller can treat it as abort.
   */
  prompt(question: string, suggestedAnswers?: string[]): Promise<string | null>
}

/**
 * Default readline-based provider. Suggested answers are rendered as a
 * bracketed hint after the question, e.g. `Continue? [no/yes]:`. The dev's
 * response is trimmed; an empty response is treated as "use the default" by
 * the resolver, but THIS provider returns the empty string verbatim — the
 * resolver/caller decides whether empty means default or invalid.
 */
export function createReadlineProvider(): PromptProvider {
  return {
    async prompt(question, suggestedAnswers) {
      const hint = suggestedAnswers && suggestedAnswers.length > 0
        ? ` [${suggestedAnswers.join('/')}]`
        : ''
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })
      try {
        return await new Promise<string | null>((resolve) => {
          rl.question(`${question}${hint}: `, (answer) => {
            resolve(answer.trim())
          })
          rl.on('close', () => resolve(null))
        })
      } finally {
        rl.close()
      }
    },
  }
}

/**
 * Stub provider for tests — returns answers from `answers` in order. Once
 * exhausted, all subsequent calls return `null` (treated as EOF).
 */
export function createStubProvider(
  answers: ReadonlyArray<string | null>,
): PromptProvider {
  let i = 0
  return {
    async prompt() {
      if (i >= answers.length) return null
      return answers[i++]
    },
  }
}

/**
 * Stub that throws if invoked. Used to assert the resolver did NOT prompt
 * (e.g. when `confirmedGlobal: true` short-circuits writeNote's escape hatch).
 */
export function createForbiddenProvider(): PromptProvider {
  return {
    async prompt() {
      throw new Error('PromptProvider invoked but should not have been')
    },
  }
}
