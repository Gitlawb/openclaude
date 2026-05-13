/**
 * Validates that all package.json dependencies are accounted for
 * in the external lists or explicitly marked as intentionally bundled.
 *
 * Run as part of the build to catch missing externals early.
 */
import { readFileSync } from 'fs'
import { CLI_EXTERNALS, SDK_EXTERNALS, INTENTIONALLY_BUNDLED, OPTIONAL_RUNTIME_EXTERNALS } from './externals.js'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const allDeps = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
])

function validate(bundleName: string, externals: string[]): boolean {
  const externalSet = new Set(externals)
  const intentionallyBundledSet = new Set(INTENTIONALLY_BUNDLED)

  const missing = [...allDeps].filter(
    d => !externalSet.has(d) && !intentionallyBundledSet.has(d),
  )

  if (missing.length > 0) {
    console.error(`❌ ${bundleName}: Dependencies missing from externals:`)
    for (const dep of missing) {
      console.error(`   - ${dep}`)
    }
    console.error(
      `\n   Either add them to scripts/externals.ts or to INTENTIONALLY_BUNDLED.`,
    )
    return false
  }

  const optionalSet = new Set(OPTIONAL_RUNTIME_EXTERNALS)
  const extra = [...externalSet].filter(d => !allDeps.has(d) && !optionalSet.has(d))
  if (extra.length > 0) {
    console.warn(`⚠️  ${bundleName}: External entries not in package.json (may be ok):`)
    for (const dep of extra) {
      console.warn(`   - ${dep}`)
    }
  }

  console.log(`✓ ${bundleName}: All dependencies accounted for (${missing.length} missing, ${externalSet.size} external)`)
  return true
}

const cliOk = validate('CLI bundle', CLI_EXTERNALS)
const sdkOk = validate('SDK bundle', SDK_EXTERNALS)

if (!cliOk || !sdkOk) {
  console.error(`\n❌ External list validation failed. Fix scripts/externals.ts before committing.`)
  process.exit(1)
}

console.log('\n✓ All external lists valid.')

// ============================================================================
// Validate sdk.d.ts ↔ index.ts export drift
// ============================================================================

const SDK_DTS_PATH = 'src/entrypoints/sdk.d.ts'
const SDK_INDEX_PATH = 'src/entrypoints/sdk/index.ts'

function extractExportNames(filePath: string): Set<string> {
  const content = readFileSync(filePath, 'utf8')
  const names = new Set<string>()
  // Match: export { name1, name2 } / export type { name1 } / export class/function/interface/const/type Name
  for (const match of content.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const name of match[1].split(',')) {
      const trimmed = name.trim().split(/\s+as\s+/)[0].trim()
      if (trimmed) names.add(trimmed)
    }
  }
  for (const match of content.matchAll(
    /export\s+(?:type\s+)?(?:class|function|interface|const|type)\s+(\w+)/g,
  )) {
    names.add(match[1])
  }
  return names
}

const dtsExports = extractExportNames(SDK_DTS_PATH)
const indexExports = extractExportNames(SDK_INDEX_PATH)

const inDtsNotIndex = [...dtsExports].filter(n => !indexExports.has(n))
const inIndexNotDts = [...indexExports].filter(n => !dtsExports.has(n))

if (inDtsNotIndex.length > 0 || inIndexNotDts.length > 0) {
  console.error(`\n❌ SDK type declaration drift detected:`)
  if (inDtsNotIndex.length > 0) {
    console.error(`   In sdk.d.ts but not in index.ts:`)
    for (const name of inDtsNotIndex) console.error(`     - ${name}`)
  }
  if (inIndexNotDts.length > 0) {
    console.error(`   In index.ts but not in sdk.d.ts:`)
    for (const name of inIndexNotDts) console.error(`     - ${name}`)
  }
  console.error(`\n   Keep sdk.d.ts in sync with src/entrypoints/sdk/index.ts.`)
  process.exit(1)
}

console.log(`✓ SDK type declarations in sync (${dtsExports.size} exports match).`)
