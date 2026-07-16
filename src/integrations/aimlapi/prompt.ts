/**
 * Minimal interactive prompts backed by Node's built-in readline - no extra
 * dependency. Used by the AI/ML API top-up flow to collect credentials when
 * they are not supplied via flags/env.
 */

import { createInterface } from 'node:readline'

type ReadlineInterface = {
  question(question: string, callback: (answer: string) => void): void
  close(): void
}
type CreateReadlineInterface = (
  options: Parameters<typeof createInterface>[0],
) => ReadlineInterface

function assertInteractive(): void {
  if (!process.stdin.isTTY) {
    throw new Error(
      'No interactive terminal available. Provide --email (or AIMLAPI_EMAIL) and, for an existing account, --code (or AIMLAPI_CODE).',
    )
  }
}

export async function promptText(
  question: string,
  opts: { defaultValue?: string } = {},
  createReadline: CreateReadlineInterface = createInterface as CreateReadlineInterface,
): Promise<string> {
  assertInteractive()
  const suffix = opts.defaultValue ? ` [${opts.defaultValue}]` : ''
  const rl = createReadline({ input: process.stdin, output: process.stdout })
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question}${suffix}: `, resolve)
    })
    const trimmed = answer.trim()
    return trimmed || opts.defaultValue || ''
  } finally {
    rl.close()
  }
}
