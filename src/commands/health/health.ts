import type { LocalCommandCall } from '../../types/command.js'
import { getHealthMonitor } from '../../services/router/index.js'

export const call: LocalCommandCall = async (args: string) => {
  const monitor = getHealthMonitor()
  if (!monitor) {
    return { type: 'text', value: 'Router not initialized. Health monitoring unavailable.' }
  }

  const endpoint = args.trim()

  if (endpoint) {
    const tier = endpoint.toUpperCase()
    const status = monitor.getStatus(tier as any)
    if (!status) {
      return { type: 'text', value: `No health data for tier ${tier}. Available: T0, T1, T2, T3, T4` }
    }
    return {
      type: 'text',
      value: [
        `## ${tier} — ${status.endpoint}`,
        '',
        `**Status:** ${status.status}`,
        `**Latency:** ${status.latencyMs}ms (${(status.latencyPer1kTokens / 1000).toFixed(1)}s/1K tokens)`,
        `**Model loaded:** ${status.modelLoaded ?? 'none'}`,
        `**Cold start:** ${status.coldStart ? 'yes' : 'no'}`,
        `**Last check:** ${status.lastCheck}`,
        status.lastError ? `**Last error:** ${status.lastError}` : '',
      ].filter(Boolean).join('\n'),
    }
  }

  return { type: 'text', value: monitor.formatStatusBanner() }
}
