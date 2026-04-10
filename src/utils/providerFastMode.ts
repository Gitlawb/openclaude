import type { ModelSetting } from './model/model.js'
import type { APIProvider } from './model/providers.js'
import { getAPIProvider } from './model/providers.js'
import {
  getPersistedServiceTierForProvider,
  type PersistedServiceTier,
} from './model/providerModelSettings.js'
import {
  getCurrentProviderSelectionTarget,
  resolveProviderSelectionTargetOption,
} from './model/providerTargets.js'
import { getInitialSettings } from './settings/settings.js'
import type { SettingsJson } from './settings/types.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getFastModeState as getAnthropicFastModeState,
  getFastModeUnavailableReason as getAnthropicFastModeUnavailableReason,
  getInitialFastModeSetting as getAnthropicInitialFastModeSetting,
  isFastModeAvailable as isAnthropicFastModeAvailable,
  isFastModeCooldown as isAnthropicFastModeCooldown,
  isFastModeEnabled as isAnthropicFastModeEnabled,
  isFastModeSupportedByModel as isAnthropicFastModeSupportedByModel,
} from './fastMode.js'

export type FastModeProvider = 'firstParty' | 'codex'
export type CodexServiceTier = 'priority'

function asFastModeProvider(
  provider: APIProvider | undefined,
): FastModeProvider | null {
  return provider === 'firstParty' || provider === 'codex' ? provider : null
}

export function resolveFastModeProvider(options?: {
  provider?: APIProvider
  targetKey?: string
}): FastModeProvider | null {
  const targetProvider = options?.targetKey
    ? resolveProviderSelectionTargetOption(options.targetKey)?.provider
    : undefined
  return asFastModeProvider(targetProvider ?? options?.provider ?? getAPIProvider())
}

export function isFastModeToggleEnabled(options?: {
  provider?: APIProvider
  targetKey?: string
}): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FAST_MODE)) {
    return false
  }
  return resolveFastModeProvider(options) !== null
}

export function isFastModeToggleAvailable(options?: {
  provider?: APIProvider
  targetKey?: string
}): boolean {
  const provider = resolveFastModeProvider(options)
  if (provider === 'firstParty') {
    return isAnthropicFastModeEnabled() && isAnthropicFastModeAvailable()
  }
  if (provider === 'codex') {
    return isFastModeToggleEnabled(options)
  }
  return false
}

export function isFastModeCooldownForProvider(options?: {
  provider?: APIProvider
  targetKey?: string
}): boolean {
  return resolveFastModeProvider(options) === 'firstParty'
    ? isAnthropicFastModeCooldown()
    : false
}

export function getFastModeUnavailableReasonForProvider(options?: {
  provider?: APIProvider
  targetKey?: string
}): string | null {
  const provider = resolveFastModeProvider(options)
  if (provider === 'firstParty') {
    return getAnthropicFastModeUnavailableReason()
  }
  if (provider === 'codex') {
    return isFastModeToggleEnabled(options) ? null : 'Fast mode is not available'
  }
  return 'Fast mode is not available for this provider'
}

export function isFastModeSupportedForProviderModel(
  provider: APIProvider | undefined,
  model: ModelSetting,
): boolean {
  if (provider === 'firstParty') {
    return isAnthropicFastModeSupportedByModel(model)
  }
  if (provider === 'codex') {
    return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FAST_MODE)
  }
  return false
}

export function isFastModeSupportedForModel(
  model: ModelSetting,
  options?: {
    provider?: APIProvider
    targetKey?: string
  },
): boolean {
  return isFastModeSupportedForProviderModel(
    resolveFastModeProvider(options) ?? undefined,
    model,
  )
}

export function shouldShowFastModeIcon(
  enabled: boolean | undefined,
  options?: {
    provider?: APIProvider
    targetKey?: string
  },
): boolean {
  if (!enabled) {
    return false
  }

  const provider = resolveFastModeProvider(options)
  if (provider === 'firstParty') {
    return isFastModeToggleAvailable(options) || isFastModeCooldownForProvider(options)
  }
  return provider === 'codex' && isFastModeToggleEnabled(options)
}

export function getInitialProviderFastModeSetting(
  model: ModelSetting,
  options?: {
    provider?: APIProvider
    targetKey?: string
    settings?: SettingsJson
  },
): boolean {
  const provider = resolveFastModeProvider(options)
  if (provider === 'firstParty') {
    return getAnthropicInitialFastModeSetting(model)
  }
  if (provider === 'codex') {
    const currentTarget = getCurrentProviderSelectionTarget()
    return (
      getPersistedServiceTierForProvider({
        settings: options?.settings ?? getInitialSettings(),
        provider,
        targetKey:
          options?.targetKey ??
          (currentTarget.provider === 'codex' ? currentTarget.targetKey : 'codex'),
      }) === 'fast'
    )
  }
  return false
}

export function getProviderFastModeState(
  model: ModelSetting,
  fastModeUserEnabled: boolean | undefined,
  options?: {
    provider?: APIProvider
    targetKey?: string
  },
): 'off' | 'cooldown' | 'on' {
  const provider = resolveFastModeProvider(options)
  if (provider === 'firstParty') {
    return getAnthropicFastModeState(model, fastModeUserEnabled)
  }
  if (provider === 'codex') {
    return fastModeUserEnabled ? 'on' : 'off'
  }
  return 'off'
}

export function getPersistedCodexFastModeSelection(options?: {
  settings?: SettingsJson
  targetKey?: string
}): PersistedServiceTier | undefined {
  const currentTarget = getCurrentProviderSelectionTarget()
  const targetKey =
    options?.targetKey ??
    (currentTarget.provider === 'codex' ? currentTarget.targetKey : 'codex')
  return getPersistedServiceTierForProvider({
    settings: options?.settings ?? getInitialSettings(),
    provider: 'codex',
    targetKey,
  })
}

export function getCodexServiceTierForFastMode(options?: {
  enabled?: boolean
  provider?: APIProvider
  targetKey?: string
}): CodexServiceTier | undefined {
  return resolveFastModeProvider(options) === 'codex' &&
    isFastModeToggleEnabled(options) &&
    options?.enabled
    ? 'priority'
    : undefined
}
