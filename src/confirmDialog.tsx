import React, { useEffect } from 'react'

/**
 * Lightweight yes/no confirmation dialog used by interactive flows
 * (e.g., vault scaffold `.gitignore` prompt).
 *
 * Behavior:
 *  - If stdin is not a TTY (piped / CI), resolves to `defaultAnswer` immediately
 *    without mounting Ink. This is critical — scripted use must never hang.
 *  - Otherwise mounts a minimal Ink root, captures one keypress:
 *      Enter       → defaultAnswer
 *      y / Y       → true
 *      n / N       → false
 *      (anything else is ignored; we keep waiting)
 *  - Always unmounts before resolving.
 *
 * The `streams` option is a test seam — production calls omit it and
 * the real `process.stdin` / `process.stdout` are used.
 */
export interface ConfirmDialogStreams {
  stdin?: NodeJS.ReadStream
  stdout?: NodeJS.WriteStream
}

export async function confirmDialog(
  question: string,
  defaultAnswer: 'yes' | 'no' = 'yes',
  streams?: ConfirmDialogStreams,
): Promise<boolean> {
  const stdin = streams?.stdin ?? process.stdin
  const stdout = streams?.stdout ?? process.stdout

  const defaultBool = defaultAnswer === 'yes'

  // Non-TTY short-circuit: resolve synchronously with the default. We must
  // not mount Ink here — Ink would attach to stdin and block CI forever.
  if (!stdin.isTTY) {
    return defaultBool
  }

  // Lazy-import Ink so the non-TTY path stays free of the heavy render graph
  // (keeps this module cheap to import from CLI entrypoints).
  const { Box, Text, createRoot, useInput } = await import('./ink.js')

  return new Promise<boolean>((resolve, reject) => {
    let settled = false
    let root: Awaited<ReturnType<typeof createRoot>> | null = null

    const done = (value: boolean): void => {
      if (settled) return
      settled = true
      try {
        root?.unmount()
      } catch {
        // ignore unmount races
      }
      resolve(value)
    }

    function ConfirmPrompt(): React.ReactElement {
      useInput((input, key) => {
        if (key.return) {
          done(defaultBool)
          return
        }
        if (input === 'y' || input === 'Y') {
          done(true)
          return
        }
        if (input === 'n' || input === 'N') {
          done(false)
          return
        }
        // ignore everything else — wait for a decisive key
      })

      const hint = defaultBool ? '[Y/n]' : '[y/N]'
      return (
        <Box flexDirection="row">
          <Text>
            {question} {hint}{' '}
          </Text>
        </Box>
      )
    }

    createRoot({
      stdin,
      stdout,
      patchConsole: false,
    })
      .then(r => {
        if (settled) {
          // Raced with an immediate resolve; unmount and bail.
          try {
            r.unmount()
          } catch {
            // ignore
          }
          return
        }
        root = r
        r.render(<ConfirmPrompt />)
      })
      .catch(err => {
        if (!settled) {
          settled = true
          reject(err as Error)
        }
      })
  })
}
