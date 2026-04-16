import path from 'node:path'
import type { SourceFile } from 'ts-morph'
import { SyntaxKind } from 'ts-morph'
import type { TsParser } from './tsParser.js'

const EXPORT_CAP = 20

export interface ExtractExportsResult {
  exports: string[]
  errors: Array<{ file: string; message: string }>
}

/**
 * Extract the public API surface of a module from its source files.
 *
 * Strategy:
 * 1. If an `index.ts` or `index.js` barrel exists, extract re-exports from it.
 * 2. Otherwise, union all top-level exports across all files.
 * 3. Deduplicate, sort, and cap at 20 entries (+ sentinel).
 */
export function extractExports(parser: TsParser, files: string[]): ExtractExportsResult {
  const errors: Array<{ file: string; message: string }> = []

  const barrel = files.find((f) => {
    const base = path.basename(f)
    return base === 'index.ts' || base === 'index.js' || base === 'index.tsx' || base === 'index.jsx'
  })

  let names: string[]

  if (barrel) {
    const result = extractFromFile(parser, barrel)
    if (result.error) {
      errors.push({ file: barrel, message: result.error })
      names = []
    } else {
      names = result.names
    }
  } else {
    const allNames: string[] = []
    for (const file of files) {
      const result = extractFromFile(parser, file)
      if (result.error) {
        errors.push({ file, message: result.error })
        continue
      }
      allNames.push(...result.names)
    }
    names = allNames
  }

  const deduped = [...new Set(names)].sort()
  const capped = capExports(deduped)

  return { exports: capped, errors }
}

function capExports(names: string[]): string[] {
  if (names.length <= EXPORT_CAP) return names
  const truncated = names.slice(0, EXPORT_CAP)
  truncated.push(`\u2026+${names.length - EXPORT_CAP} more`)
  return truncated
}

function extractFromFile(
  parser: TsParser,
  filePath: string,
): { names: string[]; error?: undefined } | { names: string[]; error: string } {
  let sf: SourceFile
  try {
    sf = parser.sourceFile(filePath)
  } catch (err) {
    return { names: [], error: `Failed to parse: ${err instanceof Error ? err.message : String(err)}` }
  }

  const names: string[] = []

  try {
    // Named export declarations: export const x, export function y, export class Z
    for (const decl of sf.getExportedDeclarations()) {
      const [name, declarations] = decl
      if (name === 'default') {
        names.push('default')
        continue
      }
      // Verify at least one declaration actually has an export keyword or is re-exported
      if (declarations.length > 0) {
        names.push(name)
      }
    }

    // Also pick up `export { ... } from '...'` re-export names not caught above
    for (const exportDecl of sf.getExportDeclarations()) {
      for (const named of exportDecl.getNamedExports()) {
        const alias = named.getAliasNode()?.getText() ?? named.getName()
        if (!names.includes(alias)) {
          names.push(alias)
        }
      }
      // `export * from '...'` — we can't enumerate individual names statically,
      // but the re-exported module's own exports would appear via getExportedDeclarations
    }
  } catch (err) {
    return {
      names,
      error: `Partial parse: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  return { names }
}
