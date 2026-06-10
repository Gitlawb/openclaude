import path from 'node:path'
import ts from 'typescript'

// Root `tsc --noEmit` has a known failing baseline. This focused check
// enforces diagnostics in type assertion files and covered implementation
// files while quarantining dependency diagnostics until the broader baseline
// is fixed.
function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function normalizeFileName(fileName: string): string {
  return path.normalize(path.resolve(fileName))
}

const configPath = ts.findConfigFile(
  process.cwd(),
  ts.sys.fileExists,
  'tsconfig.type-tests.json',
)

if (!configPath) {
  fail('Could not find tsconfig.type-tests.json')
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: fileName => fileName,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine,
}

if (configFile.error) {
  console.error(ts.formatDiagnostic(configFile.error, formatHost))
  process.exit(1)
}

const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  path.dirname(configPath),
)

if (parsedConfig.errors.length > 0) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(parsedConfig.errors, formatHost),
  )
  process.exit(1)
}

const rootFileNames = parsedConfig.fileNames.map(normalizeFileName)
const rootFileNameSet = new Set(rootFileNames)

if (rootFileNameSet.size === 0) {
  fail('tsconfig.type-tests.json does not include any files')
}

const program = ts.createProgram({
  rootNames: parsedConfig.fileNames,
  options: parsedConfig.options,
  projectReferences: parsedConfig.projectReferences,
})

const diagnostics = ts.getPreEmitDiagnostics(program)
const blockingDiagnostics = diagnostics.filter(diagnostic => {
  if (!diagnostic.file) {
    return true
  }

  return rootFileNameSet.has(normalizeFileName(diagnostic.file.fileName))
})

if (blockingDiagnostics.length > 0) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(blockingDiagnostics, formatHost),
  )
  process.exit(1)
}

const ignoredDiagnostics = diagnostics.length - blockingDiagnostics.length
const ignoredSuffix =
  ignoredDiagnostics === 0
    ? ''
    : ` (${ignoredDiagnostics} dependency diagnostics ignored)`

console.log(
  `Focused typecheck passed: ${rootFileNameSet.size} files checked${ignoredSuffix}.`,
)
