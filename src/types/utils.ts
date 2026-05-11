/**
 * Stub — utility type definitions not included in source snapshot. See
 * src/types/message.ts for the same scoping caveat (issue #473).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type DeepImmutable<T> = T extends any[]
  ? readonly DeepImmutable<T[number]>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
    : T

export type Permutations<T extends string, U extends string = T> = T extends T
  ? T | `${T}${Permutations<Exclude<U, T>>}`
  : never
