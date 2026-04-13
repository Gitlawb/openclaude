import * as React from 'react'

import {
  CodexOAuthService,
  type CodexOAuthTokens,
} from '../services/api/codexOAuth.js'
import { openBrowser } from '../utils/browser.js'
import { saveCodexCredentials } from '../utils/codexCredentials.js'
import { isBareMode } from '../utils/envUtils.js'

export type CodexOAuthFlowStatus =
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

type PersistCodexOAuthCredentials = (options?: {
  profileId?: string
}) => void

type CodexOAuthFlowDependencies = {
  createOAuthService?: () => Pick<
    CodexOAuthService,
    'startOAuthFlow' | 'cleanup'
  >
  openBrowser?: typeof openBrowser
  saveCodexCredentials?: typeof saveCodexCredentials
  isBareMode?: typeof isBareMode
}

function createDefaultOAuthService(): Pick<
  CodexOAuthService,
  'startOAuthFlow' | 'cleanup'
> {
  return new CodexOAuthService()
}

export function useCodexOAuthFlow(options: {
  onAuthenticated: (
    tokens: CodexOAuthTokens,
    persistCredentials: PersistCodexOAuthCredentials,
  ) => void | Promise<void>
  deps?: CodexOAuthFlowDependencies
}): CodexOAuthFlowStatus {
  const { onAuthenticated } = options
  const createOAuthService =
    options.deps?.createOAuthService ?? createDefaultOAuthService
  const openBrowserFn = options.deps?.openBrowser ?? openBrowser
  const saveCredentials =
    options.deps?.saveCodexCredentials ?? saveCodexCredentials
  const isBareModeFn = options.deps?.isBareMode ?? isBareMode
  const [status, setStatus] = React.useState<CodexOAuthFlowStatus>({
    state: 'starting',
  })

  React.useEffect(() => {
    if (isBareModeFn()) {
      setStatus({
        state: 'error',
        message:
          'Codex OAuth is unavailable in --bare because secure storage is disabled.',
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

        const persistCredentials: PersistCodexOAuthCredentials = options => {
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
                'Codex OAuth succeeded, but credentials could not be saved securely.',
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
