import { existsSync, readFileSync } from 'node:fs'

const DIST = 'dist/cli.mjs'
const BANNED_PATTERNS = [
  'datadoghq.com',
  'api/event_logging/batch',
  'api/claude_code/metrics',
  'getKubernetesNamespace',
  '/var/run/secrets/kubernetes',
  '/proc/self/mountinfo',
  'tengu_internal_record_permission_context',
] as const

if (!existsSync(DIST)) {
  console.error(`ERROR: ${DIST} not found. Run 'bun run build' first.`)
  process.exit(1)
}

const contents = readFileSync(DIST, 'utf8')
let exitCode = 0

console.log(`Checking ${DIST} for banned patterns...`)
console.log('')

for (const pattern of BANNED_PATTERNS) {
  const count = contents.split(pattern).length - 1
  if (count > 0) {
    console.log(`  FAIL: '${pattern}' found (${count} occurrences)`)
    exitCode = 1
  } else {
    console.log(`  PASS: '${pattern}' not found`)
  }
}

console.log('')

if (exitCode === 0) {
  console.log('✓ All checks passed — no banned patterns in build output')
} else {
  console.log('✗ FAILED — banned patterns found in build output')
}

process.exit(exitCode)
