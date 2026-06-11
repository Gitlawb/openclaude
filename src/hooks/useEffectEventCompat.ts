import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * React 18-compatible replacement for React 19's useEffectEvent.
 */
export function useEffectEventCompat<Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
): (...args: Args) => Return {
  const fnRef = useRef(fn)

  useLayoutEffect(() => {
    fnRef.current = fn
  }, [fn])

  return useCallback((...args: Args) => fnRef.current(...args), [])
}
