export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function getTrimmedString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : undefined
}

export function firstPositiveNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value
    }
  }
  return undefined
}

export function isKnownNonCodingModelId(id: string): boolean {
  return /(audio|dall-e|deep-research|embedding|image|moderation|realtime|rerank|sora|speech|transcribe|translate|tts|whisper)/i.test(
    id,
  )
}

export function isFreeModel(
  id: string,
  raw: Record<string, unknown>,
): boolean {
  return (
    id.toLowerCase().endsWith(':free') ||
    raw.free === true ||
    raw.is_free === true
  )
}
