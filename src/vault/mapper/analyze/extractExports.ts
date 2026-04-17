import path from 'node:path'
import { ts } from 'ts-morph'
import type { TsParser } from './tsParser.js'

const EXPORT_CAP = 20
// Cap re-export recursion depth — `export * from './foo'` can chain. One
// hop is enough for the documentation use case; deeper chains rarely add
// distinct public symbols and they explode parse time.
const STAR_REEXPORT_MAX_DEPTH = 1

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
 *
 * F-4 perf fix: Uses raw `ts.SourceFile` (`parser.nativeSourceFile`) and
 * walks `sf.statements` directly. The previous ts-morph
 * `getStatements()` + `isExported()` path took ~500ms per top-level
 * statement on first access; the native walker is sub-millisecond per
 * file. The TypeScript-API approach also avoids `getExportedDeclarations()`
 * (which would invoke the TypeChecker).
 */
export function extractExports(parser: TsParser, files: string[]): ExtractExportsResult {
  const errors: Array<{ file: string; message: string }> = []

  const barrel = files.find((f) => {
    const base = path.basename(f)
    return base === 'index.ts' || base === 'index.js' || base === 'index.tsx' || base === 'index.jsx'
  })

  let names: string[]

  if (barrel) {
    const result = extractFromFile(parser, barrel, 0, new Set())
    if (result.error) {
      errors.push({ file: barrel, message: result.error })
      names = []
    } else {
      names = result.names
    }
  } else {
    const allNames: string[] = []
    for (const file of files) {
      const result = extractFromFile(parser, file, 0, new Set())
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

function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function hasDefaultModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false
}

function extractFromFile(
  parser: TsParser,
  filePath: string,
  depth: number,
  visited: Set<string>,
): { names: string[]; error?: undefined } | { names: string[]; error: string } {
  // Recursion guard for `export * from` chains.
  if (visited.has(filePath)) return { names: [] }
  visited.add(filePath)

  let sf: ts.SourceFile
  try {
    sf = parser.nativeSourceFile(filePath)
  } catch (err) {
    return { names: [], error: `Failed to parse: ${err instanceof Error ? err.message : String(err)}` }
  }

  const names: string[] = []

  try {
    for (const stmt of sf.statements) {
      collectExportsFromStatement(parser, stmt, filePath, depth, visited, names)
    }
  } catch (err) {
    return {
      names,
      error: `Partial parse: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  return { names }
}

function collectExportsFromStatement(
  parser: TsParser,
  stmt: ts.Statement,
  filePath: string,
  depth: number,
  visited: Set<string>,
  out: string[],
): void {
  // export const X / export let X / export var X
  if (ts.isVariableStatement(stmt)) {
    if (!hasExportModifier(stmt)) return
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) out.push(decl.name.text)
    }
    return
  }

  // export function X / export default function X
  if (ts.isFunctionDeclaration(stmt)) {
    if (!hasExportModifier(stmt)) return
    if (hasDefaultModifier(stmt)) {
      out.push('default')
      return
    }
    if (stmt.name) out.push(stmt.name.text)
    return
  }

  // export class X / export default class X
  if (ts.isClassDeclaration(stmt)) {
    if (!hasExportModifier(stmt)) return
    if (hasDefaultModifier(stmt)) {
      out.push('default')
      return
    }
    if (stmt.name) out.push(stmt.name.text)
    return
  }

  if (ts.isInterfaceDeclaration(stmt)) {
    if (!hasExportModifier(stmt)) return
    out.push(stmt.name.text)
    return
  }

  if (ts.isTypeAliasDeclaration(stmt)) {
    if (!hasExportModifier(stmt)) return
    out.push(stmt.name.text)
    return
  }

  if (ts.isEnumDeclaration(stmt)) {
    if (!hasExportModifier(stmt)) return
    out.push(stmt.name.text)
    return
  }

  if (ts.isModuleDeclaration(stmt)) {
    if (!hasExportModifier(stmt)) return
    if (stmt.name && (ts.isIdentifier(stmt.name) || ts.isStringLiteral(stmt.name))) {
      out.push(stmt.name.text)
    }
    return
  }

  // export default <expr>  (and export = <expr> in CommonJS)
  if (ts.isExportAssignment(stmt)) {
    out.push('default')
    return
  }

  // export { x }, export { x as y }, export { x } from '...', export * from '...'
  if (ts.isExportDeclaration(stmt)) {
    if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const spec of stmt.exportClause.elements) {
        // `name as alias` → exported name is the alias; otherwise just name
        const exportedName = (spec.name as ts.Identifier).text
        out.push(exportedName)
      }
      return
    }
    // Star re-export: `export * from '...'` (exportClause undefined)
    if (!stmt.exportClause && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      if (depth >= STAR_REEXPORT_MAX_DEPTH) return
      const resolved = parser.resolveModuleSpecifier(stmt.moduleSpecifier.text, filePath)
      if (resolved) {
        const sub = extractFromFile(parser, resolved, depth + 1, visited)
        if (!sub.error) out.push(...sub.names)
      }
      return
    }
    // Namespace re-export: `export * as ns from '...'` (exportClause is NamespaceExport)
    if (stmt.exportClause && ts.isNamespaceExport(stmt.exportClause)) {
      out.push(stmt.exportClause.name.text)
    }
  }
}
