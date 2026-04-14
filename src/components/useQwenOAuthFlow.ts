import * as React from 'react'

import { QwenOAuthService, type QwenOAuthTokens } from '../services/api/qwenOAuthService.js'
import { openBrowser } from '../utils/browser.js'
import { saveQwenCredentials, type QwenStoredCredentials } from '../services/api/qwenCredentials.js'

export type QwenOAuthFlowStatus =
  | { state: 'starting' }
  | {
      state: 'waiting'
      authUrl: string
      userCode: string
      browserOpened: boolean | null
    }
  | {
      state: 'error'
      message: string
    }

type PersistQwenOAuthCredentials = () => void

type QwenOAuthFlowDependencies = {
  createOAuthService?: () => QwenOAuthService
  openBrowser?: typeof openBrowser
  saveQwenCredentials?: typeof saveQwenCredentials
}

function createDefaultOAuthService(): QwenOAuthService {
  return new QwenOAuthService()
}

export function useQwenOAuthFlow(options: {
  onAuthenticated: (
    tokens: QwenOAuthTokens,
    persistCredentials: PersistQwenOAuthCredentials,
  ) => void | Promise<void>
  deps?: QwenOAuthFlowDependencies
}): QwenOAuthFlowStatus {
  const { onAuthenticated } = options
  const createOAuthService =
    options.deps?.createOAuthService ?? createDefaultOAuthService
  const openBrowserFn = options.deps?.openBrowser ?? openBrowser
  const saveCredentials =
    options.deps?.saveQwenCredentials ?? saveQwenCredentials
  const [status, setStatus] = React.useState<QwenOAuthFlowStatus>({
    state: 'starting',
  })

  React.useEffect(() => {
    let cancelled = false
    const oauthService = createOAuthService()

    void oauthService
      .startOAuthFlow(async (authUrl, userCode) => {
        if (cancelled) return
        setStatus({
          state: 'waiting',
          authUrl,
          userCode,
          browserOpened: null,
        })
        const browserOpened = await openBrowserFn(authUrl)
        if (cancelled) return
        setStatus({
          state: 'waiting',
          authUrl,
          userCode,
          browserOpened,
        })
      })
      .then(async tokens => {
        if (cancelled) return

        const persistCredentials: PersistQwenOAuthCredentials = () => {
          const stored: QwenStoredCredentials = {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            resourceUrl: tokens.resourceUrl,
            expiryDate: tokens.expiryDate,
            accountId: `qwen-${Date.now()}`,
            lastRefreshAt: Date.now(),
          }
          return saveCredentials(stored)
        }

        await onAuthenticated(tokens, persistCredentials)
      })
      .catch(error => {
        if (cancelled) return
        setStatus({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      cancelled = true
      oauthService.cancel()
    }
  }, [createOAuthService, openBrowserFn, saveCredentials, onAuthenticated])

  return status
}
