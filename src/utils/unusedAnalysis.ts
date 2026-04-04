import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

const DEFAULT_INCLUDE_DIRS = ['src', 'scripts']
const DEFAULT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
])
const DEFAULT_EXCLUDED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.omx',
  'dist',
  'node_modules',
])

type CandidateKind =
  | 'default-import'
  | 'named-import'
  | 'namespace-import'
  | 'function'
  | 'class'
  | 'variable'
  | 'type'
  | 'interface'
  | 'enum'

type Candidate = {
  id: string
  name: string
  kind: CandidateKind
  filePath: string
  relativePath: string
  symbol: ts.Symbol
  targetSymbol?: ts.Symbol
  ownerNode: ts.Node
  rangeNode: ts.Node
  nameNode: ts.Node
  dependencies: Set<string>
}

export type UnusedImportFinding = {
  file: string
  name: string
  kind: 'default-import' | 'named-import' | 'namespace-import'
  moduleSpecifier: string
  startLine: number
  endLine: number
}

export type UnusedDeclarationFinding = {
  file: string
  name: string
  kind: Exclude<CandidateKind, 'default-import' | 'named-import' | 'namespace-import'>
  startLine: number
  endLine: number
}

export type UnusedLineRange = {
  file: string
  startLine: number
  endLine: number
  reasons: string[]
}

export type UnusedAnalysisReport = {
  summary: {
    rootDir: string
    filesScanned: number
    unusedImports: number
    unusedDeclarations: number
    unusedLineRanges: number
    unusedLineCount: number
  }
  unusedImports: UnusedImportFinding[]
  unusedDeclarations: UnusedDeclarationFinding[]
  unusedLineRanges: UnusedLineRange[]
}

export type UnusedAnalysisOptions = {
  rootDir?: string
  includeDirs?: string[]
  extensions?: Iterable<string>
  excludeDirs?: Iterable<string>
}

export type UnusedAnalysisCliOptions = UnusedAnalysisOptions & {
  json: boolean
  failOnFindings: boolean
}

export function parseUnusedAnalysisArgs(
  argv: string[],
): UnusedAnalysisCliOptions {
  const options: UnusedAnalysisCliOptions = {
    json: false,
    failOnFindings: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      options.json = true
      continue
    }

    if (arg === '--fail-on-findings') {
      options.failOnFindings = true
      continue
    }

    if (arg === '--root') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        options.rootDir = next
        i++
      }
      continue
    }

    if (arg === '--include') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        options.includeDirs = next
          .split(',')
          .map(part => part.trim())
          .filter(Boolean)
        i++
      }
      continue
    }
  }

  return options
}

