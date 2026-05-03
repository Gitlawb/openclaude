/**
 * Shared validation utilities for SDK-facing APIs.
 */

/**
 * Padrão para detectar caracteres de controle perigosos
 * Inclui: null byte (\0), carriage return (\r), line feed (\n)
 */
export const CONTROL_CHAR_PATTERN = /[\0\r\n]/

/**
 * Padrão estendido para detectar caracteres de controle perigosos em paths
 * Inclui todos os caracteres de controle ASCII (0x00-0x1F exceto tab)
 */
export const DANGEROUS_PATH_CHARS = /[\0\x08\x0B\x0C\x0E-\x1F]/

/**
 * Verifica se uma string contém caracteres de controle perigosos
 * @param str String a ser verificada
 * @returns true se contém caracteres perigosos
 */
export function hasControlChars(str: string): boolean {
  return CONTROL_CHAR_PATTERN.test(str)
}

/**
 * Verifica se um path contém caracteres perigosos
 * @param path Path a ser verificado
 * @returns true se contém caracteres perigosos
 */
export function hasDangerousPathChars(path: string): boolean {
  return DANGEROUS_PATH_CHARS.test(path)
}

/**
 * Remove caracteres de controle de uma string
 * @param str String a ser sanitizada
 * @returns String sem caracteres de controle
 */
export function removeControlChars(str: string): string {
  return str.replace(CONTROL_CHAR_PATTERN, '')
}

/**
 * Validate an array of items using a per-item validator.
 * Throws TypeError with the index and missing field if validation fails.
 */
export function validateArrayOf<T>(
  items: unknown[],
  validator: (item: unknown, index: number) => T,
  label: string,
): T[] {
  if (!Array.isArray(items)) {
    throw new TypeError(`${label}: expected an array, got ${typeof items}`)
  }
  return items.map((item, i) => {
    try {
      return validator(item, i)
    } catch (err) {
      if (err instanceof TypeError) {
        throw new TypeError(`${label}: item at index ${i} - ${err.message}`)
      }
      throw err
    }
  })
}

/**
 * Assert that a value is a non-empty string.
 */
export function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`missing or empty '${field}' (expected non-empty string)`)
  }
}

/**
 * Assert that a value is a non-null object (but not an array).
 */
export function assertObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`missing or invalid '${field}' (expected object)`)
  }
}

/**
 * Assert that a value is a function.
 */
export function assertFunction(value: unknown, field: string): asserts value is (...args: any[]) => any {
  if (typeof value !== 'function') {
    throw new TypeError(`missing or invalid '${field}' (expected function)`)
  }
}
