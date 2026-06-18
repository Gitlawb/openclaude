// Stub — reactiveCompact not included in source snapshot (feature-gated).
// All call sites are behind feature('REACTIVE_COMPACT') and/or check
// isReactiveCompactEnabled()/isReactiveOnlyMode(), which return false here,
// so these inert implementations preserve behavior.
import type { QuerySource } from '../../constants/querySource.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
} from '../../types/message.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import type { CompactionResult } from './compact.js'

export function isReactiveCompactEnabled(): boolean {
  return false
}

/** Whether /compact should route through the reactive path. Always false. */
export function isReactiveOnlyMode(): boolean {
  return false
}

/**
 * Whether a prompt-too-long API error should be withheld pending a reactive
 * compact retry. Always false — reactive compact is disabled here.
 */
export function isWithheldPromptTooLong(
  _message: Message | StreamEvent | undefined,
): _message is AssistantMessage {
  return false
}

/**
 * Whether a media-size API error should be withheld pending a strip-retry.
 * Always false — reactive compact is disabled here.
 */
export function isWithheldMediaSizeError(
  _message: Message | StreamEvent | undefined,
): _message is AssistantMessage {
  return false
}

export type ReactiveCompactOutcome =
  | { ok: true; result: CompactionResult }
  | {
      ok: false
      reason:
        | 'too_few_groups'
        | 'aborted'
        | 'exhausted'
        | 'error'
        | 'media_unstrippable'
    }

/**
 * Run reactive compaction in response to a prompt-too-long error (or
 * reactive-only /compact). Inert: always reports an error outcome — never
 * reached in this snapshot because the gates above return false.
 */
export async function reactiveCompactOnPromptTooLong(
  _messages: Message[],
  _cacheSafeParams: CacheSafeParams,
  _options: {
    customInstructions?: string
    trigger: 'manual' | 'auto'
  },
): Promise<ReactiveCompactOutcome> {
  return { ok: false, reason: 'error' }
}

/**
 * One-shot reactive compact attempt from the query loop's 413/media-error
 * recovery path. Inert: returns null (no recovery), letting the original
 * error surface — matching the disabled-feature behavior.
 */
export async function tryReactiveCompact(_params: {
  hasAttempted: boolean
  querySource: QuerySource
  aborted: boolean
  messages: Message[]
  cacheSafeParams: CacheSafeParams
}): Promise<CompactionResult | null> {
  return null
}
