// BRIDGE-AI: Datadog telemetry stubbed — no external calls
import memoize from 'lodash-es/memoize.js'

export const initializeDatadog = memoize(async (): Promise<boolean> => {
  return false
})

export async function shutdownDatadog(): Promise<void> {}

export async function trackDatadogEvent(
  _eventName: string,
  _properties: { [key: string]: boolean | number | undefined },
): Promise<void> {}
