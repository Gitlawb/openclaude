import type { QuerySource } from '../../constants/querySource.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import type { Message } from '../../types/message.js'
import type { CompactionResult } from './compact.js'

export type ReactiveCompactFailureReason =
  | 'too_few_groups'
  | 'aborted'
  | 'exhausted'
  | 'error'
  | 'media_unstrippable'

export function isReactiveCompactEnabled(): boolean {
  return false
}

export function isReactiveOnlyMode(): boolean {
  return false
}

export async function tryReactiveCompact(_input: {
  hasAttempted: boolean
  querySource: QuerySource
  aborted: boolean
  messages: Message[]
  cacheSafeParams: CacheSafeParams
}): Promise<CompactionResult | null> {
  return null
}

export async function reactiveCompactOnPromptTooLong(
  _messages: Message[],
  _cacheSafeParams: CacheSafeParams,
  _options: { customInstructions?: string; trigger: 'manual' | 'auto' },
): Promise<
  | { ok: true; result: CompactionResult }
  | { ok: false; reason: ReactiveCompactFailureReason }
> {
  return { ok: false, reason: 'exhausted' }
}
