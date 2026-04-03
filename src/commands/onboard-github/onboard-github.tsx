import * as React from 'react'
import { useCallback, useState } from 'react'
import { Select } from '../../components/CustomSelect/select.js'
import { Spinner } from '../../components/Spinner.js'
import TextInput from '../../components/TextInput.js'
import { Box, Text } from '../../ink.js'
import {
  openVerificationUri,
  pollAccessToken,
  requestDeviceCode,
} from '../../services/github/deviceFlow.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  hydrateGithubModelsTokenFromSecureStorage,
  saveGithubModelsToken,
} from '../../utils/githubModelsCredentials.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

const DEFAULT_MODEL = 'github:copilot'

type Step = 'menu' | 'device-busy' | 'pat' | 'success' | 'error'

export function buildGithubUserSettingsEnv(model: string): Record<string, string | undefined> {
  const resolvedModel = model.trim() || DEFAULT_MODEL
  return {
    CLAUDE_CODE_USE_GITHUB: '1',
    OPENAI_MODEL: resolvedModel,
    CLAUDE_CODE_USE_OPENAI: undefined,
    CLAUDE_CODE_USE_GROQ: undefined,
    CLAUDE_CODE_USE_GEMINI: undefined,
    CLAUDE_CODE_USE_BEDROCK: undefined,
    CLAUDE_CODE_USE_VERTEX: undefined,
    CLAUDE_CODE_USE_FOUNDRY: undefined,
    OPENAI_BASE_URL: undefined,
    OPENAI_API_KEY: undefined,
    GEMINI_API_KEY: undefined,
    GEMINI_MODEL: undefined,
    GEMINI_BASE_URL: undefined,
    GOOGLE_API_KEY: undefined,
    CODEX_API_KEY: undefined,
    CHATGPT_ACCOUNT_ID: undefined,
    CODEX_ACCOUNT_ID: undefined,
  }
}

export function mergeUserSettingsEnv(model: string): { ok: boolean; detail?: string } {
  const { error } = updateSettingsForSource('userSettings', {
    env: buildGithubUserSettingsEnv(model),
  })
  if (error) {
    return { ok: false, detail: error.message }
  }
  return { ok: true }
}

export function applyGithubEnvToProcess(model: string): void {
  const resolvedModel = model.trim() || DEFAULT_MODEL
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = resolvedModel

  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GROQ
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_BASE_URL
  delete process.env.GOOGLE_API_KEY
  delete process.env.CODEX_API_KEY
  delete process.env.CHATGPT_ACCOUNT_ID
  delete process.env.CODEX_ACCOUNT_ID
}

function isLikelyGithubToken(value: string): boolean {
  return /^(github_pat_|ghp_|gho_|ghu_|ghs_|ghr_)/.test(value.trim())
}

function validatePatToken(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Token is required.'
  if (!isLikelyGithubToken(trimmed)) {
    return 'Enter a GitHub token such as github_pat_... or ghp_...'
  }
  return null
}

function getSuccessMessage(model: string): string {
  const resolvedModel = model.trim() || DEFAULT_MODEL
  return [
    'GitHub Models onboard complete.',
    `Model: ${resolvedModel}`,
    'Token stored in secure storage and user settings updated.',
    'Restart if the active model does not switch immediately.',
  ].join('\n')
}

