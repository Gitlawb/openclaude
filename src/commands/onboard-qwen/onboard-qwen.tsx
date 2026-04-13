import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Select } from '../../components/CustomSelect/select.js'
import { Spinner } from '../../components/Spinner.js'
import { Box, Text } from '../../ink.js'
import {
  openQwenVerificationUri,
  pollQwenDeviceToken,
  requestQwenDeviceCode,
} from '../../services/qwen/deviceFlow.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  fromTokenResponse,
  hydrateQwenCredentialsFromDisk,
  loadQwenCredentials,
  saveQwenCredentials,
} from '../../utils/qwenCredentials.js'
import { resolveQwenBaseUrl } from '../../services/qwen/deviceFlow.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

const DEFAULT_MODEL = 'qwen3-coder-plus'

const FORCE_RELOGIN_ARGS = new Set([
  'force',
  '--force',
  'relogin',
  '--relogin',
  'reauth',
  '--reauth',
])

const PROVIDER_SPECIFIC_KEYS = new Set([
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
])

type Step = 'menu' | 'device-busy' | 'error'

export function shouldForceQwenRelogin(args?: string): boolean {
  const normalized = (args ?? '').trim().toLowerCase()
  if (!normalized) return false
  return normalized.split(/\s+/).some(arg => FORCE_RELOGIN_ARGS.has(arg))
}

export function hasExistingQwenLogin(): boolean {
  const creds = loadQwenCredentials()
  if (!creds) return false
  // Even if expired, the refresh token lets us recover silently — treat as present.
  return Boolean(creds.refresh_token)
}

function applyQwenProcessEnv(
  model: string,
  baseUrl: string,
  accessToken: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const key of PROVIDER_SPECIFIC_KEYS) {
    delete env[key]
  }
  env.CLAUDE_CODE_USE_QWEN = '1'
  env.OPENAI_BASE_URL = baseUrl
  env.OPENAI_MODEL = model
  env.OPENAI_API_KEY = accessToken
  delete env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
  delete env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
}

function mergeUserSettingsEnv(
  model: string,
  baseUrl: string,
): { ok: boolean; detail?: string } {
  const current = getSettingsForSource('userSettings')
  const currentEnv = current?.env ?? {}

  const nextEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(currentEnv)) {
    if (!PROVIDER_SPECIFIC_KEYS.has(key)) {
      nextEnv[key] = value
    }
  }

  nextEnv.CLAUDE_CODE_USE_QWEN = '1'
  nextEnv.OPENAI_MODEL = model
  nextEnv.OPENAI_BASE_URL = baseUrl

  const { error } = updateSettingsForSource('userSettings', { env: nextEnv })
  if (error) {
    return { ok: false, detail: error.message }
  }
  return { ok: true }
}

function OnboardQwen(props: {
  onDone: Parameters<LocalJSXCommandCall>[0]
  onChangeAPIKey: () => void
}): React.ReactNode {
  const { onDone, onChangeAPIKey } = props
  const [step, setStep] = useState<Step>('menu')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [deviceHint, setDeviceHint] = useState<{
    user_code: string
    verification_uri: string
    verification_uri_complete: string
  } | null>(null)
  const startedRef = useRef(false)

  const runDeviceFlow = useCallback(async () => {
    setStep('device-busy')
    setErrorMsg(null)
    setDeviceHint(null)
    try {
      const device = await requestQwenDeviceCode()
      setDeviceHint({
        user_code: device.user_code,
        verification_uri: device.verification_uri,
        verification_uri_complete: device.verification_uri_complete,
      })
      await openQwenVerificationUri(device.verification_uri_complete)
      const token = await pollQwenDeviceToken(
        device.device_code,
        device.code_verifier,
        {
          initialInterval: device.interval,
          timeoutSeconds: device.expires_in,
        },
      )
      const creds = fromTokenResponse(token)
      const saved = saveQwenCredentials(creds)
      if (!saved.success) {
        setErrorMsg(saved.warning ?? 'Could not save Qwen credentials to disk.')
        setStep('error')
        return
      }
      const baseUrl = resolveQwenBaseUrl(creds.resource_url)
      const merged = mergeUserSettingsEnv(DEFAULT_MODEL, baseUrl)
      if (!merged.ok) {
        setErrorMsg(
          `Credentials saved, but user settings update failed: ${merged.detail ?? 'unknown error'}. ` +
            'Add CLAUDE_CODE_USE_QWEN=1 and OPENAI_MODEL=qwen3-coder-plus to ~/.claude/settings.json manually.',
        )
        setStep('error')
        return
      }
      applyQwenProcessEnv(DEFAULT_MODEL, baseUrl, creds.access_token)
      hydrateQwenCredentialsFromDisk()
      onChangeAPIKey()
      onDone(
        `Qwen OAuth complete. Credentials saved to ~/.qwen/oauth_creds.json; model ${DEFAULT_MODEL} activated. Restart if the model does not switch.`,
        { display: 'user' },
      )
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }, [onChangeAPIKey, onDone])

  // Auto-start the flow: this command has no useful pre-flow choice.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void runDeviceFlow()
  }, [runDeviceFlow])

  if (step === 'error' && errorMsg) {
    const options = [
      { label: 'Retry', value: 'retry' as const },
      { label: 'Cancel', value: 'cancel' as const },
    ]
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="red">{errorMsg}</Text>
        <Select
          options={options}
          onChange={(v: string) => {
            if (v === 'retry') {
              void runDeviceFlow()
            } else {
              onDone('Qwen onboard cancelled', { display: 'system' })
            }
          }}
        />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Qwen OAuth sign-in</Text>
      {deviceHint ? (
        <>
          <Text>
            Enter code <Text bold>{deviceHint.user_code}</Text> at{' '}
            {deviceHint.verification_uri}
          </Text>
          <Text dimColor>
            A browser window may have opened at{' '}
            {deviceHint.verification_uri_complete}. Waiting for authorization...
          </Text>
        </>
      ) : (
        <Text dimColor>Requesting device code from chat.qwen.ai...</Text>
      )}
      <Spinner />
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const forceRelogin = shouldForceQwenRelogin(args)
  if (hasExistingQwenLogin() && !forceRelogin) {
    hydrateQwenCredentialsFromDisk()
    const merged = mergeUserSettingsEnv(
      DEFAULT_MODEL,
      process.env.OPENAI_BASE_URL ?? 'https://portal.qwen.ai/v1',
    )
    if (!merged.ok) {
      onDone(
        `Qwen credentials detected, but user settings activation failed: ${merged.detail ?? 'unknown error'}. ` +
          'Set CLAUDE_CODE_USE_QWEN=1 and OPENAI_MODEL=qwen3-coder-plus in user settings manually.',
        { display: 'system' },
      )
      return null
    }
    context.onChangeAPIKey()
    onDone(
      'Qwen already authorized. Activated Qwen mode using existing credentials. Use /onboard-qwen --force to re-authenticate.',
      { display: 'user' },
    )
    return null
  }

  return (
    <OnboardQwen onDone={onDone} onChangeAPIKey={context.onChangeAPIKey} />
  )
}
