/**
 * Minimal interactive prompts backed by Node's built-in readline - no extra
 * dependency. Used by the AI/ML API top-up flow to collect credentials when
 * they are not supplied via flags/env.
 */

import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'

type ReadlineInterface = {
  question(question: string, callback: (answer: string) => void): void
  close(): void
}
type CreateReadlineInterface = (
  options: Parameters<typeof createInterface>[0],
) => ReadlineInterface
type PromptOutput = {
  write(chunk: string): unknown
  columns?: number
}

function assertInteractive(): void {
  if (!process.stdin.isTTY) {
    throw new Error(
      'No interactive terminal available. Provide --email (or AIMLAPI_EMAIL) and, for an existing account, --code (or AIMLAPI_CODE).',
    )
  }
}

export async function promptText(
  question: string,
  opts: { defaultValue?: string; mask?: boolean } = {},
  createReadline: CreateReadlineInterface = createInterface as CreateReadlineInterface,
  output: PromptOutput = process.stdout,
): Promise<string> {
  assertInteractive()
  const suffix = opts.defaultValue ? ` [${opts.defaultValue}]` : ''
  const label = `${question}${suffix}: `
  const mutedOutput = new Writable({
    write(_chunk, _encoding, done) {
      done()
    },
  }) as Writable & { columns?: number; isTTY?: boolean }
  mutedOutput.columns = output.columns
  mutedOutput.isTTY = true
  if (opts.mask) output.write(label)
  const rl = createReadline({
    input: process.stdin,
    output: opts.mask ? mutedOutput : process.stdout,
    ...(opts.mask ? { terminal: true } : {}),
  })
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(opts.mask ? '' : label, resolve)
    })
    const trimmed = answer.trim()
    return trimmed || opts.defaultValue || ''
  } finally {
    rl.close()
    if (opts.mask) output.write('\n')
  }
}
