/**
 * Shared utilities for expanding environment variables in MCP server configurations
 */

/**
 * Expand environment variables in a string value
 * Handles ${VAR} and ${VAR:-default} syntax
 * @returns Object with expanded string and list of missing variables
 */
export function expandEnvVarsInString(value: string): {
  expanded: string
  missingVars: string[]
} {
  const missingVars: string[] = []

  const expanded = value.replace(/\$\{([^}]+)\}/g, (match, varContent) => {
    // Split on the FIRST ':-' to support ${VAR:-default} default values. Note
    // String.split(sep, limit) caps the array length and discards the
    // remainder — it does not glue the tail back on like a maxsplit — so
    // `split(':-', 2)` would truncate a default that itself contains ':-'
    // (e.g. ${VAR:-a:-b} -> "a" instead of "a:-b"). Slice at the first ':-'
    // instead so any later ':-' stays in the default, matching bash.
    const sepIndex = varContent.indexOf(':-')
    const varName =
      sepIndex === -1 ? varContent : varContent.slice(0, sepIndex)
    const defaultValue =
      sepIndex === -1 ? undefined : varContent.slice(sepIndex + 2)
    const envValue = process.env[varName]

    if (envValue !== undefined) {
      return envValue
    }
    if (defaultValue !== undefined) {
      return defaultValue
    }

    // Track missing variable for error reporting
    missingVars.push(varName)
    // Return original if not found (allows debugging but will be reported as error)
    return match
  })

  return {
    expanded,
    missingVars,
  }
}