export function analyzeUnusedCode(
  options: UnusedAnalysisOptions = {},
): UnusedAnalysisReport {
  const rootDir = resolve(options.rootDir ?? process.cwd())
  const includeDirs = options.includeDirs?.length
    ? options.includeDirs
    : DEFAULT_INCLUDE_DIRS
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS)
  const excludeDirs = new Set(options.excludeDirs ?? DEFAULT_EXCLUDED_DIRS)
  const filePaths = collectProjectFiles({
    rootDir,
    includeDirs,
    extensions,
    excludeDirs,
  })

  if (filePaths.length === 0) {
    return {
      summary: {
        rootDir,
        filesScanned: 0,
        unusedImports: 0,
        unusedDeclarations: 0,
        unusedLineRanges: 0,
        unusedLineCount: 0,
      },
      unusedImports: [],
      unusedDeclarations: [],
      unusedLineRanges: [],
    }
  }

  const program = ts.createProgram(filePaths, resolveCompilerOptions(rootDir))
  const checker = program.getTypeChecker()
  const fileSet = new Set(filePaths)
  const sourceFiles = program.getSourceFiles().filter(sourceFile =>
    fileSet.has(resolve(sourceFile.fileName)),
  )

  const candidates: Candidate[] = []
  const candidateByNode = new WeakMap<ts.Node, Candidate>()
  const candidateBySymbol = new Map<ts.Symbol, Candidate>()

  for (const sourceFile of sourceFiles) {
    collectCandidates({
      sourceFile,
      checker,
      rootDir,
      candidates,
      candidateByNode,
      candidateBySymbol,
    })
  }

  for (const candidate of candidates) {
    if (!candidate.targetSymbol) continue
    const targetCandidate = getCandidateForSymbol({
      checker,
      candidateBySymbol,
      symbol: candidate.targetSymbol,
    })
    if (targetCandidate && targetCandidate.id !== candidate.id) {
      candidate.dependencies.add(targetCandidate.id)
    }
  }

  const rooted = new Set<string>()
  for (const sourceFile of sourceFiles) {
    walkTree(sourceFile, node => {
      if (!ts.isIdentifier(node)) return
      if (isImportSyntaxIdentifier(node) || isExportOnlyReference(node)) return

      const symbol = checker.getSymbolAtLocation(node)
      if (!symbol) return

      const referencedCandidate = getCandidateForSymbol({
        checker,
        candidateBySymbol,
        symbol,
      })
      if (!referencedCandidate) return
      if (node === referencedCandidate.nameNode) return

      const ownerCandidate = findOwningCandidate(node, candidateByNode)
      if (ownerCandidate && ownerCandidate.id !== referencedCandidate.id) {
        ownerCandidate.dependencies.add(referencedCandidate.id)
        return
      }

      if (!ownerCandidate) {
        rooted.add(referencedCandidate.id)
      }
    })
  }

  const live = computeLiveSet(candidates, rooted)
  const unusedCandidates = candidates.filter(candidate => !live.has(candidate.id))

  const unusedImports = unusedCandidates
    .filter(
      candidate =>
        candidate.kind === 'default-import' ||
        candidate.kind === 'named-import' ||
        candidate.kind === 'namespace-import',
    )
    .map(candidate => {
      const { startLine, endLine } = getLineRange(candidate.rangeNode)
      const importDeclaration = candidate.rangeNode.parent
      const moduleSpecifier = ts.isImportDeclaration(importDeclaration)
        ? importDeclaration.moduleSpecifier.getText().slice(1, -1)
        : 'unknown'
      return {
        file: candidate.relativePath,
        name: candidate.name,
        kind: candidate.kind,
        moduleSpecifier,
        startLine,
        endLine,
      } satisfies UnusedImportFinding
    })
    .sort(compareByFileAndLine)

  const unusedDeclarations = unusedCandidates
    .filter(
      candidate =>
        candidate.kind !== 'default-import' &&
        candidate.kind !== 'named-import' &&
        candidate.kind !== 'namespace-import',
    )
    .map(candidate => {
      const { startLine, endLine } = getLineRange(candidate.rangeNode)
      return {
        file: candidate.relativePath,
        name: candidate.name,
        kind: candidate.kind,
        startLine,
        endLine,
      } satisfies UnusedDeclarationFinding
    })
    .sort(compareByFileAndLine)

  const unusedLineRanges = buildUnusedLineRanges(unusedCandidates)
  const unusedLineCount = unusedLineRanges.reduce(
    (count, range) => count + (range.endLine - range.startLine + 1),
    0,
  )

  return {
    summary: {
      rootDir,
      filesScanned: sourceFiles.length,
      unusedImports: unusedImports.length,
      unusedDeclarations: unusedDeclarations.length,
      unusedLineRanges: unusedLineRanges.length,
      unusedLineCount,
    },
    unusedImports,
    unusedDeclarations,
    unusedLineRanges,
  }
}

