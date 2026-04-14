import * as React from 'react'

import {
  GeminiOAuthService,
  type GeminiOAuthTokens,
} from '../services/api/geminiOAuth.js'
import { openBrowser } from '../utils/browser.js'
import { saveGeminiAccessToken } from '../utils/geminiCredentials.js'
import { isBareMode } from '../utils/envUtils.js'

export type GeminiOAuthFlowStatus =
  | { state: 'starting' }
  | {
      state: 'waiting'
      authUrl: string
      browserOpened: boolean | null
    }
  | {
      state: 'error'
      message: string
    }

type PersistGeminiOAuthCredentials = () => void

type GeminiOAuthFlowDependencies = {
  createOAuthService?: () => Pick<
    GeminiOAuthService,
    'startOAuthFlow' | 'cleanup'
  >
  openBrowser?: typeof openBrowser
  saveGeminiAccessToken?: typeof saveGeminiAccessToken
  isBareMode?: typeof isBareMode
}

function createDefaultOAuthService(): Pick<
  GeminiOAuthService,
  'startOAuthFlow' | 'cleanup'
> {
  return new GeminiOAuthService()
}

export function useGeminiOAuthFlow(options: {
  onAuthenticated: (
    tokens: GeminiOAuthTokens,
    persistCredentials: PersistGeminiOAuthCredentials,
  ) => void | Promise<void>
  deps?: GeminiOAuthFlowDependencies
}): GeminiOAuthFlowStatus {
  const { onAuthenticated } = options
  const createOAuthService =
    options.deps?.createOAuthService ?? createDefaultOAuthService
  const openBrowserFn = options.deps?.openBrowser ?? openBrowser
  const saveCredentials =
    options.deps?.saveGeminiAccessToken ?? saveGeminiAccessToken
  const isBareModeFn = options.deps?.isBareMode ?? isBareMode
  const [status, setStatus] = React.useState<GeminiOAuthFlowStatus>({
    state: 'starting',
  })

  React.useEffect(() => {
    if (isBareModeFn()) {
      setStatus({
        state: 'error',
        message:
          'Gemini OAuth is unavailable in --bare because secure storage is disabled.',
      })
      return
    }

    let cancelled = false
    const oauthService = createOAuthService()

    void oauthService
      .startOAuthFlow(async authUrl => {
        if (cancelled) return
        setStatus({
          state: 'waiting',
          authUrl,
          browserOpened: null,
        })
        const browserOpened = await openBrowserFn(authUrl)
        if (cancelled) return
        setStatus({
          state: 'waiting',
          authUrl,
          browserOpened,
        })
      })
      .then(async tokens => {
        if (cancelled) return

        const persistCredentials: PersistGeminiOAuthCredentials = () => {
          const saved = saveCredentials(tokens.accessToken)
          if (!saved.success) {
            throw new Error(
              saved.warning ??
                'Gemini OAuth succeeded, but credentials could not be saved securely.',
            )
          }
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
      oauthService.cleanup()
    }
  }, [
    createOAuthService,
    isBareModeFn,
    onAuthenticated,
    openBrowserFn,
    saveCredentials,
  ])

  return status
}
