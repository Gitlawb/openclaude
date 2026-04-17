/**
 * PIF-C escape-hatch contract.
 *
 * Tagged-union return shape every escape-hatch-aware tool emits, plus the
 * resolver's input/output types. Lives at the vault level so writers,
 * mappers, and (later) the cache-aside query layer all share the same
 * vocabulary for "I cannot proceed without the dev's input."
 *
 * See `.specs/features/pif-c-escape-hatch-contract/` for the full design.
 */

/** What a tool returns when it has finished, OR needs the dev, OR errored. */
export type ToolResult<T = unknown> =
  | { status: 'ok'; data: T }
  | NeedsInput
  | ToolError

/** Tool defers a decision to the dev. The resolver decides what to do next. */
export interface NeedsInput {
  status: 'needs-input'
  /** The question shown to the dev. */
  question: string
  /**
   * Optional pre-canned answers. When `BRIDGEAI_AUTO_CONFIRM=true` is set
   * (or a per-session yes-to-all flag is active for this `kind`), the
   * resolver auto-accepts `suggestedAnswers[0]`.
   */
  suggestedAnswers?: string[]
  /** Free-form payload the resolver passes through to the prompt UI / log. */
  context?: Record<string, unknown>
  /**
   * Which vault's `_log.md` should record the dev's response. When `'global'`
   * but `cfg.global == null`, the logger silently falls back to `local`.
   * Default: `'local'`.
   */
  affectedVault?: 'local' | 'global'
  /**
   * Stable kind tag (e.g. `'global-write-confirm'`, `'sync-conflict-resolve'`).
   * Used as the key for the per-session yes-to-all flag.
   */
  kind: string
}

/** Tool failed in a structured way; resolver does not run. */
export interface ToolError {
  status: 'error'
  code: string
  message: string
  partialOutput?: unknown
}

/** What the resolver returns to the tool's caller. */
export type Resolution =
  | { resolved: true; answer: string; autoAccepted: boolean }
  | {
      resolved: false
      reason: 'aborted-no-prompt' | 'aborted-no-default' | 'aborted-eof'
    }
