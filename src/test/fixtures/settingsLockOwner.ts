import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { hostname } from 'node:os'

function hashIdentity(parts: string[]): string {
  return `v1:${createHash('sha256').update(parts.join('\0')).digest('hex')}`
}

function readIdentityFile(path: string): string | undefined {
  try {
    const value = readFileSync(path, 'utf8').trim()
    return value || undefined
  } catch {
    return undefined
  }
}

export function createCurrentSettingsLockOwner(
  pid: number,
  token: string,
): {
  bootId?: string
  hostId: string
  pid: number
  runtimeId: string
  token: string
} {
  const stableHostIdentity =
    process.platform === 'linux'
      ? readIdentityFile('/etc/machine-id') ?? hostname()
      : hostname()
  const hostId = hashIdentity([
    'openclaude-settings-host',
    process.platform,
    stableHostIdentity,
  ])
  let bootId: string | undefined
  let namespaceId = ''
  if (process.platform === 'linux') {
    const linuxBootId = readIdentityFile('/proc/sys/kernel/random/boot_id')
    if (linuxBootId) {
      bootId = hashIdentity(['openclaude-settings-boot', linuxBootId])
    }
    try {
      const namespace = statSync('/proc/self/ns/pid')
      namespaceId = `${namespace.dev}:${namespace.ino}`
    } catch {
      // Match the production fallback when procfs is unavailable.
    }
  }

  return {
    pid,
    hostId,
    ...(bootId ? { bootId } : {}),
    runtimeId: hashIdentity([
      'openclaude-settings-runtime',
      process.platform,
      hostId,
      bootId ?? '',
      namespaceId,
    ]),
    token,
  }
}
