export function intersperse<A>(as: A[], separator: (index: number) => A): A[] {
  return as.flatMap((a, i) => (i ? [separator(i), a] : [a]))
}

export function count<T>(arr: readonly T[], pred: (x: T) => unknown): number {
  let n = 0
  for (const x of arr) n += +!!pred(x)
  return n
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)]
}

/**
 * Split an array into chunks of the given size.
 * The last chunk may be smaller if the array length is not divisible by size.
 * @throws {RangeError} if size <= 0
 */
export function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError('chunk size must be a positive integer')
  }
  if (arr.length === 0) return []
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

/**
 * Partition an array into two groups: those matching the predicate and those not.
 * Returns [matching, nonMatching] to allow destructuring.
 */
export function partition<T>(
  arr: readonly T[],
  predicate: (value: T, index: number, array: readonly T[]) => unknown,
): [T[], T[]] {
  const pass: T[] = []
  const fail: T[] = []
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]!
    if (predicate(item, i, arr)) {
      pass.push(item)
    } else {
      fail.push(item)
    }
  }
  return [pass, fail]
}
