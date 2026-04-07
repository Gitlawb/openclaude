import * as React from 'react'
import { useCallback, useState } from 'react'
import { Select } from '../../components/CustomSelect/select.js'
import { Spinner } from '../../components/Spinner.js'
import { Box, Text } from '../../ink.js'
import {
  exchangeForCopilotToken,
  openVerificationUri,
  pollAccessToken,
  requestDeviceCode,
} from '../../services/github/deviceFlow.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  hydrateGithubModelsTokenFromSecureStorage,
  readGithubModelsToken,
  saveGithubModelsToken,
} from '../../utils/githubModelsCredentials.js'
import { getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js'

const DEFAULT_MODEL = 'github:copilot'
const FORCE_RELOGIN_ARGS = new Set([
  'force',
  '--force',
  'relogin',
  '--relogin',
  'reauth',
  '--reauth',
])

type Step = 'menu' | 'device-busy' | 'error'

const PROVIDER_SPECIFIC_KEYS = new Set([
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GEMINI_ACCESS_TOKEN',
  'GEMINI_AUTH_MODE',
])

export function shouldForceGithubRelogin(args?: string): boolean {
  const normalized = (args ?? '').trim().toLowerCase()
  if (!normalized) {
    return false
  }
  return normalized.split(/\s+/).some(arg => FORCE_RELOGIN_ARGS.has(arg))
}

export function hasExistingGithubModelsLoginToken(
  env: NodeJS.ProcessEnv = process.env,
  storedToken?: string,
): boolean {
  const envToken = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim()
  if (envToken) {
    return true
  }
  const persisted = (storedToken ?? readGithubModelsToken())?.trim()
  return Boolean(persisted)
}

export function buildGithubOnboardingSettingsEnv(
  model: string,
): Record<string, string | undefined> {
  return {
    CLAUDE_CODE_USE_GITHUB: '1',
    OPENAI_MODEL: model,
    OPENAI_API_KEY: undefined,
    OPENAI_ORG: undefined,
    OPENAI_PROJECT: undefined,
    OPENAI_ORGANIZATION: undefined,
    OPENAI_BASE_URL: undefined,
    OPENAI_API_BASE: undefined,
    CLAUDE_CODE_USE_OPENAI: undefined,
    CLAUDE_CODE_USE_GEMINI: undefined,
    CLAUDE_CODE_USE_BEDROCK: undefined,
    CLAUDE_CODE_USE_VERTEX: undefined,
    CLAUDE_CODE_USE_FOUNDRY: undefined,
  }
}

export function applyGithubOnboardingProcessEnv(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  env.CLAUDE_CODE_USE_GITHUB = '1'
  env.OPENAI_MODEL = model

  delete env.OPENAI_API_KEY
  delete env.OPENAI_ORG
  delete env.OPENAI_PROJECT
  delete env.OPENAI_ORGANIZATION
  delete env.OPENAI_BASE_URL
  delete env.OPENAI_API_BASE

  delete env.CLAUDE_CODE_USE_OPENAI
  delete env.CLAUDE_CODE_USE_GEMINI
  delete env.CLAUDE_CODE_USE_BEDROCK
  delete env.CLAUDE_CODE_USE_VERTEX
  delete env.CLAUDE_CODE_USE_FOUNDRY
  delete env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
  delete env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
}

function mergeUserSettingsEnv(model: string): { ok: boolean; detail?: string } {
  const currentSettings = getSettingsForSource('userSettings')
  const currentEnv = currentSettings?.env ?? {}

  const newEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(currentEnv)) {
    if (!PROVIDER_SPECIFIC_KEYS.has(key)) {
      newEnv[key] = value
    }
  }

  newEnv.CLAUDE_CODE_USE_GITHUB = '1'
  newEnv.OPENAI_MODEL = model

  const { error } = updateSettingsForSource('userSettings', {
    env: newEnv,
  })
  if (error) {
    return { ok: false, detail: error.message }
  }
  return { ok: true }
}

export function activateGithubOnboardingMode(
  model: string = DEFAULT_MODEL,
  options?: {
    mergeSettingsEnv?: (model: string) => { ok: boolean; detail?: string }
    applyProcessEnv?: (model: string) => void
    hydrateToken?: () => void
    onChangeAPIKey?: () => void
  },
): { ok: boolean; detail?: string } {
  const normalizedModel = model.trim() || DEFAULT_MODEL
  const mergeSettingsEnv = options?.mergeSettingsEnv ?? mergeUserSettingsEnv
  const applyProcessEnv = options?.applyProcessEnv ?? applyGithubOnboardingProcessEnv
  const hydrateToken =
    options?.hydrateToken ?? hydrateGithubModelsTokenFromSecureStorage

  const merged = mergeSettingsEnv(normalizedModel)
  if (!merged.ok) {
    return merged
  }

  applyProcessEnv(normalizedModel)
  hydrateToken()
  options?.onChangeAPIKey?.()
  return { ok: true }
}

