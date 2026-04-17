/**
 * PIF-C resolver — the decision loop for `needs-input` outcomes.
 *
 * Receives a `NeedsInput` from a tool, decides what to do based on
 * (yes-to-all session flag, BRIDGEAI_AUTO_CONFIRM env var, presence of a
 * prompt provider), logs the decision to the affected vault's `_log.md`,
 * and returns a `Resolution` to the caller.
 *
 * See `.specs/features/pif-c-escape-hatch-contract/design.md` for the
 * 5-branch decision diagram.
 */

import type { VaultConfig } from '../types.js'
import type { NeedsInput, Resolution } from './contract.js'
import { appendDevAborted, appendDevConfirmed } from './log.js'
import type { PromptProvider } from './promptProvider.js'

export interface ResolverContext {
  cfg: VaultConfig
  /** `null` ⇒ non-interactive caller. */
  provider: PromptProvider | null
  /** Per-session yes-to-all flags, keyed by `NeedsInput.kind`. */
  yesToAll: Set<string>
  /** Snapshot of `BRIDGEAI_AUTO_CONFIRM` at context construction. */
  autoConfirm: boolean
}

export interface CreateResolverContextOptions {
  /** Default: null (non-interactive). */
  provider?: PromptProvider | null
}

function readAutoConfirm(): boolean {
  // Strict opt-in: only `'true'` and `'1'` count. Other values (TRUE, yes,
  // on, ...) are treated as unset to avoid ambiguity.
  const v = process.env.BRIDGEAI_AUTO_CONFIRM
  return v === 'true' || v === '1'
}

export function createResolverContext(
  cfg: VaultConfig,
  opts: CreateResolverContextOptions = {},
): ResolverContext {
  return {
    cfg,
    provider: opts.provider ?? null,
    yesToAll: new Set(),
    autoConfirm: readAutoConfirm(),
  }
}

/**
 * Resolve a `needs-input` outcome. Always returns; never throws on the
 * documented branches. Throws only when `needs` is structurally malformed
 * (missing `kind` or `question`) — that's a programming bug, not user flow.
 */
export async function resolveNeedsInput(
  needs: NeedsInput,
  ctx: ResolverContext,
): Promise<Resolution> {
  if (!needs.kind || !needs.question) {
    throw new Error('malformed needs-input: kind and question are required')
  }

  const suggested = needs.suggestedAnswers?.[0]

  // 1. Per-session yes-to-all hit.
  if (ctx.yesToAll.has(needs.kind) && suggested !== undefined) {
    appendDevConfirmed(ctx.cfg, needs, suggested, 'yes-to-all')
    return { resolved: true, answer: suggested, autoAccepted: true }
  }

  // 2. BRIDGEAI_AUTO_CONFIRM=true — needs a default to accept.
  if (ctx.autoConfirm) {
    if (suggested !== undefined) {
      appendDevConfirmed(ctx.cfg, needs, suggested, 'BRIDGEAI_AUTO_CONFIRM')
      return { resolved: true, answer: suggested, autoAccepted: true }
    }
    // 3. autoConfirm but no suggestion to accept → abort.
    appendDevAborted(ctx.cfg, needs, 'aborted-no-default')
    return { resolved: false, reason: 'aborted-no-default' }
  }

  // 4. Non-interactive caller (no provider) → abort.
  if (!ctx.provider) {
    appendDevAborted(ctx.cfg, needs, 'aborted-no-prompt')
    return { resolved: false, reason: 'aborted-no-prompt' }
  }

  // 5. Interactive: ask the dev.
  let answer: string | null
  try {
    answer = await ctx.provider.prompt(needs.question, needs.suggestedAnswers)
  } catch {
    // Treat provider errors as EOF for safety.
    answer = null
  }
  if (answer === null) {
    appendDevAborted(ctx.cfg, needs, 'aborted-eof')
    return { resolved: false, reason: 'aborted-eof' }
  }

  // 5a. The literal `'yes-to-all'` answer activates the session-level
  //     auto-accept for this kind. Logged as the explicit answer the dev
  //     gave; subsequent same-kind calls auto-accept the suggested answer.
  if (answer === 'yes-to-all') {
    ctx.yesToAll.add(needs.kind)
    appendDevConfirmed(ctx.cfg, needs, 'yes-to-all', null)
    // Return the suggested answer if any (so the caller can proceed),
    // else `'yes-to-all'` verbatim — caller decides what it means.
    const effective = suggested ?? 'yes-to-all'
    return { resolved: true, answer: effective, autoAccepted: false }
  }

  appendDevConfirmed(ctx.cfg, needs, answer, null)
  return { resolved: true, answer, autoAccepted: false }
}