export function formatUnusedAnalysisReport(
  report: UnusedAnalysisReport,
): string {
  const lines = [
    `Scanned ${report.summary.filesScanned} files under ${report.summary.rootDir}`,
    `Unused imports: ${report.summary.unusedImports}`,
    `Unused declarations: ${report.summary.unusedDeclarations}`,
    `Unused line ranges: ${report.summary.unusedLineRanges} (${report.summary.unusedLineCount} lines)`,
  ]

  if (
    report.unusedImports.length === 0 &&
    report.unusedDeclarations.length === 0
  ) {
    lines.push('')
    lines.push('No unused imports or declarations found.')
    return lines.join('\n')
  }

  const grouped = new Map<
    string,
    {
      imports: UnusedImportFinding[]
      declarations: UnusedDeclarationFinding[]
      lineRanges: UnusedLineRange[]
    }
  >()

  for (const finding of report.unusedImports) {
    const bucket =
      grouped.get(finding.file) ??
      { imports: [], declarations: [], lineRanges: [] }
    bucket.imports.push(finding)
    grouped.set(finding.file, bucket)
  }

  for (const finding of report.unusedDeclarations) {
    const bucket =
      grouped.get(finding.file) ??
      { imports: [], declarations: [], lineRanges: [] }
    bucket.declarations.push(finding)
    grouped.set(finding.file, bucket)
  }

  for (const range of report.unusedLineRanges) {
    const bucket =
      grouped.get(range.file) ??
      { imports: [], declarations: [], lineRanges: [] }
    bucket.lineRanges.push(range)
    grouped.set(range.file, bucket)
  }

  for (const file of [...grouped.keys()].sort()) {
    const bucket = grouped.get(file)
    if (!bucket) continue
    lines.push('')
    lines.push(file)

    for (const finding of bucket.imports.sort(compareByFileAndLine)) {
      lines.push(
        `  import ${finding.name} (${finding.kind}) from ${finding.moduleSpecifier} [lines ${formatLineRange(finding.startLine, finding.endLine)}]`,
      )
    }

    for (const finding of bucket.declarations.sort(compareByFileAndLine)) {
      lines.push(
        `  declaration ${finding.name} (${finding.kind}) [lines ${formatLineRange(finding.startLine, finding.endLine)}]`,
      )
    }

    if (bucket.lineRanges.length > 0) {
      lines.push(
        `  unused lines: ${bucket.lineRanges
          .sort(compareByFileAndLine)
          .map(range => `${formatLineRange(range.startLine, range.endLine)} (${range.reasons.join(', ')})`)
          .join('; ')}`,
      )
    }
  }

  return lines.join('\n')
}

function collectProjectFiles(args: {
  rootDir: string
  includeDirs: string[]
  extensions: Set<string>
  excludeDirs: Set<string>
}): string[] {
  const files: string[] = []

  for (const includeDir of args.includeDirs) {
    const absoluteDir = resolve(args.rootDir, includeDir)
    walkDirectory(absoluteDir, entryPath => {
      if (entryPath.endsWith('.d.ts')) return
      const extension = entryPath.slice(entryPath.lastIndexOf('.'))
      if (!args.extensions.has(extension)) return
      files.push(entryPath)
    }, args.excludeDirs)
  }

  files.sort()
  return files
}

function walkDirectory(
  directoryPath: string,
  onFile: (filePath: string) => void,
  excludeDirs: Set<string>,
): void {
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(directoryPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) continue
      walkDirectory(join(directoryPath, entry.name), onFile, excludeDirs)
      continue
    }

    if (!entry.isFile()) continue
    onFile(join(directoryPath, entry.name))
  }
}

function resolveCompilerOptions(rootDir: string): ts.CompilerOptions {
  const baseOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
    strict: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    noEmit: true,
  }

  const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json')
  if (!configPath) return baseOptions

  const readResult = ts.readConfigFile(configPath, ts.sys.readFile)
  if (readResult.error) return baseOptions

  const parsed = ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    rootDir,
    baseOptions,
    configPath,
  )

  return {
    ...parsed.options,
    ...baseOptions,
    rootDir: undefined,
    outDir: undefined,
    declaration: false,
    incremental: false,
    composite: false,
  }
}

