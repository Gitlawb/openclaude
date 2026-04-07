import { runExtraUsage } from './runExtraUsage.js'

export async function nonInteractiveExtraUsageCall(): Promise<{
  type: 'text'
  value: string
}> {
  const result = await runExtraUsage()

  if (result.type === 'message') {
    return { type: 'text', value: result.value }
  }

  return {
    type: 'text',
    value: result.opened
      ? `Browser opened to manage extra usage. If it didn't open, visit: ${result.url}`
      : `Please visit ${result.url} to manage extra usage.`,
  }
}
