import type { Mock } from 'bun:test'

/**
 * Cast a bun:test mock to `typeof fetch` for injection into code under
 * test. bun's Mock<T> lacks fetch's `preconnect` property, so a direct
 * `as typeof fetch` fails TS2352; tests don't exercise preconnect, making
 * the double cast safe and intentional here, in one audited place.
 */
export function asMockFetch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFn: Mock<(...args: any[]) => any>,
): typeof fetch {
  return mockFn as unknown as typeof fetch
}

/**
 * Read a recorded call's arguments without TS2493 tuple errors: bun types
 * `mock.calls` entries as fixed tuples inferred from the mock's signature,
 * which collapses to `[]` for argless signatures even when the code under
 * test passes arguments.
 */
export function callArgs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFn: Mock<(...args: any[]) => any>,
  callIndex = 0,
): unknown[] {
  return (mockFn.mock.calls as unknown[][])[callIndex] ?? []
}
