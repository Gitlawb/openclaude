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
  // resume() in case some other code paused stdin; idempotent.
  if (typeof stdin.resume === 'function') stdin.resume()

  return () => {
    if (!active) return
    active = false
    stdin.removeListener('data', onData)
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

export async function xaiLogout(): Promise<void> {
  const result = clearXaiCredentials()
  if (!result.success) {
    process.stderr.write(
      `Could not clear xAI credentials: ${result.warning ?? 'unknown error'}\n`,
    )
    process.exitCode = 1
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
