import {
  getGlobalConfig,
  saveGlobalConfig,
  type GlobalConfig,
} from './config.js'
import { logForDebugging } from './debug.js'
import {
  updateSettingsForSourceWithResult,
  wasSettingsUpdateCommitted,
} from './settings/settings.js'
import {
  commitSettingsTransition,
  rollbackModelSettingsTransition,
  type ModelSettingsTransition,
} from './settings/modelTransition.js'

export const STARTUP_PROVIDER_OVERRIDE_ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_MODEL',
  'OPENAI_API_KEYS',
  'OPENAI_API_KEY',
  'OPENAI_ORG',
  'OPENAI_PROJECT',
  'OPENAI_ORGANIZATION',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_CUSTOM_HEADERS',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GEMINI_ACCESS_TOKEN',
  'GEMINI_AUTH_MODE',
  'MISTRAL_BASE_URL',
  'MISTRAL_MODEL',
  'MISTRAL_API_KEY',
  'CODEX_API_KEY',
  'CODEX_CREDENTIAL_SOURCE',
  'CHATGPT_ACCOUNT_ID',
  'CODEX_ACCOUNT_ID',
  'MINIMAX_API_KEY',
  'MINIMAX_BASE_URL',
  'MINIMAX_MODEL',
  'NVIDIA_API_KEY',
  'NVIDIA_NIM',
  'VENICE_API_KEY',
  'LONGCAT_API_KEY',
] as const

export type GlobalConfigWithEnv = {
  env?: Record<string, string>
}

export type StartupProviderOverrideRollback = () => string | null

type SettingsEnvPatch = Partial<
  Record<(typeof STARTUP_PROVIDER_OVERRIDE_ENV_KEYS)[number], string>
>

const DELETE_SETTINGS_ENV_VALUE = undefined as unknown as string

export function clearStartupProviderOverrides(options?: {
  model?: string | null
  updateUserSettings?: typeof updateSettingsForSourceWithResult
  saveConfig?: (
    updater: (current: GlobalConfigWithEnv) => GlobalConfigWithEnv,
  ) => unknown
  commitTransition?: typeof commitSettingsTransition
  onCommittedTransition?: (
    transition: ModelSettingsTransition,
    rollbackGlobalConfig: StartupProviderOverrideRollback,
  ) => void
}): string | null {
  const updateUserSettings = options?.updateUserSettings ?? updateSettingsForSourceWithResult
  const saveConfig =
    options?.saveConfig ??
    ((updater: (current: GlobalConfigWithEnv) => GlobalConfigWithEnv) =>
      saveGlobalConfig(
        updater as unknown as (currentConfig: GlobalConfig) => GlobalConfig,
      ))
  const envPatch = Object.fromEntries(
    STARTUP_PROVIDER_OVERRIDE_ENV_KEYS.map(key => [
      key,
      DELETE_SETTINGS_ENV_VALUE,
    ]),
  ) as SettingsEnvPatch

  const settingsPatch = {
    env: envPatch,
    ...(options && 'model' in options
      ? { model: options.model ?? undefined }
      : {}),
  }
  const settingsTransition = options?.updateUserSettings
    ? {
        result: updateUserSettings('userSettings', settingsPatch),
        transition: undefined,
      }
    : (options?.commitTransition ?? commitSettingsTransition)(settingsPatch)
  const settingsResult = settingsTransition.result
  if (!wasSettingsUpdateCommitted(settingsResult)) {
    return settingsResult.error?.message ?? 'Settings update was not written'
  } else if (settingsResult.error) {
    // The override bytes reached disk. Preserve that committed truth for
    // callers while retaining the release/cleanup warning in diagnostics.
    logForDebugging(
      `Startup provider override was cleared, but settings cleanup failed: ${settingsResult.error.message}`,
      { level: 'warn' },
    )
  }

  let globalConfigError: string | null = null
  let previousGlobalOverrides: Record<string, string> = {}
  try {
    let updaterRan = false
    const saveResult = saveConfig((current: GlobalConfigWithEnv) => {
      updaterRan = true
      const currentEnv = current.env ?? {}
      previousGlobalOverrides = Object.fromEntries(
        STARTUP_PROVIDER_OVERRIDE_ENV_KEYS.flatMap(key =>
          key in currentEnv ? [[key, currentEnv[key]!] as const] : [],
        ),
      )
      let changed = false
      const nextEnv = { ...currentEnv }
      for (const key of STARTUP_PROVIDER_OVERRIDE_ENV_KEYS) {
        if (key in nextEnv) {
          delete nextEnv[key]
          changed = true
        }
      }
      return changed ? { ...current, env: nextEnv } : current
    })
    const persistedConfig =
      saveResult && typeof saveResult === 'object'
        ? (saveResult as GlobalConfigWithEnv)
        : options?.saveConfig
          ? null
          : getGlobalConfig()
    const hasPersistedOverride = STARTUP_PROVIDER_OVERRIDE_ENV_KEYS.some(
      key => key in (persistedConfig?.env ?? {}),
    )
    if (!updaterRan || hasPersistedOverride) {
      globalConfigError = 'Global config update was not applied'
    }
  } catch (configError) {
    globalConfigError =
      configError instanceof Error ? configError.message : String(configError)
  }

  if (globalConfigError && settingsTransition.transition) {
    const rollback = rollbackModelSettingsTransition(
      settingsTransition.transition,
    )
    if (rollback.status === 'failed') {
      globalConfigError += `; settings rollback failed: ${rollback.error}`
    }
  }

  if (!globalConfigError && settingsTransition.transition) {
    const rollbackGlobalConfig: StartupProviderOverrideRollback = () => {
      try {
        const saveResult = saveConfig((current: GlobalConfigWithEnv) => {
          const currentEnv = current.env ?? {}
          const hasConflictingOverride = STARTUP_PROVIDER_OVERRIDE_ENV_KEYS.some(
            key =>
              key in currentEnv &&
              currentEnv[key] !== previousGlobalOverrides[key],
          )
          if (hasConflictingOverride) return current
          return {
            ...current,
            env: { ...currentEnv, ...previousGlobalOverrides },
          }
        })
        const persistedConfig =
          saveResult && typeof saveResult === 'object'
            ? (saveResult as GlobalConfigWithEnv)
            : options?.saveConfig
              ? null
              : getGlobalConfig()
        const persistedEnv = persistedConfig?.env ?? {}
        const restored = STARTUP_PROVIDER_OVERRIDE_ENV_KEYS.every(key =>
          key in previousGlobalOverrides
            ? persistedEnv[key] === previousGlobalOverrides[key]
            : !(key in persistedEnv),
        )
        return restored
          ? null
          : 'Global provider override rollback was not applied'
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    options?.onCommittedTransition?.(
      settingsTransition.transition,
      rollbackGlobalConfig,
    )
  }

  return globalConfigError
}
