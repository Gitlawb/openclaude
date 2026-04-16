import { readFileSync } from 'node:fs'

/**
 * Best-effort scan for environment variable references in source files.
 *
 * Looks for:
 * - `process.env.VAR_NAME`
 * - `import ... from 'dotenv'` / `require('dotenv')`
 * - `Bun.env.VAR_NAME`
 *
 * Returns a deduplicated, sorted list of findings as bullet strings.
 */
export function scanEnvReferences(files: string[]): string[] {
  const envVars = new Set<string>()
  let usesDotenv = false

  const ENV_PATTERN = /(?:process\.env|Bun\.env)\.([A-Z_][A-Z0-9_]*)/g
  const DOTENV_IMPORT = /(?:from\s+['"]dotenv['"]|require\s*\(\s*['"]dotenv['"]\s*\))/

  for (const file of files) {
    let content: string
    try {
      content = readFileSync(file, 'utf-8')
    } catch {
      continue
    }

    for (const match of content.matchAll(ENV_PATTERN)) {
      envVars.add(match[1])
    }

    if (DOTENV_IMPORT.test(content)) {
      usesDotenv = true
    }
  }

  const results: string[] = []
  if (usesDotenv) {
    results.push('Uses `dotenv` for environment configuration')
  }
  for (const v of [...envVars].sort()) {
    results.push(`\`${v}\``)
  }

  return results
}
