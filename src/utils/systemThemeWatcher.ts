import type { TerminalQuerier } from '../ink/terminal-querier.js'
import { oscColor } from '../ink/terminal-querier.js'
import {
  setCachedSystemTheme,
  themeFromOscColor,
  type SystemTheme,
} from './systemTheme.js'

async function queryTheme(
  querier: TerminalQuerier,
  onTheme: (theme: SystemTheme) => void,
): Promise<void> {
  const response = await querier.send(oscColor(11))
  await querier.flush()
  if (!response || response.type !== 'osc') {
    return
  }
  const theme = themeFromOscColor(response.data)
  if (!theme) {
    return
  }
  setCachedSystemTheme(theme)
  onTheme(theme)
}

export function watchSystemTheme(
  querier: TerminalQuerier,
  onTheme: (theme: SystemTheme) => void,
): () => void {
  let cancelled = false

  const run = async () => {
    if (cancelled) {
      return
    }
    try {
      await queryTheme(querier, theme => {
        if (!cancelled) {
          onTheme(theme)
        }
      })
    } catch {
      // Best-effort watcher. Terminal querying support is optional.
    }
  }

  void run()
  const interval = setInterval(() => {
    void run()
  }, 30000)

  return () => {
    cancelled = true
    clearInterval(interval)
  }
}
