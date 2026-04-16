import path from 'node:path'
import type { SourceFile } from 'ts-morph'
import { SyntaxKind } from 'ts-morph'
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
 */
export function extractImports(parser: TsParser, files: string[]): ExtractImportsResult {
  const imports: ImportRef[] = []
  const skipped: Array<{ file: string; reason: string }> = []
  const errors: Array<{ file: string; message: string }> = []
  const seen = new Set<string>()

  for (const file of files) {
    let sf: SourceFile
    try {
      sf = parser.sourceFile(file)
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

function getPackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.slice(0, 2).join('/')
  }
  return specifier.split('/')[0]
}

function collectFromFile(
  parser: TsParser,
  sf: SourceFile,
  filePath: string,
  imports: ImportRef[],
  skipped: Array<{ file: string; reason: string }>,
  seen: Set<string>,
): void {
  // 1. Import declarations: import { x } from 'y', import x from 'y', import 'y'
  for (const decl of sf.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue()
    const isTypeOnly = decl.isTypeOnly()
    const { resolvedPath, isExternal } = resolveSpecifier(parser, specifier, filePath)

    addRef(
      { specifier, fromFile: filePath, resolvedPath, isTypeOnly, isExternal },
      imports,
      seen,
    )
  }

  // 2. Export declarations with module specifier: export { x } from 'y'
  for (const decl of sf.getExportDeclarations()) {
    const modSpec = decl.getModuleSpecifierValue()
    if (!modSpec) continue
    const isTypeOnly = decl.isTypeOnly()
    const { resolvedPath, isExternal } = resolveSpecifier(parser, modSpec, filePath)

    addRef(
      { specifier: modSpec, fromFile: filePath, resolvedPath, isTypeOnly, isExternal },
      imports,
      seen,
    )
  }

  // 3. require() calls
  for (const callExpr of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = callExpr.getExpression()
    if (expr.getText() !== 'require') continue
    const args = callExpr.getArguments()
    if (args.length === 0) continue
    const arg = args[0]
    if (arg.getKind() !== SyntaxKind.StringLiteral) continue
    const specifier = arg.getText().slice(1, -1) // remove quotes
    const { resolvedPath, isExternal } = resolveSpecifier(parser, specifier, filePath)

    addRef(
      { specifier, fromFile: filePath, resolvedPath, isTypeOnly: false, isExternal },
      imports,
      seen,
    )
  }

  // 4. Dynamic imports: import('...')
  for (const callExpr of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = callExpr.getExpression()
    if (expr.getKind() !== SyntaxKind.ImportKeyword) continue
    const args = callExpr.getArguments()
    if (args.length === 0) continue
    const arg = args[0]
    if (arg.getKind() === SyntaxKind.StringLiteral) {
      // Literal dynamic import
      const specifier = arg.getText().slice(1, -1)
      const { resolvedPath, isExternal } = resolveSpecifier(parser, specifier, filePath)
      addRef(
        { specifier, fromFile: filePath, resolvedPath, isTypeOnly: false, isExternal },
        imports,
        seen,
      )
    } else {
      // Non-literal dynamic import — skip
      skipped.push({ file: filePath, reason: `dynamic-import-skipped: import(${arg.getText()})` })
      addRef(
        { specifier: '<dynamic>', fromFile: filePath, resolvedPath: null, isTypeOnly: false, isExternal: false },
        imports,
        seen,
      )
    }
  }
}
