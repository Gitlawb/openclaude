import { existsSync } from 'node:fs'
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
   */
  sourceFile(filePath: string): SourceFile
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

  function getProject(): Project {
    if (project) return project
    const explicit = options.tsConfigFilePath
    const candidate = explicit ?? path.join(absRepoRoot, 'tsconfig.json')
    const useTsConfig = existsSync(candidate)
    project = new Project(
      useTsConfig
        ? { tsConfigFilePath: candidate, skipAddingFilesFromTsConfig: true }
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

  function resolveModuleSpecifier(specifier: string, fromFile: string): string | null {
    const p = getProject()
    const absFrom = path.isAbsolute(fromFile) ? fromFile : path.resolve(absRepoRoot, fromFile)
    const compilerOptions = p.getCompilerOptions()
    const result = ts.resolveModuleName(
      specifier,
      absFrom,
      compilerOptions,
      ts.sys,
    )
    const resolved = result.resolvedModule
    if (!resolved) return null
    // Treat declarations-only resolutions inside node_modules as external.
    if (resolved.isExternalLibraryImport) return null
    return path.resolve(resolved.resolvedFileName)
  }

  return {
    sourceFile,
    resolveModuleSpecifier,
    get repoRoot() {
      return absRepoRoot
    },
  }
}
