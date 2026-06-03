/**
 * `openclaude auth xai ...` command handlers.
 *
 * `login`   — browser OAuth (loopback callback on 127.0.0.1:56121).
 * `device`  — device-code flow for SSH / headless hosts.
 * `logout`  — clears stored xAI OAuth credentials.
 * `status`  — prints whether credentials are stored and whose account.
 */

import {
  pollXaiDeviceCode,
  requestXaiDeviceCode,
  XaiOAuthService,
} from '../../services/api/xaiOAuth.js'
import { openBrowser } from '../../utils/browser.js'
import {
  clearXaiCredentials,
  persistXaiOAuthTokens,
  readXaiCredentialsAsync,
} from '../../utils/xaiCredentials.js'
import { isBareMode } from '../../utils/envUtils.js'
import { clearPersistedXaiOAuthProfile } from '../../utils/providerProfile.js'
import {
  deleteProviderProfile,
  getProviderProfiles,
} from '../../utils/providerProfiles.js'
import { clearStartupProviderOverrides } from '../../utils/providerStartupOverrides.js'

export type XaiLoginFlow = 'browser' | 'device-code'

export async function xaiLogin(options: {
  flow: XaiLoginFlow
}): Promise<void> {
  if (isBareMode()) {
    process.stderr.write(
      'xAI OAuth is unavailable in --bare mode (secure storage is disabled).\n',
    )
    process.exitCode = 1
    return
  }

  if (options.flow === 'browser') {
    await runBrowserFlow()
  } else {
    await runDeviceCodeFlow()
  }
}

