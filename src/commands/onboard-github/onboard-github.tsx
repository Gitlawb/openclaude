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
  saveGithubModelsToken,
} from '../../utils/githubModelsCredentials.js'
import { getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js'

const DEFAULT_MODEL = 'github:copilot'

type Step = 'menu' | 'device-busy' | 'error'

const PROVIDER_SPECIFIC_KEYS = new Set([
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GEMINI_ACCESS_TOKEN',
  'GEMINI_AUTH_MODE',
])

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
      const merged = mergeUserSettingsEnv(model.trim() || DEFAULT_MODEL)
      if (!merged.ok) {
        setErrorMsg(
          `Token saved, but settings were not updated: ${merged.detail ?? 'unknown error'}. ` +
            `Add env CLAUDE_CODE_USE_GITHUB=1 and OPENAI_MODEL to ~/.claude/settings.json manually.`,
        )
        setStep('error')
        return
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
              A browser window may have opened. Waiting for authorization…
            </Text>
          </>
        ) : (
          <Text dimColor>Requesting device code from GitHub…</Text>
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
        Sign in with your GitHub account to use Copilot models (GPT-4o, GPT-5,
        Claude, Gemini, and more). Your OAuth token is stored securely and
        exchanged for a Copilot API token automatically.
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

export const call: LocalJSXCommandCall = async (onDone, context) => {
  return (
    <OnboardGithub
      onDone={onDone}
      onChangeAPIKey={context.onChangeAPIKey}
    />
  )
}
