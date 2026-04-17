import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Project, ts, type SourceFile } from 'ts-morph'

/**
 * Narrow facade over ts-morph used by the Codebase Mapper's analyze stage.
 *
 * Hides Project construction and module-resolution plumbing so callers
 * work with a small, stable API (`sourceFile`, `resolveModuleSpecifier`).
 *
 * The underlying ts-morph `Project` is built lazily on first use. When a
 * `tsconfig.json` lives at `repoRoot`, the parser honors its compiler
 * options (including `paths` / `baseUrl`); otherwise a minimal default
 * config is used (module: NodeNext, allowJs: true, noEmit).
 */
export interface TsParser {
  /**
   * Return the ts-morph `SourceFile` for `filePath`. Adds it to the
   * underlying project on first request and caches it thereafter.
   * Slow — ts-morph wraps every node, dominates analyze runtime.
   * Prefer {@link nativeSourceFile} for syntactic-only walks.
   */
  sourceFile(filePath: string): SourceFile
  /**
   * Return a raw `ts.SourceFile` parsed via `ts.createSourceFile`. Fast,
   * cached per `filePath`. No type information, no parent project — use
   * when you only need a syntactic AST walk (export/import extraction).
   * F-4 perf fix: ~10 000× faster than going through ts-morph for the
   * same syntactic data.
   */
  nativeSourceFile(filePath: string): ts.SourceFile
  /**
   * Resolve `specifier` (e.g. `./foo`, `@app/bar`, `node:fs`) from the
   * perspective of `fromFile`. Returns an absolute path on success, or
   * `null` when the specifier refers to an external package or cannot be
   * resolved.
   */
  resolveModuleSpecifier(specifier: string, fromFile: string): string | null
  /** Absolute path of the repo root the parser was constructed with. */
  readonly repoRoot: string
}

export interface CreateTsParserOptions {
  /**
   * Explicit tsconfig path. When omitted, the parser looks for
   * `<repoRoot>/tsconfig.json` and uses it if present.
   */
  tsConfigFilePath?: string
}

export function createTsParser(repoRoot: string, options: CreateTsParserOptions = {}): TsParser {
  const absRepoRoot = path.resolve(repoRoot)
  let project: Project | null = null

  // F-4 perf fix: cache module-resolution results by (specifier, fromDir).
  // Imports with the same specifier from files in the same directory resolve
  // identically; ts.resolveModuleName does fs.statSync work that dominates
  // the analyze stage on large repos. Cache miss rate on bridgeai/ is ~5%.
  const resolveCache = new Map<string, string | null>()

  function getProject(): Project {
    if (project) return project
    const explicit = options.tsConfigFilePath
    const candidate = explicit ?? path.join(absRepoRoot, 'tsconfig.json')
    const useTsConfig = existsSync(candidate)
    // F-4 perf fix: skipFileDependencyResolution stops ts-morph from
    // chasing transitive imports when a SourceFile is added. The mapper
    // doesn't need a complete program — it works file-by-file via
    // getImportDeclarations / getDescendants and resolves specifiers
    // explicitly via ts.resolveModuleName. Without this flag, adding
    // 318 source files on bridgeai/ pulled the entire dep graph in,
    // dominating the ~13-min dogfood runtime.
    project = new Project(
      useTsConfig
        ? {
            tsConfigFilePath: candidate,
            skipAddingFilesFromTsConfig: true,
            skipFileDependencyResolution: true,
          }
        : {
            compilerOptions: {
              module: ts.ModuleKind.NodeNext,
              moduleResolution: ts.ModuleResolutionKind.NodeNext,
              target: ts.ScriptTarget.ES2022,
              allowJs: true,
              noEmit: true,
              esModuleInterop: true,
            },
            useInMemoryFileSystem: false,
            skipFileDependencyResolution: true,
          },
    )
    return project
  }

  function sourceFile(filePath: string): SourceFile {
    const p = getProject()
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(absRepoRoot, filePath)
    const existing = p.getSourceFile(abs)
    if (existing) return existing
    return p.addSourceFileAtPath(abs)
  }

  // Cache parsed native source files by absolute path. ts.createSourceFile
  // re-parses every call; the cache turns repeat work (extractExports +
  // extractImports both touch the same files) into Map lookups.
  const nativeCache = new Map<string, ts.SourceFile>()

  function nativeSourceFile(filePath: string): ts.SourceFile {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(absRepoRoot, filePath)
    const cached = nativeCache.get(abs)
    if (cached) return cached
    const text = readFileSync(abs, 'utf-8')
    const scriptKind = abs.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : abs.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : abs.endsWith('.js') || abs.endsWith('.mjs')
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, false, scriptKind)
    nativeCache.set(abs, sf)
    return sf
  }

  function resolveModuleSpecifier(specifier: string, fromFile: string): string | null {
    const absFrom = path.isAbsolute(fromFile) ? fromFile : path.resolve(absRepoRoot, fromFile)
    const fromDir = path.dirname(absFrom)
    const cacheKey = `${specifier}\0${fromDir}`
    const cached = resolveCache.get(cacheKey)
    if (cached !== undefined) return cached

    const p = getProject()
    const compilerOptions = p.getCompilerOptions()
    const result = ts.resolveModuleName(
      specifier,
      absFrom,
      compilerOptions,
      ts.sys,
    )
    const resolved = result.resolvedModule
    let final: string | null
    if (!resolved) final = null
    // Treat declarations-only resolutions inside node_modules as external.
    else if (resolved.isExternalLibraryImport) final = null
    else final = path.resolve(resolved.resolvedFileName)

    resolveCache.set(cacheKey, final)
    return final
  }

  return {
    sourceFile,
    nativeSourceFile,
    resolveModuleSpecifier,
    get repoRoot() {
      return absRepoRoot
    },
  }
}
