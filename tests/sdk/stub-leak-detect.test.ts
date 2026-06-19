import { describe, expect, test } from 'bun:test'
import {
  checkCriticalImportsForStubs,
  safelyAccess,
  type CriticalImport,
} from '../../src/entrypoints/sdk/stubLeakDetection.ts'

// Pin issue #1287: stub-leak detection must not throw a ReferenceError when one
// of the bindings under inspection is still in the temporal dead zone (e.g.
// mid-circular-import). TDZ is a different bug class than a stub leak — an
// uninitialized binding can't carry `__stub: true`, so the detector treats the
// access failure as "skip" rather than crashing the whole SDK entry.
//
// These tests drive the real detection primitives directly (the SDK barrel only
// runs them as an import side effect via queueMicrotask), so a regression that
// removes the loop, drops the throw, or swallows the `__stub` case is caught.

describe('SDK stub-leak detection (issue #1287)', () => {
  test('throws the SDK init error when a critical import resolves to a real __stub: true binding', () => {
    const criticalImports: CriticalImport[] = [
      { name: 'QueryEngine', get: () => ({ __stub: true }) },
    ]
    expect(() => checkCriticalImportsForStubs(criticalImports)).toThrow(
      /SDK init error: "QueryEngine" resolved to a build stub/,
    )
  })

  test('does not throw when every critical import resolves to a real (non-stub) module', () => {
    const criticalImports: CriticalImport[] = [
      { name: 'QueryEngine', get: () => ({ run: () => undefined }) },
      { name: 'getTools', get: () => ({ default: () => [] }) },
      { name: 'init', get: () => ({}) },
    ]
    expect(() => checkCriticalImportsForStubs(criticalImports)).not.toThrow()
  })

  test('tolerates a TDZ ReferenceError from an uninitialized binding (anti-#1287)', () => {
    // A binding still in the temporal dead zone throws on access; safelyAccess
    // swallows it so the detector skips that import instead of crashing.
    const criticalImports: CriticalImport[] = [
      {
        name: 'QueryEngine',
        get: () =>
          safelyAccess(() => {
            throw new ReferenceError(
              "Cannot access 'QueryEngine' before initialization.",
            )
          }),
      },
    ]
    expect(() => checkCriticalImportsForStubs(criticalImports)).not.toThrow()
  })

  test('a stub on a later import is still caught after a skipped TDZ access', () => {
    // The TDZ skip must not short-circuit the loop: a real stub behind a
    // not-yet-initialized binding is still detected.
    const criticalImports: CriticalImport[] = [
      {
        name: 'QueryEngine',
        get: () =>
          safelyAccess(() => {
            throw new ReferenceError('tdz')
          }),
      },
      { name: 'getTools', get: () => ({ __stub: true }) },
    ]
    expect(() => checkCriticalImportsForStubs(criticalImports)).toThrow(
      /"getTools" resolved to a build stub/,
    )
  })

  test('safelyAccess returns the value on success and undefined on throw', () => {
    expect(safelyAccess(() => 42)).toBe(42)
    expect(
      safelyAccess(() => {
        throw new Error('boom')
      }),
    ).toBeUndefined()
  })

  test('importing the SDK barrel never throws synchronously on its own load', async () => {
    // queueMicrotask defers the real detector to the next tick so circular-dep
    // module init completes first; the bare import must always succeed.
    const sdk = await import('../../src/entrypoints/sdk/index.ts')
    expect(sdk).toBeDefined()
    // Yield so any queued microtask runs, then re-confirm nothing threw.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(sdk).toBeDefined()
  })
})
