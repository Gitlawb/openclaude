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

function getLegacyMessageRole(
  event: Record<string, unknown>,
): 'assistant' | 'user' | null {
  if (event.type === 'assistant' || event.type === 'user') {
    return event.type
  }
  if (
    event.type === undefined &&
    (event.role === 'assistant' || event.role === 'user')
  ) {
    return event.role
  }
  return null
}

function normalizeLegacyTopLevelMessage(event: Record<string, unknown>): void {
  const role = getLegacyMessageRole(event)
  if (!role) {
    return
  }

  if (!isRecord(event.message) && 'content' in event) {
    event.message = {
      role,
      content: event.content,
    }
  }

  if (isRecord(event.message)) {
    event.type = role
    if (!('parent_tool_use_id' in event)) {
      event.parent_tool_use_id = null
    }
    delete event.role
    delete event.content
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
    }
    if (record.contentIsArray && 'content' in event) {
      event.content = parseSerializedArrayContent(event.content)
    }

    normalizeLegacyTopLevelMessage(event)

    if (!('cachedAt' in record) && typeof event.timestamp === 'number') {
      delete event.timestamp
    }

    delete event.contentIsArray
    return event as unknown as SDKMessage
  })
}
