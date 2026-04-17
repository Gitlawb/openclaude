import { ts } from 'ts-morph'
import type { TsParser } from './tsParser.js'

export interface ImportRef {
  specifier: string
  fromFile: string
  resolvedPath: string | null
  isTypeOnly: boolean
  isExternal: boolean
}

export interface ExtractImportsResult {
  imports: ImportRef[]
  skipped: Array<{ file: string; reason: string }>
  errors: Array<{ file: string; message: string }>
}

/**
 * Extract all import references from the given source files.
 *
 * Handles: `import`, `export ... from`, `require()`, dynamic `import('literal')`.
 * Non-literal dynamic imports are recorded in the skip list.
 * Deduplicates per (specifier, fromFile) pair.
 *
 * F-4 perf fix: walks the raw `ts.SourceFile` instead of going through
 * ts-morph node wrappers; sub-millisecond per file vs hundreds of ms.
 */
export function extractImports(parser: TsParser, files: string[]): ExtractImportsResult {
  const imports: ImportRef[] = []
  const skipped: Array<{ file: string; reason: string }> = []
  const errors: Array<{ file: string; message: string }> = []
  const seen = new Set<string>()

  for (const file of files) {
    let sf: ts.SourceFile
    try {
      sf = parser.nativeSourceFile(file)
    } catch (err) {
      errors.push({ file, message: `Failed to parse: ${err instanceof Error ? err.message : String(err)}` })
      continue
    }

    try {
      collectFromFile(parser, sf, file, imports, skipped, seen)
    } catch (err) {
      errors.push({ file, message: `Partial analysis: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  return { imports, skipped, errors }
}

function addRef(
  ref: ImportRef,
  imports: ImportRef[],
  seen: Set<string>,
): void {
  const key = `${ref.specifier}\0${ref.fromFile}`
  if (seen.has(key)) return
  seen.add(key)
  imports.push(ref)
}

function resolveSpecifier(
  parser: TsParser,
  specifier: string,
  fromFile: string,
): { resolvedPath: string | null; isExternal: boolean } {
  const resolved = parser.resolveModuleSpecifier(specifier, fromFile)
  if (resolved) return { resolvedPath: resolved, isExternal: false }

  // If it doesn't resolve and it's not a relative path, it's external
  const isRelative = specifier.startsWith('.') || specifier.startsWith('/')
  return { resolvedPath: null, isExternal: !isRelative }
}

function collectFromFile(
  parser: TsParser,
  sf: ts.SourceFile,
  filePath: string,
  imports: ImportRef[],
  skipped: Array<{ file: string; reason: string }>,
  seen: Set<string>,
): void {
  // 1. Top-level import / export-from declarations.
  for (const stmt of sf.statements) {
    // import { x } from 'y' / import x from 'y' / import 'y' / import type { x } from 'y'
    if (ts.isImportDeclaration(stmt)) {
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
      const specifier = stmt.moduleSpecifier.text
      const isTypeOnly = !!stmt.importClause?.isTypeOnly
      const { resolvedPath, isExternal } = resolveSpecifier(parser, specifier, filePath)
      addRef(
        { specifier, fromFile: filePath, resolvedPath, isTypeOnly, isExternal },
        imports,
        seen,
      )
      continue
    }

    // export { x } from 'y' / export * from 'y' (re-export with module specifier)
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const specifier = stmt.moduleSpecifier.text
      const isTypeOnly = stmt.isTypeOnly
      const { resolvedPath, isExternal } = resolveSpecifier(parser, specifier, filePath)
      addRef(
        { specifier, fromFile: filePath, resolvedPath, isTypeOnly, isExternal },
        imports,
        seen,
      )
    }
  }

  // 2 + 3. require('...') and dynamic import('...') — full descendant walk.
  walk(sf)

  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      // import('...')
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length > 0) {
          const arg = node.arguments[0]
          if (ts.isStringLiteral(arg)) {
            const specifier = arg.text
            const { resolvedPath, isExternal } = resolveSpecifier(parser, specifier, filePath)
            addRef(
              { specifier, fromFile: filePath, resolvedPath, isTypeOnly: false, isExternal },
              imports,
              seen,
            )
          } else {
            skipped.push({ file: filePath, reason: `dynamic-import-skipped: import(${arg.getText(sf)})` })
            addRef(
              { specifier: '<dynamic>', fromFile: filePath, resolvedPath: null, isTypeOnly: false, isExternal: false },
              imports,
              seen,
            )
          }
        }
      }
      // require('...')
      else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        node.arguments.length > 0
      ) {
        const arg = node.arguments[0]
        if (ts.isStringLiteral(arg)) {
          const specifier = arg.text
          const { resolvedPath, isExternal } = resolveSpecifier(parser, specifier, filePath)
          addRef(
            { specifier, fromFile: filePath, resolvedPath, isTypeOnly: false, isExternal },
            imports,
            seen,
          )
        }
      }
    }
    ts.forEachChild(node, walk)
  }
}
