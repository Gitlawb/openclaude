import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Load environment variables from a .env file into process.env.
 * 
 * Features:
 * - Ignores comments (lines starting with #)
 * - Handles quoted values (single and double quotes)
 * - Does NOT override existing environment variables (shell takes precedence)
 * - Supports inline comments after values
 * 
 * @param cwd - Working directory to look for .env file (defaults to process.cwd())
 */
export function loadDotEnvFile(cwd?: string): void {
  const envPath = resolve(cwd ?? process.cwd(), '.env')
  if (!existsSync(envPath)) return

  let content: string
  try {
    content = readFileSync(envPath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Warning: Failed to read .env file at ${envPath}: ${message}`)
    return
  }
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    if (!key) continue

    let value = trimmed.slice(eqIndex + 1)
    
    // Handle quoted values
    const trimmedValue = value.trim()
    if (trimmedValue.startsWith('"')) {
      // Double-quoted: find unescaped closing quote
      let endQuote = -1
      for (let i = 1; i < trimmedValue.length; i++) {
        if (trimmedValue[i] === '"' && trimmedValue[i - 1] !== '\\') {
          endQuote = i
          break
        }
      }
      if (endQuote !== -1) {
        value = trimmedValue.slice(1, endQuote)
        // Handle escape sequences in double-quoted strings
        // IMPORTANT: Process \\ FIRST using a placeholder to preserve literal backslashes
        // This ensures "C:\\new\\path" stays as "C:\new\path" not "C:\n..."
        const BACKSLASH_PLACEHOLDER = '\x00BACKSLASH\x00'
        value = value
          .replace(/\\\\/g, BACKSLASH_PLACEHOLDER)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(new RegExp(BACKSLASH_PLACEHOLDER, 'g'), '\\')
      } else {
        value = trimmedValue.slice(1)
      }
    } else if (trimmedValue.startsWith("'")) {
      // Single-quoted: find closing quote (no escape processing)
      const endQuote = trimmedValue.indexOf("'", 1)
      if (endQuote !== -1) {
        value = trimmedValue.slice(1, endQuote)
      } else {
        value = trimmedValue.slice(1)
      }
    } else {
      // Unquoted: trim and remove inline comments
      value = trimmedValue
      const commentIndex = value.indexOf(' #')
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex)
      }
      value = value.trim()
    }

    // Do NOT override existing environment variables
    // Shell environment takes precedence over .env file
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

/**
 * Check if a .env file exists in the given directory.
 * 
 * @param cwd - Working directory to check (defaults to process.cwd())
 * @returns true if .env file exists
 */
export function hasDotEnvFile(cwd?: string): boolean {
  const envPath = resolve(cwd ?? process.cwd(), '.env')
  return existsSync(envPath)
}
