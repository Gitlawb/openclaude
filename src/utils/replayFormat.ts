import { formatDuration } from './format.js'

export function formatReplayDuration(ms: number): string {
  if (ms > 0 && ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  return formatDuration(ms)
}