function collectCandidates(args: {
  sourceFile: ts.SourceFile
  checker: ts.TypeChecker
  rootDir: string
  candidates: Candidate[]
  candidateByNode: WeakMap<ts.Node, Candidate>
  candidateBySymbol: Map<ts.Symbol, Candidate>
}): void {
  for (const statement of args.sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      collectImportCandidates(statement, args)
      continue
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      addCandidate(
        {
          kind: 'function',
          nameNode: statement.name,
          ownerNode: statement,
          rangeNode: statement,
        },
        args,
      )
      continue
    }

    if (ts.isClassDeclaration(statement) && statement.name) {
      addCandidate(
        {
          kind: 'class',
          nameNode: statement.name,
          ownerNode: statement,
          rangeNode: statement,
        },
        args,
      )
      continue
    }

    if (ts.isTypeAliasDeclaration(statement)) {
      addCandidate(
        {
          kind: 'type',
          nameNode: statement.name,
          ownerNode: statement,
          rangeNode: statement,
        },
        args,
      )
      continue
    }

    if (ts.isInterfaceDeclaration(statement)) {
      addCandidate(
        {
          kind: 'interface',
          nameNode: statement.name,
          ownerNode: statement,
          rangeNode: statement,
        },
        args,
      )
      continue
    }

    if (ts.isEnumDeclaration(statement)) {
      addCandidate(
        {
          kind: 'enum',
          nameNode: statement.name,
          ownerNode: statement,
          rangeNode: statement,
        },
        args,
      )
      continue
    }

    if (!ts.isVariableStatement(statement)) continue

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      addCandidate(
        {
          kind: 'variable',
          nameNode: declaration.name,
          ownerNode: declaration,
          rangeNode: declaration,
        },
        args,
      )
    }
  }
}

function collectImportCandidates(
  statement: ts.ImportDeclaration,
  args: {
    sourceFile: ts.SourceFile
    checker: ts.TypeChecker
    rootDir: string
    candidates: Candidate[]
    candidateByNode: WeakMap<ts.Node, Candidate>
    candidateBySymbol: Map<ts.Symbol, Candidate>
  },
): void {
  const clause = statement.importClause
  if (!clause) return

  if (clause.name) {
    addCandidate(
      {
        kind: 'default-import',
        nameNode: clause.name,
        ownerNode: clause.name,
        rangeNode: clause.name,
      },
      args,
    )
  }

  const namedBindings = clause.namedBindings
  if (!namedBindings) return

  if (ts.isNamespaceImport(namedBindings)) {
    addCandidate(
      {
        kind: 'namespace-import',
        nameNode: namedBindings.name,
        ownerNode: namedBindings.name,
        rangeNode: namedBindings,
      },
      args,
    )
    return
  }

  for (const element of namedBindings.elements) {
    addCandidate(
      {
        kind: 'named-import',
        nameNode: element.name,
        ownerNode: element.name,
        rangeNode: element,
      },
      args,
    )
  }
}

function addCandidate(
  candidateInput: {
    kind: CandidateKind
    nameNode: ts.Identifier
    ownerNode: ts.Node
    rangeNode: ts.Node
  },
  args: {
    sourceFile: ts.SourceFile
    checker: ts.TypeChecker
    rootDir: string
    candidates: Candidate[]
    candidateByNode: WeakMap<ts.Node, Candidate>
    candidateBySymbol: Map<ts.Symbol, Candidate>
  },
): void {
  const symbol = args.checker.getSymbolAtLocation(candidateInput.nameNode)
  if (!symbol || args.candidateBySymbol.has(symbol)) return

  const relativePath = normalizeRelativePath(
    relative(args.rootDir, args.sourceFile.fileName),
  )
  const candidate: Candidate = {
    id: `${relativePath}:${candidateInput.nameNode.getStart(args.sourceFile)}:${candidateInput.nameNode.text}`,
    name: candidateInput.nameNode.text,
    kind: candidateInput.kind,
    filePath: resolve(args.sourceFile.fileName),
    relativePath,
    symbol,
    targetSymbol:
      symbol.flags & ts.SymbolFlags.Alias
        ? safeGetAliasedSymbol(args.checker, symbol)
        : undefined,
    ownerNode: candidateInput.ownerNode,
    rangeNode: candidateInput.rangeNode,
    nameNode: candidateInput.nameNode,
    dependencies: new Set(),
  }

  args.candidates.push(candidate)
  args.candidateByNode.set(candidate.ownerNode, candidate)
  args.candidateBySymbol.set(symbol, candidate)
}

function getCandidateForSymbol(args: {
  checker: ts.TypeChecker
  candidateBySymbol: Map<ts.Symbol, Candidate>
  symbol: ts.Symbol
}): Candidate | undefined {
  const directMatch = args.candidateBySymbol.get(args.symbol)
  if (directMatch) return directMatch

  if (!(args.symbol.flags & ts.SymbolFlags.Alias)) return undefined

  const target = safeGetAliasedSymbol(args.checker, args.symbol)
  return target ? args.candidateBySymbol.get(target) : undefined
}

