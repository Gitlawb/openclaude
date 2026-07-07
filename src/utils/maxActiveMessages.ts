export const DEFAULT_MAX_ACTIVE_MESSAGES_HARD_CAP = 1000

type MaxActiveMessagesEnv = Record<string, string | undefined>

export function parseMaxActiveMessagesLimit(value: string | undefined): number {
  if (!value) {
    return 0
  }
  const trimmed = value.trim()
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    return 0
  }
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) ? parsed : 0
}

export function getMaxActiveMessagesHardCap(
  env: MaxActiveMessagesEnv = process.env,
): number {
  const hardCapOverride =
    env.OPENCLAUDE_MAX_ACTIVE_MESSAGES_HARD_CAP
  if (hardCapOverride === undefined) {
    return DEFAULT_MAX_ACTIVE_MESSAGES_HARD_CAP
  }
  const trimmed = hardCapOverride.trim()
  if (trimmed === '0') {
    return 0
  }
  const parsed = parseMaxActiveMessagesLimit(trimmed)
  return parsed > 0 ? parsed : DEFAULT_MAX_ACTIVE_MESSAGES_HARD_CAP
}

export function resolveMaxActiveMessagesLimit(
  configSetting: string,
  envSetting: string | undefined,
): number {
  const configuredLimit =
    configSetting !== 'off'
      ? parseMaxActiveMessagesLimit(configSetting)
      : parseMaxActiveMessagesLimit(envSetting)
  const hardCap = getMaxActiveMessagesHardCap()
  if (configuredLimit > 0 && hardCap > 0) {
    return Math.min(configuredLimit, hardCap)
  }
  return configuredLimit > 0 ? configuredLimit : hardCap
}

export function isAboveMaxActiveMessagesLimit(
  messageCount: number,
  limit = getMaxActiveMessagesHardCap(),
): boolean {
  return limit > 0 && messageCount > limit
}

export function shouldCompactActiveMessageHistory({
  messageCount,
  tokenCount,
  tokenThreshold,
  activeMessageLimit = getMaxActiveMessagesHardCap(),
}: {
  messageCount: number
  tokenCount: number
  tokenThreshold: number
  activeMessageLimit?: number
}): boolean {
  return (
    tokenCount > tokenThreshold ||
    isAboveMaxActiveMessagesLimit(messageCount, activeMessageLimit)
  )
}
