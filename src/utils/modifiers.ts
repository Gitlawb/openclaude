export type ModifierKey = 'shift' | 'command' | 'control' | 'option'

/**
 * Pre-warm the native module by loading it in advance.
 *
 * NOTE: The `modifiers-napi` package is an internal-only native addon
 * that is not shipped with the open-source build. All calls are no-ops here
 * to avoid supply-chain risk from unverified npm packages with the same name.
 */
export function prewarmModifiers(): void {
  // No-op in open-source build — native modifier detection is not available.
}

/**
 * Check if a specific modifier key is currently pressed (synchronous).
 *
 * Always returns false in the open-source build since the native addon
 * is not available.
 */
export function isModifierPressed(_modifier: ModifierKey): boolean {
  return false
}
