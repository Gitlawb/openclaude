/**
 * Tiny typed event bus used to decouple the Neural Network session (REPL,
 * PermissionRequest component, etc.) from the local-remote server.
 *
 * The session emits; the bridge subscribes. No React, no global singletons
 * outside this module.
 */

import type { Message } from '../types/message.js'
import type { RemotePermissionRequest } from './types.js'

type EventMap = {
  messagesChanged: (messages: Message[]) => void
  loadingChanged: (isLoading: boolean, spinnerVerb?: string) => void
  permissionPending: (request: RemotePermissionRequest) => void
  permissionResolved: (requestId: string) => void
}

type Listeners = {
  [K in keyof EventMap]: Set<EventMap[K]>
}

const listeners: Listeners = {
  messagesChanged: new Set(),
  loadingChanged: new Set(),
  permissionPending: new Set(),
  permissionResolved: new Set(),
}

export function on<K extends keyof EventMap>(
  event: K,
  fn: EventMap[K],
): () => void {
  listeners[event].add(fn)
  return () => {
    listeners[event].delete(fn)
  }
}

export function emit<K extends keyof EventMap>(
  event: K,
  ...args: Parameters<EventMap[K]>
): void {
  // Copy before iterating so unsubscribes during emit don't skip listeners.
  const snapshot = Array.from(listeners[event]) as EventMap[K][]
  for (const fn of snapshot) {
    try {
      // @ts-expect-error — TS can't narrow the generic call site.
      fn(...args)
    } catch {
      // Event bus must not throw into the session.
    }
  }
}