function OnboardGithub(props: {
  onDone: Parameters<LocalJSXCommandCall>[0]
  onChangeAPIKey: () => void
}): React.ReactNode {
  const { onDone, onChangeAPIKey } = props
  const [step, setStep] = useState<Step>('menu')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [deviceHint, setDeviceHint] = useState<{
    user_code: string
    verification_uri: string
  } | null>(null)
  const [patDraft, setPatDraft] = useState('')
  const [cursorOffset, setCursorOffset] = useState(0)
  const [patValidationError, setPatValidationError] = useState<string | null>(null)

  const finalize = useCallback(
    async (token: string, model: string = DEFAULT_MODEL) => {
      const saved = saveGithubModelsToken(token)
      if (!saved.success) {
        setErrorMsg(saved.warning ?? 'Could not save token to secure storage.')
        setStep('error')
        return
      }

      const resolvedModel = model.trim() || DEFAULT_MODEL
      const merged = mergeUserSettingsEnv(resolvedModel)
      if (!merged.ok) {
        setErrorMsg(
          `Token saved, but settings were not updated: ${merged.detail ?? 'unknown error'}. Add env CLAUDE_CODE_USE_GITHUB=1 and OPENAI_MODEL to ~/.claude/settings.json manually.`,
        )
        setStep('error')
        return
      }

      applyGithubEnvToProcess(resolvedModel)
      hydrateGithubModelsTokenFromSecureStorage()
      onChangeAPIKey()
      setPatDraft('')
      setCursorOffset(0)
      setPatValidationError(null)
      const message = getSuccessMessage(resolvedModel)
      setSuccessMsg(message)
      setStep('success')
      onDone(message, { display: 'user' })
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
      const token = await pollAccessToken(device.device_code, {
        initialInterval: device.interval,
        timeoutSeconds: device.expires_in,
      })
      await finalize(token, DEFAULT_MODEL)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }, [finalize])

  if (step === 'error' && errorMsg) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>GitHub Models setup failed</Text>
        <Text color="red">{errorMsg}</Text>
        <Text dimColor>Review the error or go back to retry.</Text>
        <Select
          options={[
            { label: 'Back to menu', value: 'back' as const },
            { label: 'Exit', value: 'exit' as const },
          ]}
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

  if (step === 'success' && successMsg) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>GitHub Models setup complete</Text>
        <Text color="green">{successMsg}</Text>
        <Text dimColor>Continue in this session or restart if the active model indicator does not refresh.</Text>
        <Select
          options={[
            { label: 'Done', value: 'done' as const },
            { label: 'Back to menu', value: 'back' as const },
          ]}
          onChange={(v: string) => {
            if (v === 'back') {
              setStep('menu')
              return
            }
            onDone(undefined, { display: 'system' })
          }}
        />
      </Box>
    )
  }

  if (step === 'device-busy') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>GitHub device login</Text>
        <Text dimColor>Complete GitHub authorization in your browser.</Text>
        {deviceHint ? (
          <>
            <Text>
              Enter code <Text bold>{deviceHint.user_code}</Text> at {deviceHint.verification_uri}
            </Text>
            <Text dimColor>A browser window may have opened. Waiting for authorization…</Text>
          </>
        ) : (
          <Text dimColor>Requesting device code from GitHub…</Text>
        )}
        <Spinner />
      </Box>
    )
  }

  if (step === 'pat') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>GitHub personal access token</Text>
        <Text>Paste a GitHub personal access token with access to GitHub Models.</Text>
        <Text dimColor>Input is masked. Enter to submit; Esc to go back.</Text>
        <TextInput
          value={patDraft}
          mask="*"
          onChange={value => {
            setPatDraft(value)
            if (patValidationError) setPatValidationError(null)
          }}
          onSubmit={async (value: string) => {
            const validationError = validatePatToken(value)
            if (validationError) {
              setPatValidationError(validationError)
              return
            }
            await finalize(value.trim(), DEFAULT_MODEL)
          }}
          onExit={() => {
            setStep('menu')
            setPatDraft('')
            setCursorOffset(0)
            setPatValidationError(null)
          }}
          columns={80}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          placeholder="github_pat_..."
        />
        {patValidationError ? <Text color="red">{patValidationError}</Text> : null}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>GitHub Models setup</Text>
      <Text dimColor>
        Stores your token in secure storage and switches user settings to GitHub Models
        without needing GITHUB_TOKEN in future runs.
      </Text>
      <Select
        options={[
          { label: 'Sign in with browser (device code)', value: 'device' as const },
          { label: 'Paste personal access token', value: 'pat' as const },
          { label: 'Cancel', value: 'cancel' as const },
        ]}
        onChange={(v: string) => {
          if (v === 'cancel') {
            onDone('GitHub onboard cancelled', { display: 'system' })
            return
          }
          if (v === 'pat') {
            setStep('pat')
            return
          }
          void runDeviceFlow()
        }}
      />
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, context) => {
  return <OnboardGithub onDone={onDone} onChangeAPIKey={context.onChangeAPIKey} />
}