function OnboardGithub(props: {
  onDone: Parameters<LocalJSXCommandCall>[0]
  onChangeAPIKey: () => void
}): React.ReactNode {
  const { onDone, onChangeAPIKey } = props
  const [step, setStep] = useState<Step>('menu')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [deviceHint, setDeviceHint] = useState<{
    user_code: string
    verification_uri: string
  } | null>(null)

  const finalize = useCallback(
    async (
      token: string,
      model: string = DEFAULT_MODEL,
      oauthToken?: string,
    ) => {
      const saved = saveGithubModelsToken(token, oauthToken)
      if (!saved.success) {
        setErrorMsg(saved.warning ?? 'Could not save token to secure storage.')
        setStep('error')
        return
      }
      const activated = activateGithubOnboardingMode(model, {
        onChangeAPIKey,
      })
      if (!activated.ok) {
        setErrorMsg(
          `Token saved, but settings were not updated: ${activated.detail ?? 'unknown error'}. ` +
            `Add env CLAUDE_CODE_USE_GITHUB=1 and OPENAI_MODEL to ~/.claude/settings.json manually.`,
        )
        setStep('error')
        return
      }
      // Clear stale provider-specific env vars from the current session
      // so resolveProviderRequest() doesn't pick up a previous provider's
      // base URL or key after onboarding completes.
      for (const key of PROVIDER_SPECIFIC_KEYS) {
        delete process.env[key]
      }
      process.env.CLAUDE_CODE_USE_GITHUB = '1'
      process.env.OPENAI_MODEL = model.trim() || DEFAULT_MODEL
      hydrateGithubModelsTokenFromSecureStorage()
      onChangeAPIKey()
      onDone(
        'GitHub Copilot onboard complete. Copilot token and OAuth token stored in secure storage (Windows/Linux: ~/.claude/.credentials.json, macOS: Keychain fallback to ~/.claude/.credentials.json); user settings updated. Restart if the model does not switch.',
        { display: 'user' },
      )
    },
    [onChangeAPIKey, onDone],
  )

  const runDeviceFlow = useCallback(async () => {
    setStep('device-busy')
    setErrorMsg(null)
    setDeviceHint(null)
    try {
      const device = await requestDeviceCode()
      setDeviceHint({
        user_code: device.user_code,
        verification_uri: device.verification_uri,
      })
      await openVerificationUri(device.verification_uri)
      const oauthToken = await pollAccessToken(device.device_code, {
        initialInterval: device.interval,
        timeoutSeconds: device.expires_in,
      })
      const copilotToken = await exchangeForCopilotToken(oauthToken)
      await finalize(copilotToken.token, DEFAULT_MODEL, oauthToken)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }, [finalize])

  if (step === 'error' && errorMsg) {
    const options = [
      {
        label: 'Back to menu',
        value: 'back' as const,
      },
      {
        label: 'Exit',
        value: 'exit' as const,
      },
    ]
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="red">{errorMsg}</Text>
        <Select
          options={options}
          onChange={(v: string) => {
            if (v === 'back') {
              setStep('menu')
              setErrorMsg(null)
            } else {
              onDone('GitHub onboard cancelled', { display: 'system' })
            }
          }}
        />
      </Box>
    )
  }

  if (step === 'device-busy') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text>GitHub Copilot sign-in</Text>
        {deviceHint ? (
          <>
            <Text>
              Enter code <Text bold>{deviceHint.user_code}</Text> at{' '}
              {deviceHint.verification_uri}
            </Text>
            <Text dimColor>
              A browser window may have opened. Waiting for authorization...
            </Text>
          </>
        ) : (
          <Text dimColor>Requesting device code from GitHub...</Text>
        )}
        <Spinner />
      </Box>
    )
  }

  const menuOptions = [
    {
      label: 'Sign in with browser',
      value: 'device' as const,
    },
    {
      label: 'Cancel',
      value: 'cancel' as const,
    },
  ]

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>GitHub Copilot setup</Text>
      <Text dimColor>
        Stores your token in the OS credential store (macOS Keychain when available)
        and enables CLAUDE_CODE_USE_GITHUB in your user settings - no export
        GITHUB_TOKEN needed for future runs.
      </Text>
      <Select
        options={menuOptions}
        onChange={(v: string) => {
          if (v === 'cancel') {
            onDone('GitHub onboard cancelled', { display: 'system' })
            return
          }
          void runDeviceFlow()
        }}
      />
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const forceRelogin = shouldForceGithubRelogin(args)
  if (hasExistingGithubModelsLoginToken() && !forceRelogin) {
    const activated = activateGithubOnboardingMode(DEFAULT_MODEL, {
      onChangeAPIKey: context.onChangeAPIKey,
    })
    if (!activated.ok) {
      onDone(
        `GitHub token detected, but settings activation failed: ${activated.detail ?? 'unknown error'}. ` +
          'Set CLAUDE_CODE_USE_GITHUB=1 and OPENAI_MODEL=github:copilot in user settings manually.',
        { display: 'system' },
      )
      return null
    }

    onDone(
      'GitHub Models already authorized. Activated GitHub Models mode using your existing token. Use /onboard-github --force to re-authenticate.',
      { display: 'user' },
    )
    return null
  }

  return (
    <OnboardGithub
      onDone={onDone}
      onChangeAPIKey={context.onChangeAPIKey}
    />
  )
}
