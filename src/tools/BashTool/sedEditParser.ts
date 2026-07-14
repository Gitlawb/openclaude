/**
 * Parser for sed edit commands (-i flag substitutions)
 * Extracts file paths and substitution patterns to enable file-edit-style rendering
 */

import { randomBytes } from 'crypto'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'

// BRE→ERE conversion placeholders (null-byte sentinels, never appear in user input)

export type SedEditInfo = {
  /** The file path being edited */
  filePath: string
  /** The search pattern (regex) */
  pattern: string
  /** The replacement string */
  replacement: string
  /** Substitution flags (g, i, etc.) */
  flags: string
  /** Whether to use extended regex (-E or -r flag) */
  extendedRegex: boolean
}

// BRE metacharacters that are special only when escaped: `\+ \? \| \( \)` are
// the operator forms and the bare characters are literal — the reverse of JS.
// Braces are handled separately because they only form an operator (the
// interval quantifier) when they enclose a valid count.
const BRE_ESCAPE_FLIP_METACHARS = '+?|()'

/**
 * Translate the body of a BRE interval `\{...\}` to its JS quantifier form,
 * or null when the body is not a legal interval. GNU sed accepts `n`, `n,`,
 * `n,m`, and the extension `,m`; anything else (empty, extra commas,
 * non-numeric) is a literal brace run in sed, so we must not turn it into a
 * quantifier. `,m` has no JS spelling, so it is normalized to `{0,m}`.
 */
function breIntervalBodyToJs(body: string): string | null {
  if (/^[0-9]+(,[0-9]*)?$/.test(body)) {
    return `{${body}}`
  }
  if (/^,[0-9]+$/.test(body)) {
    return `{0${body}}`
  }
  return null
}

function convertBrePatternToJs(pattern: string): string {
  let result = ''

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!

    if (char === '\\') {
      const next = pattern[i + 1]
      if (next === undefined) {
        result += '\\\\'
        continue
      }
      if (next === '{') {
        // `\{...\}` is the BRE interval quantifier, but only when the body is a
        // legal count. Otherwise sed treats the braces as literals, so keep them
        // escaped instead of emitting a bogus JS quantifier.
        const close = pattern.indexOf('\\}', i + 2)
        if (close !== -1) {
          const js = breIntervalBodyToJs(pattern.slice(i + 2, close))
          if (js !== null) {
            result += js
            i = close + 1 // consume through the closing `\}`
            continue
          }
        }
        result += '\\{'
        i++
        continue
      }
      if (next === '}') {
        // A stray escaped closing brace with no matching interval open: literal.
        result += '\\}'
        i++
        continue
      }
      if (next === '\\') {
        result += '\\\\'
      } else if (BRE_ESCAPE_FLIP_METACHARS.includes(next)) {
        result += next
      } else {
        result += `\\${next}`
      }
      i++
      continue
    }

    if (BRE_ESCAPE_FLIP_METACHARS.includes(char)) {
      result += `\\${char}`
      continue
    }

    // Bare braces are literal in BRE (the reverse of JS), so escape them.
    if (char === '{' || char === '}') {
      result += `\\${char}`
      continue
    }

    result += char
  }

  return result
}

/**
 * Check if a command is a sed in-place edit command
 * Returns true only for simple sed -i 's/pattern/replacement/flags' file commands
 */
export function isSedInPlaceEdit(command: string): boolean {
  const info = parseSedEditCommand(command)
  return info !== null
}

/**
 * Parse a sed edit command and extract the edit information
 * Returns null if the command is not a valid sed in-place edit
 */
