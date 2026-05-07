import * as React from 'react'

import {
  openVerificationUri,
  pollCodexDeviceToken,
  requestCodexDeviceCode,
} from '../services/api/codexDeviceFlow.js'
import type { CodexOAuthTokens } from '../services/api/codexOAuth.js'
import { saveCodexCredentials } from '../utils/codexCredentials.js'
import { isBareMode } from '../utils/envUtils.js'

export type CodexDeviceCodeFlowStatus =
  | { state: 'starting' }
  | {
      state: 'waiting'
      userCode: string
      verificationUri: string
      verificationUriComplete?: string
      expiresIn: number
      interval: number
      browserOpened: boolean | null
    }
  | {
      state: 'error'
      message: string
    }

type PersistCodexCredentials = (options?: {
  profileId?: string
}) => void

type CodexDeviceCodeFlowDependencies = {
  requestCodexDeviceCode?: typeof requestCodexDeviceCode
  pollCodexDeviceToken?: typeof pollCodexDeviceToken
  openVerificationUri?: typeof openVerificationUri
  saveCodexCredentials?: typeof saveCodexCredentials
  isBareMode?: typeof isBareMode
}

export function useCodexDeviceCodeFlow(options: {
  onAuthenticated: (
    tokens: CodexOAuthTokens,
    persistCredentials: PersistCodexCredentials,
  ) => void | Promise<void>
  deps?: CodexDeviceCodeFlowDependencies
}): CodexDeviceCodeFlowStatus {
  const { onAuthenticated } = options
  const requestDeviceCode =
    options.deps?.requestCodexDeviceCode ?? requestCodexDeviceCode
  const pollDeviceToken =
    options.deps?.pollCodexDeviceToken ?? pollCodexDeviceToken
  const openVerificationUriFn =
    options.deps?.openVerificationUri ?? openVerificationUri
  const saveCredentials =
    options.deps?.saveCodexCredentials ?? saveCodexCredentials
  const isBareModeFn = options.deps?.isBareMode ?? isBareMode
  const [status, setStatus] = React.useState<CodexDeviceCodeFlowStatus>({
    state: 'starting',
  })

  React.useEffect(() => {
    if (isBareModeFn()) {
      setStatus({
        state: 'error',
        message:
          'Codex device-code sign-in is unavailable in --bare because secure storage is disabled.',
      })
      return
    }

    let cancelled = false
    const controller = new AbortController()

    void (async () => {
      try {
        const deviceCode = await requestDeviceCode()
        if (cancelled) return

        setStatus({
          state: 'waiting',
          userCode: deviceCode.userCode,
          verificationUri: deviceCode.verificationUri,
          verificationUriComplete: deviceCode.verificationUriComplete,
          expiresIn: deviceCode.expiresIn,
          interval: deviceCode.interval,
          browserOpened: null,
        })

        const browserOpened = await openVerificationUriFn(
          deviceCode.verificationUriComplete ?? deviceCode.verificationUri,
        )
        if (cancelled) return

        setStatus({
          state: 'waiting',
          userCode: deviceCode.userCode,
          verificationUri: deviceCode.verificationUri,
          verificationUriComplete: deviceCode.verificationUriComplete,
          expiresIn: deviceCode.expiresIn,
          interval: deviceCode.interval,
          browserOpened,
        })

        const tokens = await pollDeviceToken(deviceCode.deviceCode, {
          initialInterval: deviceCode.interval,
          timeoutSeconds: deviceCode.expiresIn,
          signal: controller.signal,
        })
        if (cancelled) return

        const persistCredentials: PersistCodexCredentials = options => {
          const saved = saveCredentials({
            apiKey: tokens.apiKey,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            idToken: tokens.idToken,
            accountId: tokens.accountId,
            profileId: options?.profileId,
          })
          if (!saved.success) {
            throw new Error(
              saved.warning ??
                'Codex device-code sign-in succeeded, but credentials could not be saved securely.',
            )
          }
        }

        await onAuthenticated(tokens, persistCredentials)
      } catch (error) {
        if (cancelled) return
        setStatus({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    isBareModeFn,
    onAuthenticated,
    openVerificationUriFn,
    pollDeviceToken,
    requestDeviceCode,
    saveCredentials,
  ])

  return status
}
