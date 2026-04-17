/**
 * PIF-B first-machine setup hook — wires the PIF-C escape hatch into
 * onboarding. Idempotent: a second call after the dev has already
 * accepted or declined is a fast-path no-op.
 *
 * The bootstrap operation runs OUTSIDE the resolver (we don't ask the
 * resolver to do disk work). The decision-event log lands in the LOCAL
 * vault's `_log.md` per `affectedVault: 'local'` because the GLOBAL vault
 * doesn't necessarily exist yet at decision time.
 */

import type { NeedsInput } from './escapeHatch/contract.js'
import type { ResolverContext } from './escapeHatch/resolver.js'
import { resolveNeedsInput } from './escapeHatch/resolver.js'
import { bootstrapGlobalVault } from './globalBootstrap.js'
import {
  type GlobalVaultResolution,
  loadMachineConfig,
  resolveGlobalVault,
  saveMachineConfig,
} from './globalConfig.js'

/**
 * Run the first-machine prompt if needed. Returns the resolution after
 * the prompt (or the existing one when already configured/declined).
 */
export async function maybePromptForGlobalVault(
  escapeHatch: ResolverContext,
): Promise<GlobalVaultResolution> {
  const initial = resolveGlobalVault()
  if (initial.kind !== 'unconfigured') return initial

  const needs: NeedsInput = {
    status: 'needs-input',
    kind: 'first-machine-global-vault-setup',
    question: `Set up global vault at ${initial.defaultPath}? (Carries learnings across projects.)`,
    // YES first — opposite of PIFC-T5's global-WRITE confirm. Bootstrap
    // is benign; the dev opted in by running bridgeai. Global writes are
    // the contamination risk, not the existence of the vault.
    suggestedAnswers: ['yes', 'no'],
    affectedVault: 'local',
    context: { defaultPath: initial.defaultPath },
  }

  const resolution = await resolveNeedsInput(needs, escapeHatch)

  // 'yes' → bootstrap. Anything else (no, abort, EOF) → record decline.
  if (resolution.resolved && resolution.answer === 'yes') {
    await bootstrapGlobalVault(initial.defaultPath)
    return {
      kind: 'configured',
      path: initial.defaultPath,
      source: 'config',
    }
  }

  const cfg = loadMachineConfig()
  saveMachineConfig({ ...cfg, declinedGlobalVault: true })
  return { kind: 'declined' }
}