function safeGetAliasedSymbol(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
): ts.Symbol | undefined {
  try {
    return checker.getAliasedSymbol(symbol)
  } catch {
    return undefined
  }
}

function findOwningCandidate(
  node: ts.Node,
  candidateByNode: WeakMap<ts.Node, Candidate>,
): Candidate | undefined {
  let current: ts.Node | undefined = node
  while (current) {
    const owner = candidateByNode.get(current)
    if (owner) return owner
    current = current.parent
  }
  return undefined
}

function isImportSyntaxIdentifier(node: ts.Identifier): boolean {
  let current: ts.Node | undefined = node
  while (current) {
    if (ts.isImportClause(current) || ts.isImportSpecifier(current)) return true
    if (ts.isNamespaceImport(current) || ts.isImportEqualsDeclaration(current)) {
      return true
    }
    if (ts.isSourceFile(current)) return false
    current = current.parent
  }
  return false
}

function isExportOnlyReference(node: ts.Identifier): boolean {
  let current: ts.Node | undefined = node
  while (current) {
    if (ts.isExportSpecifier(current) || ts.isExportAssignment(current)) {
      return true
    }
    if (ts.isSourceFile(current) || ts.isImportDeclaration(current)) {
      return false
    }
    current = current.parent
  }
  return false
}

function walkTree(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  node.forEachChild(child => walkTree(child, visit))
}

function computeLiveSet(
  candidates: Candidate[],
  rooted: Set<string>,
): Set<string> {
  const live = new Set<string>()
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]))
  const queue = [...rooted]

  while (queue.length > 0) {
    const candidateId = queue.shift()
    if (!candidateId || live.has(candidateId)) continue
    live.add(candidateId)
    const candidate = byId.get(candidateId)
    if (!candidate) continue
    for (const dependency of candidate.dependencies) {
      if (!live.has(dependency)) queue.push(dependency)
    }
  }

  return live
}

function buildUnusedLineRanges(candidates: Candidate[]): UnusedLineRange[] {
  const grouped = new Map<string, UnusedLineRange[]>()

  for (const candidate of candidates) {
    const { startLine, endLine } = getLineRange(candidate.rangeNode)
    const reason = `${candidate.kind}:${candidate.name}`
    const bucket = grouped.get(candidate.relativePath) ?? []
    bucket.push({
      file: candidate.relativePath,
      startLine,
      endLine,
      reasons: [reason],
    })
    grouped.set(candidate.relativePath, bucket)
  }

  const merged: UnusedLineRange[] = []
  for (const [file, ranges] of grouped) {
    ranges.sort(compareByFileAndLine)
    for (const range of ranges) {
      const previous = merged[merged.length - 1]
      if (
        previous &&
        previous.file === file &&
        range.startLine <= previous.endLine + 1
      ) {
        previous.endLine = Math.max(previous.endLine, range.endLine)
        previous.reasons = uniqueStrings([...previous.reasons, ...range.reasons])
        continue
      }
      merged.push({
        file,
        startLine: range.startLine,
        endLine: range.endLine,
        reasons: [...range.reasons],
      })
    }
  }

  return merged.sort(compareByFileAndLine)
}

function getLineRange(node: ts.Node): { startLine: number; endLine: number } {
  const sourceFile = node.getSourceFile()
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd())
  return {
    startLine: start.line + 1,
    endLine: end.line + 1,
  }
}

function compareByFileAndLine(
  left:
    | UnusedImportFinding
    | UnusedDeclarationFinding
    | UnusedLineRange,
  right:
    | UnusedImportFinding
    | UnusedDeclarationFinding
    | UnusedLineRange,
): number {
  const fileDiff = left.file.localeCompare(right.file)
  if (fileDiff !== 0) return fileDiff
  if (left.startLine !== right.startLine) {
    return left.startLine - right.startLine
  }
  return left.endLine - right.endLine
}

function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(sep).join('/')
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}
