/**
 * Snake_case ↔ camelCase key mappers for the SDK boundary layer.
 *
 * Internal runtime (JSONL files, session storage) uses snake_case.
 * Public SDK API exposes camelCase to consumers (JS/TS convention).
 * These utilities handle the conversion at the SDK boundary.
 */

/** Convert a snake_case string to camelCase. */
export function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** Convert a camelCase string to snake_case. */
export function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
}

/** Recursively transform all keys in an object from snake_case to camelCase. */
export function mapKeysToCamel<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(mapKeysToCamel) as T
  if (typeof obj !== 'object') return obj

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[snakeToCamel(key)] = mapKeysToCamel(value)
  }
  return result as T
}

/** Recursively transform all keys in an object from camelCase to snake_case. */
export function mapKeysToSnake<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(mapKeysToSnake) as T
  if (typeof obj !== 'object') return obj

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[camelToSnake(key)] = mapKeysToSnake(value)
  }
  return result as T
}
