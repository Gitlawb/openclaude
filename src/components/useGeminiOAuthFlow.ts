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
  // Use a ref for the callback so it's always current but doesn't trigger effect re-runs
  const onAuthRef = React.useRef(options.onAuthenticated)
  React.useEffect(() => {
    onAuthRef.current = options.onAuthenticated
  }, [options.onAuthenticated])

  const createOAuthService =
    options.deps?.createOAuthService ?? createDefaultOAuthService
  const openBrowserFn = options.deps?.openBrowser ?? openBrowser
  const saveCredentials =
    options.deps?.saveGeminiAccessToken ?? saveGeminiAccessToken
  const isBareModeFn = options.deps?.isBareMode ?? isBareMode
  const [status, setStatus] = React.useState<GeminiOAuthFlowStatus>({
    state: 'starting',
  })

  // Group dependencies in a ref for the effect
  const depsRef = React.useRef({
    createOAuthService,
    openBrowserFn,
    saveCredentials,
    isBareModeFn,
  })

  React.useEffect(() => {
    if (depsRef.current.isBareModeFn()) {
      setStatus({
        state: 'error',
        message:
          'Gemini OAuth is unavailable in --bare because secure storage is disabled.',
      })
      return
    }

    let cancelled = false
    const oauthService = depsRef.current.createOAuthService()

    void oauthService
      .startOAuthFlow(async authUrl => {
        if (cancelled) return
        setStatus({
          state: 'waiting',
          authUrl,
          browserOpened: null,
        })
        const browserOpened = await depsRef.current.openBrowserFn(authUrl)
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
          const saved = depsRef.current.saveCredentials(tokens.accessToken)
          if (!saved.success) {
            throw new Error(
              saved.warning ??
                'Gemini OAuth succeeded, but credentials could not be saved securely.',
            )
          }
        }

        await onAuthRef.current(tokens, persistCredentials)
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
  }, []) // Mount-only effect

  return status
}
