// Bun aliases imports of 'vitest' to its built-in 'bun:test' compatibility
// layer at runtime (vi, describe, test, expect all resolve). Mirror that
// aliasing for the typechecker so vitest-style test files typecheck without
// vitest being installed.
declare module 'vitest' {
  export * from 'bun:test'
}
