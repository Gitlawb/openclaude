import type { Command } from '../commands.js'
import {
  getStatus,
  isLocalRemoteRunning,
  reloadLocalRemote,
  rotateLocalRemoteToken,
  startLocalRemote,
  stopLocalRemote,
  tokenPreview,
} from '../localRemote/index.js'
import type { LocalCommandCall } from '../types/command.js'
import { errorMessage } from '../utils/errors.js'

const USAGE = [
  '/remote           — show status',
  '/remote on        — connect to remote daemon (auto-starts if needed)',
  '/remote off       — disconnect from remote daemon',
  '/remote rotate    — rotate the bearer token',
  '/remote reload    — restart remote daemon process',
  '',
  'The remote daemon holds the HTTP+WS port and routes sessions.',
  'All Neural Network instances connect to it as workers.',
  '',
  'Configure port/host via "localRemote" in ~/.nnc/settings (or ~/.nnc/config).',
  'The server binds to 127.0.0.1 by default. For phone/VPS access, set host to 0.0.0.0',
  'and front the port with Cloudflare Tunnel, SSH tunnel, or a reverse proxy.',
  '',
  'Manual daemon control:',
  '  openclaude remote-daemon          — start daemon in foreground',
  '  openclaude remote-daemon --stop   — stop daemon',
  '  openclaude remote-daemon --status — show daemon status',
].join('\n')

function formatStart(res: {
  url: string
  lanUrl?: string
  token: string
  host: string
  port: number
}): string {
  const lines = [
    'Connected to remote daemon.',
    `  URL:   ${res.url}`,
  ]
  if (res.lanUrl) lines.push(`  LAN:   ${res.lanUrl}`)
  lines.push(`  Token: ${res.token}`)
  lines.push(
    '',
    'Open the URL in a browser, pick a session from the list, and you have a',
    'mirror of this session with two-way messaging and remote tool-permission',
    'approvals. Multiple Neural Network instances share the same daemon.',
    `Rotate the token with "/remote rotate" if it leaks.`,
  )
  return lines.join('\n')
}

function formatStatus(): string {
  const status = getStatus()
  if (!status.running) {
    return 'Remote session: stopped. Run "/remote on" to start.'
  }
  const lines = [
    'Remote session: running.',
    `  URL:    ${status.url}`,
  ]
  if (status.lanUrl) lines.push(`  LAN:    ${status.lanUrl}`)
  lines.push(
    `  Port:   ${status.port}`,
    `  Host:   ${status.host}`,
    `  Token:  ${status.tokenPreview}`,
    `  Daemon: ${status.connectedToDaemon ? 'connected' : 'reconnecting…'}`,
  )
  if (status.sessionCount !== undefined) {
    lines.push(`  Sessions: ${status.sessionCount}`)
  }
  return lines.join('\n')
}

const call: LocalCommandCall = async args => {
  const arg = args.trim().toLowerCase()

  if (arg === '' || arg === 'status') {
    return { type: 'text', value: formatStatus() }
  }

  if (arg === 'on' || arg === 'start') {
    try {
      const res = await startLocalRemote()
      return { type: 'text', value: formatStart(res) }
    } catch (err) {
      return {
        type: 'text',
        value: `Failed to start remote session: ${errorMessage(err)}`,
      }
    }
  }

  if (arg === 'off' || arg === 'stop') {
    if (!isLocalRemoteRunning()) {
      return { type: 'text', value: 'Remote session is not running.' }
    }
    try {
      await stopLocalRemote()
      return { type: 'text', value: 'Disconnected from remote daemon.' }
    } catch (err) {
      return {
        type: 'text',
        value: `Failed to stop remote session: ${errorMessage(err)}`,
      }
    }
  }

  if (arg === 'rotate' || arg === 'rotate-token' || arg === 'token') {
    const wasRunning = isLocalRemoteRunning()
    if (wasRunning) {
      await stopLocalRemote()
    }
    const newToken = rotateLocalRemoteToken()
    const lines = [
      'Bearer token rotated.',
      `  New token: ${newToken}`,
      `  Preview:   ${tokenPreview(newToken)}`,
    ]
    if (wasRunning) {
      const res = await startLocalRemote()
      lines.push('', 'Reconnected to daemon with new token.', `  URL: ${res.url}`)
    }
    return { type: 'text', value: lines.join('\n') }
  }

  if (arg === 'reload' || arg === 'restart') {
    try {
      await reloadLocalRemote()
      return { type: 'text', value: 'Remote daemon перезапущений успішно.' }
    } catch (err) {
      return {
        type: 'text',
        value: `Не вдалося перезапустити remote daemon: ${errorMessage(err)}`,
      }
    }
  }

  if (arg === 'help' || arg === '?' || arg === '--help') {
    return { type: 'text', value: USAGE }
  }

  return {
    type: 'text',
    value: `Unknown argument "${arg}".\n\n${USAGE}`,
  }
}

const remote = {
  type: 'local',
  name: 'remote',
  description: 'Connect to the remote daemon to mirror this session to a browser',
  argumentHint: '[on|off|status|rotate|reload]',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default remote
