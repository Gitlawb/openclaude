/**
 * Module-level singleton that holds the current REPL's bindings for the
 * local-remote server to call into: submitting a prompt and settling a
 * pending permission request.
 *
 * REPL.tsx mounts the submitter when it boots, unmounts on teardown.
 * PermissionRequest.tsx mounts a permission resolver when a dialog is
 * pending.
 */

import type { PermissionBehavior } from './types.js'

export type PromptSubmitter = (text: string) => void

export type PermissionSettler = (
  requestId: string,
  behavior: PermissionBehavior,
  message?: string,
) => boolean

let promptSubmitter: PromptSubmitter | null = null

// Multiple permission dialogs may be active at once (rare but possible).
// Each registers its own settler keyed by requestId.
const permissionSettlers = new Map<string, PermissionSettler>()

export function setPromptSubmitter(fn: PromptSubmitter | null): void {
  promptSubmitter = fn
}

export function getPromptSubmitter(): PromptSubmitter | null {
  return promptSubmitter
}

export function registerPermissionSettler(
  requestId: string,
  settler: PermissionSettler,
): () => void {
  permissionSettlers.set(requestId, settler)
  return () => {
    permissionSettlers.delete(requestId)
  }
}

/**
 * Called by the WebSocket handler when a client returns a permission decision.
 * Returns true if a settler was found and invoked.
 */
export function settlePermission(
  requestId: string,
  behavior: PermissionBehavior,
  message?: string,
): boolean {
  const settler = permissionSettlers.get(requestId)
  if (!settler) return false
  const ok = settler(requestId, behavior, message)
  if (ok) permissionSettlers.delete(requestId)
  return ok
}

export function hasPendingSettler(requestId: string): boolean {
  return permissionSettlers.has(requestId)
}
