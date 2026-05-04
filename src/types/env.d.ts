/**
 * Augment NodeJS.ProcessEnv to declare build-time variables.
 * Without these declarations, TypeScript infers literal types from
 * the build-time substitution values (e.g. "external"), causing
 * TS2367 "unintentional comparison" errors on gating checks like
 * `("external" as string) === 'ant'` which are meant for dead-code elimination.
 */

declare namespace NodeJS {
  interface ProcessEnv {
    USER_TYPE?: string
  }
}

// PromiseWithResolvers was added in ES2023 but our target may not include it
interface PromiseWithResolvers<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: any) => void
}

// Test globals (bun test)
declare const describe: (name: string, fn: () => void) => void
declare const test: (name: string, fn: () => void | Promise<void>) => void
declare const it: (name: string, fn: () => void | Promise<void>) => void
declare const expect: any
declare const beforeEach: (fn: () => void | Promise<void>) => void
declare const afterEach: (fn: () => void | Promise<void>) => void
declare const beforeAll: (fn: () => void | Promise<void>) => void
declare const afterAll: (fn: () => void | Promise<void>) => void

// Internal-only names hoisted by React Compiler output or gated behind
// build-time dead-code elimination (`"external" === 'ant'`). These are never
// reached at runtime in the open-source build, but TypeScript needs them
// resolved to type-check the dead branches.
declare const GateOverridesWarning: any
declare const ExperimentEnrollmentNotice: any
declare const TungstenPill: any
declare const Gates: any
declare const UltraplanChoiceDialog: any
declare const UltraplanLaunchDialog: any
declare const launchUltraplan: any
declare const apiMetricsRef: any
declare const computeTtftText: any
declare const assistantMessage: any
declare const model: any
declare const getSdkBetas: any
declare const getContextWindowForModel: any
declare const COMPACT_MAX_OUTPUT_TOKENS: any
declare const resolveAntModel: any
declare const getAntModelOverrideConfig: any
declare const HOOK_TIMING_DISPLAY_THRESHOLD_MS: any
declare function logForDebugging(...args: any[]): void
