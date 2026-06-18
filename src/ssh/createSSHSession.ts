/**
 * `claude ssh <host> [dir]` session bootstrap (SSH_REMOTE-gated).
 *
 * Probes the remote host, deploys the CLI binary when needed, spawns ssh
 * with a unix-socket -R forward to a local auth proxy, and hands the REPL
 * an SSHSession whose tools run remotely while the UI renders locally.
 *
 * This open-source build does not ship the SSH remote implementation; the
 * factories below fail honestly with SSHSessionError. The feature flag
 * (SSH_REMOTE) is disabled, so these paths are unreachable in practice.
 */

import type { ChildProcess } from 'child_process'
import type {
  SSHSessionManager,
  SSHSessionManagerCallbacks,
} from './SSHSessionManager.js'

/** Error thrown when an SSH session cannot be established. */
export class SSHSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SSHSessionError'
  }
}

/**
 * A live SSH-backed session handed to the REPL.
 */
export type SSHSession = {
  /** The ssh (or local test) child process running the remote CLI. */
  proc: ChildProcess
  /** Local auth proxy reachable from the remote via the -R unix socket. */
  proxy: { stop(): void }
  /** Working directory resolved on the remote host. */
  remoteCwd: string
  /** Tail of the ssh process's stderr, for error reporting. */
  getStderrTail(): string
  /** Create the protocol manager that drives this session. */
  createManager(callbacks: SSHSessionManagerCallbacks): SSHSessionManager
}

export type CreateSSHSessionOptions = {
  host: string
  cwd: string | undefined
  /** Local CLI version, used to decide whether to (re)deploy the binary. */
  localVersion: string
  permissionMode: string | undefined
  dangerouslySkipPermissions: boolean
  /** Extra CLI args forwarded to the remote CLI on initial spawn. */
  extraCliArgs: string[]
}

export type CreateSSHSessionHooks = {
  /** Progress messages during probe/deploy/connect. */
  onProgress?: (message: string) => void
}

export type CreateLocalSSHSessionOptions = {
  cwd: string | undefined
  permissionMode: string | undefined
  dangerouslySkipPermissions: boolean
}

const UNAVAILABLE_MESSAGE =
  'SSH remote sessions are not available in this build.'

/**
 * Probe the remote, deploy the binary if needed, and spawn the ssh-backed
 * session. Not available in this build.
 */
export async function createSSHSession(
  _options: CreateSSHSessionOptions,
  _hooks: CreateSSHSessionHooks = {},
): Promise<SSHSession> {
  throw new SSHSessionError(UNAVAILABLE_MESSAGE)
}

/**
 * `--local` test mode: spawn the current binary directly with the same
 * env/proxy plumbing, skipping probe/deploy/ssh. Not available in this build.
 */
export function createLocalSSHSession(
  _options: CreateLocalSSHSessionOptions,
): SSHSession {
  throw new SSHSessionError(UNAVAILABLE_MESSAGE)
}
