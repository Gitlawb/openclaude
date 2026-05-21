import * as React from 'react'

import {
  XaiOAuthService,
  type XaiOAuthFlowHandle,
  type XaiOAuthTokens,
} from '../services/api/xaiOAuth.js'
import { openBrowser } from '../utils/browser.js'
import { isBareMode } from '../utils/envUtils.js'
import { persistXaiOAuthTokens } from '../utils/xaiCredentials.js'

export type XaiOAuthFlowStatus =
  | { state: 'starting' }
  | {
      state: 'waiting'
      authUrl: string
      browserOpened: boolean | null
      submitManualCode: (code: string) => void
    }
  | {
      state: 'error'
      message: string
    }

type XaiPersistFn = () => void

type XaiOAuthServiceLike = Pick<
  XaiOAuthService,
  'beginOAuthFlow' | 'cleanup'
>

type XaiOAuthFlowDependencies = {
  createOAuthService?: () => XaiOAuthServiceLike
  openBrowser?: typeof openBrowser
  persistXaiOAuthTokens?: typeof persistXaiOAuthTokens
  isBareMode?: typeof isBareMode
}

function createDefaultOAuthService(): XaiOAuthServiceLike {
  return new XaiOAuthService()
}

export function useXaiOAuthFlow(options: {
  onAuthenticated: (
    tokens: XaiOAuthTokens,
    persistCredentials: XaiPersistFn,
  ) => void | Promise<void>
  deps?: XaiOAuthFlowDependencies
}): XaiOAuthFlowStatus {
  const { onAuthenticated } = options
  const createOAuthService =
    options.deps?.createOAuthService ?? createDefaultOAuthService
  const openBrowserFn = options.deps?.openBrowser ?? openBrowser
  const persistFn =
    options.deps?.persistXaiOAuthTokens ?? persistXaiOAuthTokens
  const isBareModeFn = options.deps?.isBareMode ?? isBareMode
  const [status, setStatus] = React.useState<XaiOAuthFlowStatus>({
    state: 'starting',
  })

  React.useEffect(() => {
    if (isBareModeFn()) {
      setStatus({
        state: 'error',
        message:
          'xAI OAuth is unavailable in --bare because secure storage is disabled.',
      })
      return
    }

    let cancelled = false
    const oauthService = createOAuthService()

    void (async () => {
      let handle: XaiOAuthFlowHandle | null = null
      try {
        handle = await oauthService.beginOAuthFlow()
        if (cancelled) return

        setStatus({
          state: 'waiting',
          authUrl: handle.authUrl,
          browserOpened: null,
          submitManualCode: handle.submitManualCode,
        })
        const browserOpened = await openBrowserFn(handle.authUrl)
        if (cancelled) return
        setStatus({
          state: 'waiting',
          authUrl: handle.authUrl,
          browserOpened,
          submitManualCode: handle.submitManualCode,
        })

        const tokens = await handle.waitForTokens()
        if (cancelled) return

        const persistCredentials: XaiPersistFn = () => {
          const saved = persistFn(tokens)
          if (!saved.success) {
            throw new Error(
              saved.warning ??
                'xAI OAuth succeeded, but credentials could not be saved securely.',
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
      oauthService.cleanup()
    }
  }, [
    createOAuthService,
    isBareModeFn,
    onAuthenticated,
    openBrowserFn,
    persistFn,
  ])

  return status
}
