export function withMockMacro<T>(
  macro: Record<string, unknown>,
  run: () => T,
): T {
  const originalMacro = (globalThis as Record<string, unknown>).MACRO
  ;(globalThis as Record<string, unknown>).MACRO = macro

  const restore = () => {
    if (originalMacro === undefined) {
      delete (globalThis as Record<string, unknown>).MACRO
    } else {
      ;(globalThis as Record<string, unknown>).MACRO = originalMacro
    }
  }

  try {
    const result = run()
    if (
      result !== null &&
      typeof result === 'object' &&
      'finally' in result &&
      typeof result.finally === 'function'
    ) {
      return result.finally(restore) as T
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}
