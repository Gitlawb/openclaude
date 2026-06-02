import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'

export type SDKMessageCacheRecord = Record<string, unknown> & {
  cachedAt?: number
  contentIsArray?: boolean
  message?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseSerializedArrayContent(content: unknown): unknown {
  if (typeof content !== 'string') {
    return content
  }

  try {
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : content
  } catch {
    return content
  }
}

export function serializeToCacheMessage(
  events: readonly SDKMessage[],
): SDKMessageCacheRecord[] {
  return events.map(event => {
    const record: SDKMessageCacheRecord = {
      ...(event as unknown as Record<string, unknown>),
      cachedAt: Date.now(),
    }

    if ('message' in event && isRecord(event.message)) {
      const content = event.message.content
      if (Array.isArray(content)) {
        record.message = {
          ...event.message,
          content: JSON.stringify(content),
        }
        record.contentIsArray = true
      }
    }

    return record
  })
}

export function deserializeFromCacheMessage(
  records: readonly SDKMessageCacheRecord[],
): SDKMessage[] {
  return records.map(record => {
    const event = { ...record }
    delete event.cachedAt

    if (record.contentIsArray && isRecord(event.message)) {
      const message = event.message
      event.message = {
        ...message,
        content: parseSerializedArrayContent(message.content),
      }
    } else if (record.contentIsArray) {
      event.content = parseSerializedArrayContent(event.content)
    }

    if (!('cachedAt' in record) && typeof event.timestamp === 'number') {
      delete event.timestamp
    }

    delete event.contentIsArray
    return event as unknown as SDKMessage
  })
}
