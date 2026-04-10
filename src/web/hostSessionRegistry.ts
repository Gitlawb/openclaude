import { randomBytes } from 'node:crypto'

import type { RemoteControlResolvedSession } from './remoteControlTypes.ts'

type RegisterHostSessionInput = {
  cwd: string
  localUrl: string
  publicUrl: string | null
}

export type HostSessionRecord = RemoteControlResolvedSession & {
  kind: 'host'
  token: string
  localUrl: string
  publicUrl: string | null
  createdAt: number
  isAlive: boolean
}

let currentHostSession: HostSessionRecord | null = null

function createToken(): string {
  return randomBytes(18).toString('base64url')
}

export function registerHostSession(
  input: RegisterHostSessionInput,
): HostSessionRecord {
  const createdAt = Date.now()
  clearHostSession()

  currentHostSession = {
    id: `host-${createdAt}`,
    kind: 'host',
    label: 'Live CLI',
    cwd: input.cwd,
    token: createToken(),
    localUrl: input.localUrl,
    publicUrl: input.publicUrl,
    createdAt,
    isAlive: true,
  }

  return { ...currentHostSession }
}

export function resolveHostSessionByToken(
  token: string,
): HostSessionRecord | null {
  if (!currentHostSession?.isAlive) {
    return null
  }

  if (currentHostSession.token !== token) {
    return null
  }

  return { ...currentHostSession }
}

export function getCurrentHostSession(): HostSessionRecord | null {
  return currentHostSession?.isAlive ? { ...currentHostSession } : null
}

export function invalidateHostSession(_reason: string): void {
  currentHostSession = null
}

export function clearHostSession(): void {
  currentHostSession = null
}