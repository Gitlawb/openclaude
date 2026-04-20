/**
 * Validates that all package.json dependencies are accounted for
 * in the external lists or explicitly marked as intentionally bundled.
 *
 * Run as part of the build to catch missing externals early.
 */
import { readFileSync } from 'fs'
import { CLI_EXTERNALS, SDK_EXTERNALS, INTENTIONALLY_BUNDLED } from './externals.js'

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

  const extra = [...externalSet].filter(d => !allDeps.has(d))
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
