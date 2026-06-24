/**
 * SDK runtime types — non-serializable types (callbacks, interfaces with
 * methods) re-exported as the `runtimeTypes` surface of the public SDK API.
 *
 * Most of these live in the SDK implementation modules (shared.ts, query.ts,
 * v2.ts); this module aggregates them for agentSdkTypes.ts. It must stay
 * runtime-inert: type-only exports, no value exports.
 */

import type { z } from 'zod/v4'
import type { Query, QueryOptions } from './query.js'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max' | 'xhigh'

// ============================================================================
// Zod helpers for tool() input schemas
// ============================================================================

/** A Zod raw shape (`{ field: z.string(), ... }`) accepted by tool(). */
export type AnyZodRawShape = z.ZodRawShape

/** Infer the parsed args type for a tool() input shape. */
export type InferShape<Shape extends AnyZodRawShape> = z.infer<z.ZodObject<Shape>>

// ============================================================================
// Re-exports from the SDK implementation modules
// ============================================================================

// Session management option/result types
export type {
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  ListSessionsOptions,
  SessionMessage,
  SessionMutationOptions,
} from './shared.js'

// V2 persistent session API
export type {
  SDKSession,
  SDKSessionOptions,
  SdkMcpToolDefinition,
} from './v2.js'

// query() API
export type { Query, QueryOptions } from './query.js'

/** Options accepted by query(). Public alias for QueryOptions. */
export type Options = QueryOptions

// ============================================================================
// Internal variants
// ============================================================================

/**
 * Options superset used internally — public Options plus internal-only
 * knobs not part of the stable surface.
 * @internal
 */
export type InternalOptions = Options & { [key: string]: unknown }

/**
 * Query handle superset used internally — public Query plus internal-only
 * members not part of the stable surface.
 * @internal
 */
export type InternalQuery = Query & { [key: string]: unknown }
