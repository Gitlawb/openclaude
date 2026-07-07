export function withMockMacro<T>(
  macro: Record<string, unknown>,
  run: () => T,
): T {
  const originalMacro = (globalThis as Record<string, unknown>).MACRO
  ;(globalThis as Record<string, unknown>).MACRO = macro

  try {
    return run()
  } finally {
    if (originalMacro === undefined) {
      delete (globalThis as Record<string, unknown>).MACRO
    } else {
      ;(globalThis as Record<string, unknown>).MACRO = originalMacro
    }
  }
}

