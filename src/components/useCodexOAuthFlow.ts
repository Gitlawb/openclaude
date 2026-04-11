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

export function useCodexOAuthFlow(options: {
  onAuthenticated: (tokens: CodexOAuthTokens) => void | Promise<void>
}): CodexOAuthFlowStatus {
  const { onAuthenticated } = options
  const [status, setStatus] = React.useState<CodexOAuthFlowStatus>({
    state: 'starting',
  })

  React.useEffect(() => {
    if (isBareMode()) {
      setStatus({
        state: 'error',
        message:
          'Codex OAuth is unavailable in --bare because secure storage is disabled.',
      })
      return
    }

    let cancelled = false
    const oauthService = new CodexOAuthService()

    void oauthService
      .startOAuthFlow(async authUrl => {
        if (cancelled) return
        setStatus({
          state: 'waiting',
          authUrl,
          browserOpened: null,
        })
        const browserOpened = await openBrowser(authUrl)
        if (cancelled) return
        setStatus({
          state: 'waiting',
          authUrl,
          browserOpened,
        })
      })
      .then(async tokens => {
        if (cancelled) return

        const saved = saveCodexCredentials({
          apiKey: tokens.apiKey,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          idToken: tokens.idToken,
          accountId: tokens.accountId,
        })
        if (!saved.success) {
          throw new Error(
            saved.warning ??
              'Codex OAuth succeeded, but credentials could not be saved securely.',
          )
        }

        await onAuthenticated(tokens)
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
  }, [onAuthenticated])

  return status
}
