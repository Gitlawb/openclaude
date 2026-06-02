import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'

export type SDKMessageCacheRecord = Record<string, unknown> & {
  contentIsArray?: boolean
  message?: Record<string, unknown>
  timestamp?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function serializeToCacheMessage(
  events: readonly SDKMessage[],
): SDKMessageCacheRecord[] {
  return events.map(event => {
    const record: SDKMessageCacheRecord = {
      ...(event as unknown as Record<string, unknown>),
      timestamp: Date.now(),
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
    delete event.timestamp

    if (record.contentIsArray && isRecord(event.message)) {
      const message = event.message
      const content = message.content
      if (typeof content === 'string') {
        try {
          event.message = {
            ...message,
            content: JSON.parse(content),
          }
        } catch {
          event.message = message
        }
      }
    }

    delete event.contentIsArray
    return event as unknown as SDKMessage
  })
}