export function parseSedEditCommand(command: string): SedEditInfo | null {
  const trimmed = command.trim()

  // Must start with sed
  const sedMatch = trimmed.match(/^\s*sed\s+/)
  if (!sedMatch) return null

  const withoutSed = trimmed.slice(sedMatch[0].length)
  const parseResult = tryParseShellCommand(withoutSed)
  if (!parseResult.success) return null
  const tokens = parseResult.tokens

  // Extract string tokens only
  const args: string[] = []
  for (const token of tokens) {
    if (typeof token === 'string') {
      args.push(token)
    } else if (
      typeof token === 'object' &&
      token !== null &&
      'op' in token &&
      token.op === 'glob'
    ) {
      // Glob patterns are too complex for this simple parser
      return null
    }
  }

  // Parse flags and arguments
  let hasInPlaceFlag = false
  let extendedRegex = false
  let expression: string | null = null
  let filePath: string | null = null

  let i = 0
  while (i < args.length) {
    const arg = args[i]!

    // Handle -i flag (with or without backup suffix)
    if (arg === '-i' || arg === '--in-place') {
      hasInPlaceFlag = true
      i++
      // On macOS, -i requires a suffix argument (even if empty string)
      // Check if next arg looks like a backup suffix (empty, or starts with dot)
      // Don't consume flags (-E, -r) or sed expressions (starting with s, y, d)
      if (i < args.length) {
        const nextArg = args[i]
        // If next arg is empty string or starts with dot, it's a backup suffix
        if (
          typeof nextArg === 'string' &&
          !nextArg.startsWith('-') &&
          (nextArg === '' || nextArg.startsWith('.'))
        ) {
          i++ // Skip the backup suffix
        }
      }
      continue
    }
    if (arg.startsWith('-i')) {
      // -i.bak or similar (inline suffix)
      hasInPlaceFlag = true
      i++
      continue
    }

    // Handle extended regex flags
    if (arg === '-E' || arg === '-r' || arg === '--regexp-extended') {
      extendedRegex = true
      i++
      continue
    }

    // Handle -e flag with expression
    if (arg === '-e' || arg === '--expression') {
      if (i + 1 < args.length && typeof args[i + 1] === 'string') {
        // Only support single expression
        if (expression !== null) return null
        expression = args[i + 1]!
        i += 2
        continue
      }
      return null
    }
    if (arg.startsWith('--expression=')) {
      if (expression !== null) return null
      expression = arg.slice('--expression='.length)
      i++
      continue
    }

    // Skip other flags we don't understand
    if (arg.startsWith('-')) {
      // Unknown flag - not safe to parse
      return null
    }

    // Non-flag argument
    if (expression === null) {
      // First non-flag arg is the expression
      expression = arg
    } else if (filePath === null) {
      // Second non-flag arg is the file path
      filePath = arg
    } else {
      // More than one file - not supported for simple rendering
      return null
    }

    i++
  }

  // Must have -i flag, expression, and file path
  if (!hasInPlaceFlag || !expression || !filePath) {
    return null
  }

  // Parse the substitution expression: s/pattern/replacement/flags
  // Only support / as delimiter for simplicity
  const substMatch = expression.match(/^s\//)
  if (!substMatch) {
    return null
  }

  const rest = expression.slice(2) // Skip 's/'

  // Find pattern and replacement by tracking escaped characters
  let pattern = ''
  let replacement = ''
  let flags = ''
  let state: 'pattern' | 'replacement' | 'flags' = 'pattern'
  let j = 0

  while (j < rest.length) {
    const char = rest[j]!

    if (char === '\\' && j + 1 < rest.length) {
      // Escaped character
      if (state === 'pattern') {
        pattern += char + rest[j + 1]
      } else if (state === 'replacement') {
        replacement += char + rest[j + 1]
      } else {
        flags += char + rest[j + 1]
      }
      j += 2
      continue
    }

    if (char === '/') {
      if (state === 'pattern') {
        state = 'replacement'
      } else if (state === 'replacement') {
        state = 'flags'
      } else {
        // Extra delimiter in flags - unexpected
        return null
      }
      j++
      continue
    }

    if (state === 'pattern') {
      pattern += char
    } else if (state === 'replacement') {
      replacement += char
    } else {
      flags += char
    }
    j++
  }

  // Must have found all three parts (pattern, replacement delimiter, and optional flags)
  if (state !== 'flags') {
    return null
  }

  // Validate flags - only allow safe substitution flags
  const validFlags = /^[gpimIM1-9]*$/
  if (!validFlags.test(flags)) {
    return null
  }

  return {
    filePath,
    pattern,
    replacement,
    flags,
    extendedRegex,
  }
}

/**
 * Apply a sed substitution to file content
 * Returns the new content after applying the substitution
 */
export function applySedSubstitution(
  content: string,
  sedInfo: SedEditInfo,
): string {
  // Convert sed pattern to JavaScript regex
  let regexFlags = ''

  // Handle global flag
  if (sedInfo.flags.includes('g')) {
    regexFlags += 'g'
  }

  // Handle case-insensitive flag (i or I in sed)
  if (sedInfo.flags.includes('i') || sedInfo.flags.includes('I')) {
    regexFlags += 'i'
  }

  // Handle multiline flag (m or M in sed)
  if (sedInfo.flags.includes('m') || sedInfo.flags.includes('M')) {
    regexFlags += 'm'
  }

  // Convert sed pattern to JavaScript regex pattern
  let jsPattern = sedInfo.pattern
    // Unescape \/ to /
    .replace(/\\\//g, '/')

  // In BRE mode (no -E flag), metacharacters have opposite escaping:
  // BRE: \+ means "one or more", + is literal
  // ERE/JS: + means "one or more", \+ is literal
  // We need to convert BRE escaping to ERE for JavaScript regex
  if (!sedInfo.extendedRegex) {
    jsPattern = convertBrePatternToJs(jsPattern)
  }

  // Unescape sed-specific escapes in replacement
  // Convert \n to newline, & to $& (match), etc.
  // Use a unique placeholder with random salt to prevent injection attacks
  const salt = randomBytes(8).toString('hex')
  const ESCAPED_AMP_PLACEHOLDER = `___ESCAPED_AMPERSAND_${salt}___`
  const jsReplacement = sedInfo.replacement
    // Unescape \/ to /
    .replace(/\\\//g, '/')
    // First escape \& to a placeholder
    .replace(/\\&/g, ESCAPED_AMP_PLACEHOLDER)
    // Convert & to $& (full match) - use $$& to get literal $& in output
    .replace(/&/g, '$$&')
    // Convert placeholder back to literal &
    .replace(new RegExp(ESCAPED_AMP_PLACEHOLDER, 'g'), '&')

  try {
    const regex = new RegExp(jsPattern, regexFlags)
    return content.replace(regex, jsReplacement)
  } catch {
    // If regex is invalid, return original content
    return content
  }
}