async function runBrowserFlow(): Promise<void> {
  const service = new XaiOAuthService()
  let cleanupStdin: (() => void) | null = null
  try {
    process.stderr.write('Starting xAI OAuth (browser sign-in)…\n')
    const handle = await service.beginOAuthFlow()

    process.stderr.write(
      `\nIf the browser does not open, visit:\n${handle.authUrl}\n\n`,
    )
    const opened = await openBrowser(handle.authUrl)
    if (!opened) {
      process.stderr.write(
        'Could not open a browser automatically. Open the URL above manually.\n',
      )
    }

    process.stderr.write(
      'If xAI shows "Could not establish connection" (CORS/firewall), copy\n' +
        'the code shown on that page and paste it here, then press Enter.\n' +
        '(Otherwise just wait — the browser will redirect automatically.)\n\n' +
        'Code> ',
    )

    cleanupStdin = listenForManualCode(code => handle.submitManualCode(code))
    const tokens = await handle.waitForTokens()
    cleanupStdin?.()
    cleanupStdin = null

    const saved = persistXaiOAuthTokens(tokens)
    if (!saved.success) {
      process.stderr.write(
        `xAI login succeeded, but credentials could not be saved: ${saved.warning ?? 'unknown error'}\n`,
      )
      process.exitCode = 1
      return
    }
    process.stderr.write(
      `\nxAI login complete${tokens.email ? ` (${tokens.email})` : ''}.\n`,
    )
  } catch (error) {
    process.stderr.write(
      `\nxAI OAuth failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  } finally {
    cleanupStdin?.()
  }
}

/**
 * Read one line of stdin, trim, hand to `onLine`. Used as a recovery path
 * when xAI's loopback push fails — the user can paste the authorization
 * code from xAI's auth page directly into the terminal.
 */
function listenForManualCode(onLine: (line: string) => void): () => void {
  const stdin = process.stdin
  let buffer = ''
  let active = true
  // Record the paused state BEFORE we touch it. We only need to resume
  // stdin if it was paused, and we must only re-pause it on cleanup if
  // we were the ones who resumed it — otherwise a one-shot CLI process
  // (`openclaude auth xai login`) stays alive after a successful
  // browser flow because the resumed stdin keeps the event loop busy,
  // and the user sees the command "hang" until they hit Ctrl+D.
  const wasPaused =
    typeof stdin.isPaused === 'function' ? stdin.isPaused() : false

  const onData = (chunk: Buffer | string): void => {
    if (!active) return
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const newlineIdx = buffer.indexOf('\n')
    if (newlineIdx === -1) return
    const line = buffer.slice(0, newlineIdx).replace(/\r$/, '').trim()
    buffer = buffer.slice(newlineIdx + 1)
    if (line.length > 0) {
      onLine(line)
    }
  }

  stdin.on('data', onData)
  if (wasPaused && typeof stdin.resume === 'function') {
    stdin.resume()
  }

  return () => {
    if (!active) return
    active = false
    stdin.removeListener('data', onData)
    if (wasPaused && typeof stdin.pause === 'function') {
      stdin.pause()
    }
  }
}

async function runDeviceCodeFlow(): Promise<void> {
  try {
    process.stderr.write('Starting xAI device-code login…\n')
    const { code, tokenEndpoint } = await requestXaiDeviceCode()
    const url = code.verificationUriComplete ?? code.verificationUri
    process.stderr.write(
      `\nOpen this URL in a browser and enter the code below:\n${url}\nCode: ${code.userCode}\n\n`,
    )
    if (!code.verificationUriComplete) {
      process.stderr.write(
        `(If the URL above does not pre-fill the code, paste it manually.)\n\n`,
      )
    } else {
      await openBrowser(url).catch(() => false)
    }
    const tokens = await pollXaiDeviceCode({
      deviceCode: code,
      tokenEndpoint,
    })
    const saved = persistXaiOAuthTokens(tokens)
    if (!saved.success) {
      process.stderr.write(
        `xAI device login succeeded, but credentials could not be saved: ${saved.warning ?? 'unknown error'}\n`,
      )
      process.exitCode = 1
      return
    }
    process.stderr.write(
      `xAI device-code login complete${tokens.email ? ` (${tokens.email})` : ''}.\n`,
    )
  } catch (error) {
    process.stderr.write(
      `xAI device-code login failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}

// The provider-name constant used by the /provider UI when it creates an
// xAI OAuth profile. Kept in sync so the CLI logout can find and remove
// the matching profile without needing UI state.
const XAI_OAUTH_PROVIDER_NAME = 'xAI OAuth'

/**
 * Dependencies for `xaiLogout`. Tests inject real implementations to
 * bypass `mock.module(...)` stubs that other test files install for
 * providerProfile / providerProfiles — Bun's module mocks leak across
 * files in the same process and `mock.restore()` doesn't undo them.
 * Production callers omit this argument and get the static imports.
 */
export type XaiLogoutDeps = {
  clearXaiCredentials?: typeof clearXaiCredentials
  clearPersistedXaiOAuthProfile?: typeof clearPersistedXaiOAuthProfile
  getProviderProfiles?: typeof getProviderProfiles
  deleteProviderProfile?: typeof deleteProviderProfile
  clearStartupProviderOverrides?: typeof clearStartupProviderOverrides
}

export async function xaiLogout(deps?: XaiLogoutDeps): Promise<void> {
  const _clearXaiCredentials = deps?.clearXaiCredentials ?? clearXaiCredentials
  const _clearPersistedXaiOAuthProfile =
    deps?.clearPersistedXaiOAuthProfile ?? clearPersistedXaiOAuthProfile
  const _getProviderProfiles =
    deps?.getProviderProfiles ?? getProviderProfiles
  const _deleteProviderProfile =
    deps?.deleteProviderProfile ?? deleteProviderProfile
  const _clearStartupProviderOverrides =
    deps?.clearStartupProviderOverrides ?? clearStartupProviderOverrides

  // Mirror the /provider UI logout sequence so a user who configured
  // xAI OAuth interactively and then ran `openclaude auth xai logout`
  // ends up in a clean state. Without all four steps, the
  // marker-tagged .openclaude-profile.json survives, startup
  // validation still accepts XAI_CREDENTIAL_SOURCE=oauth, but
  // openaiShim can't resolve a token — the next non-interactive xAI
  // launch hits api.x.ai without credentials instead of being logged
  // out cleanly.
  //
  // 1. Clear stored OAuth tokens from secure storage.
  const cleared = _clearXaiCredentials()
  if (!cleared.success) {
    process.stderr.write(
      `Could not clear xAI credentials: ${cleared.warning ?? 'unknown error'}\n`,
    )
    process.exitCode = 1
    return
  }

  // 2. Remove the xAI OAuth provider profile from global config (if any).
  // The CLI has no React state telling it which profile id corresponds
  // to the OAuth profile, so match on the canonical name + xai provider
  // — the /provider UI always uses this exact name.
  const xaiOAuthProfile = _getProviderProfiles().find(
    profile =>
      profile.provider === 'xai' &&
      profile.name === XAI_OAUTH_PROVIDER_NAME,
  )
  let activeProfileWasCleared = false
  if (xaiOAuthProfile) {
    const result = _deleteProviderProfile(xaiOAuthProfile.id)
    if (!result.removed) {
      process.stderr.write(
        'xAI credentials were cleared, but the xAI OAuth provider profile could not be removed.\n',
      )
      process.exitCode = 1
      return
    }
    activeProfileWasCleared = Boolean(result.activeProfileId)
  }

  // 3. Remove the marker-tagged startup profile file so validation
  // doesn't keep accepting XAI_CREDENTIAL_SOURCE=oauth at next launch.
  _clearPersistedXaiOAuthProfile()

  // 4. Clear the global-settings startup-provider override if the
  // active profile changed — otherwise a stale settings.json override
  // can re-pin the (now-deleted) xAI profile on next launch.
  const settingsOverrideError = activeProfileWasCleared
    ? _clearStartupProviderOverrides()
    : null

  if (settingsOverrideError) {
    process.stderr.write(
      `xAI OAuth logged out. Warning: could not clear startup provider override (${settingsOverrideError}).\n`,
    )
    return
  }
  process.stderr.write('xAI OAuth credentials cleared.\n')
}

export async function xaiStatus(): Promise<void> {
  const blob = await readXaiCredentialsAsync()
  if (!blob) {
    process.stderr.write('xAI: no OAuth credentials stored.\n')
    return
  }
  const identity =
    blob.email ?? blob.displayName ?? blob.accountId ?? 'unknown account'
  const expiresStr =
    blob.expiresAt && Number.isFinite(blob.expiresAt)
      ? new Date(blob.expiresAt).toISOString()
      : 'unknown'
  process.stderr.write(
    `xAI: signed in as ${identity}\n  token expires: ${expiresStr}\n`,
  )
}
