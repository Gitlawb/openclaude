/**
 * Snake_case ↔ camelCase key mappers for the SDK boundary layer.
 *
 * Internal runtime (JSONL files, session storage) uses snake_case.
 * Public SDK API exposes camelCase to consumers (JS/TS convention).
 * These utilities handle the conversion at the SDK boundary.
 */

/** Convert a snake_case string to camelCase. Handles consecutive underscores and dunder names. */
export function snakeToCamel(s: string): string {
  // Handle dunder names like __proto__ - strip leading and trailing __ and capitalize first letter
  if (s.startsWith('__') && s.endsWith('__') && s.length > 4) {
    const inner = s.slice(2, -2)
    const converted = inner.replace(/_+([a-z])/g, (_, c: string) => c.toUpperCase())
    // Capitalize first letter for dunder names
    return converted.charAt(0).toUpperCase() + converted.slice(1)
  }
  // Match one or more underscores followed by a lowercase letter,
  // but only if there's content after that letter (not at end of string)
  // This preserves trailing underscores and underscore-letter pairs at the end
  return s.replace(/_+([a-z])(?=.)/g, (_, c: string) => c.toUpperCase())
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
