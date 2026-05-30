import type {
  SDKMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKRateLimitError,
  QueryOptions,
  SDKSession,
} from '@gitlawb/openclaude/sdk'

// Use the types so they're not unused-imports-eliminated
type _Msg = SDKMessage
type _User = SDKUserMessage
type _Result = SDKResultMessage

// Verify SDKRateLimitError properties are accessible
declare const err: SDKRateLimitError
const _resets: number | undefined = err.resetsAt
const _rateType: string | undefined = err.rateLimitType

// Verify session types
declare const session: SDKSession
const _messages: SDKMessage[] = session.getMessages()