/**
 * Stub — proactive module not included in source snapshot.
 * See src/types/message.ts for the same scoping caveat (issue #473).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export function isProactiveActive(): boolean { return false }
export function isProactivePaused(): boolean { return false }
export function activateProactive(_source?: string): void {}
export function deactivateProactive(): void {}
export const proactiveModule = null
