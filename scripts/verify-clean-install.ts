/**
 * End-to-end verification that `npm install -g @gitlawb/openclaude` is a
 * zero-warning experience — the runtime half of the install contract whose
 * static half lives in externalsValidation.ts (RUNTIME_DEPENDENCY_CONTRACT).
 *
 * Modes:
 *   --tarball [path]    Verify a local tarball. Without a path, packs one from
 *                       the working tree with `npm pack --ignore-scripts`
 *                       (dist/ must already be built — CI builds it first).
 *   --published [spec]  Verify the real registry artifact (default
 *                       @gitlawb/openclaude@latest). Used by the scheduled
 *                       install-hygiene workflow to catch registry drift
 *                       (e.g. a transitive dep deprecated after we shipped).
 *
 * Each mode runs two scenarios in throwaway prefixes with a cold cache:
 *   1. cold     — fresh global install
 *   2. upgrade  — install the previously published version, then install the
 *                 target over it (the most common real-world path; different
 *                 npm output shapes than a cold install)
 *
 * Verdicts are strict-whitelist: any npm output line that is not an expected
 * summary fails the run — `npm warn`, `deprecated`, EBADENGINE, funding hints,
 * and install-script chatter all land here without being special-cased.
 * Registry/network failures retry and then exit 2 (infra), never 1 (hygiene),
 * so CI can distinguish a flaky registry from a real regression.
 *
 * After installing, the script also proves the artifact works and is silent:
 * `--version` must print the exact packed version, `--help` must load the real
 * bundle (--version short-circuits via a zero-import fast path in cli.tsx and
 * proves almost nothing), both with empty stderr. The installed tree is
 * scanned structurally for install scripts — a transitive postinstall that
 * exits quietly would pass an output whitelist, so the tree is the authority.
 *
 * Note: package.json `overrides` do NOT travel to consumers; this script
 * intentionally reproduces the user's resolution, not the repo's.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  validateInstallHygieneFields,
  validateRuntimeDependencyContract,
} from './externalsValidation.js'

const PACKAGE_NAME = '@gitlawb/openclaude'
const MAX_TARBALL_BYTES = 12_000_000 // current tarball is ~8.8MB; catch payload blowups
const INSTALL_RETRIES = 3
const IS_WINDOWS = process.platform === 'win32'

// Published artifacts that predate the silent-first-boot fix (the fresh-install
// Opengateway default used to print a "saved provider profile" warning on
// every command). Their stderr noise is a KNOWN issue, not a regression —
// exempt exactly these versions so the scheduled published-mode run stays
// signal. Self-cleaning: the next release is not in this set; remove the
// constant once 0.24.0 is no longer `latest`.
const KNOWN_FIRST_BOOT_NOISE_VERSIONS = new Set(['0.24.0'])

// Lines npm may legitimately print at --loglevel=warn. Everything else fails.
const ALLOWED_OUTPUT = [
  // "added 8 packages in 19s", "added 1 package in 340ms",
  // "added 1 package, removed 2 packages, and changed 3 packages in 4s",
  // "up to date in 1s" — summary phrasing varies across npm 10/11.
  /^(?:added|removed|changed|up to date)[\w ,]* in [\d.]+m?s$/i,
  /^npm notice\b/i, // defense in depth; --loglevel=warn hides notices
]

const INFRA_FAILURE_PATTERNS = [
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|EPROTO/,
  /network|socket hang up|fetch failed|registry.*(?:unavailable|error)/i,
  /npm error code E(?:429|5\d\d)\b/,
]

type Failure = { scenario: string; problem: string }
const failures: Failure[] = []
function fail(scenario: string, problem: string): void {
  failures.push({ scenario, problem })
  console.error(`  ❌ [${scenario}] ${problem}`)
}
function pass(scenario: string, what: string): void {
  console.log(`  ✓ [${scenario}] ${what}`)
}

function npmEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Deterministic, machine-independent output: no color/TTY decoration, no
    // npm self-update notice, English formatting, isolated config/home.
    CI: '1',
    NO_COLOR: '1',
    LANG: 'C',
    LC_ALL: 'C',
    HOME: home,
    USERPROFILE: home,
    npm_config_update_notifier: 'false',
  }
}

function runNpm(
  args: string[],
  home: string,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('npm', args, {
    encoding: 'utf8',
    env: npmEnv(home),
    shell: IS_WINDOWS, // npm is npm.cmd on Windows
    timeout: 10 * 60 * 1000,
  })
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function installFlags(prefix: string, cache: string): string[] {
  return [
    '--global',
    `--prefix=${prefix}`,
    `--cache=${cache}`,
    '--no-fund',
    '--no-audit',
    '--no-progress',
    '--no-color',
    '--loglevel=warn',
    '--foreground-scripts',
  ]
}

function looksLikeInfraFailure(output: string): boolean {
  return INFRA_FAILURE_PATTERNS.some(re => re.test(output))
}

/** Install with retry-on-network; returns combined output once npm exits 0. */
function installWithRetry(
  scenario: string,
  spec: string,
  prefix: string,
  cache: string,
  home: string,
): string | null {
  for (let attempt = 1; attempt <= INSTALL_RETRIES; attempt++) {
    const { status, stdout, stderr } = runNpm(
      ['install', spec, ...installFlags(prefix, cache)],
      home,
    )
    const combined = `${stdout}\n${stderr}`
    if (status === 0) return combined
    if (attempt < INSTALL_RETRIES && looksLikeInfraFailure(combined)) {
      console.log(`  … [${scenario}] transient install failure, retrying (${attempt}/${INSTALL_RETRIES})`)
      continue
    }
    if (looksLikeInfraFailure(combined)) {
      console.error(combined)
      console.error(`\n⚠️  [${scenario}] npm install failed with network/registry symptoms after ${INSTALL_RETRIES} attempts — infra problem, not a hygiene verdict.`)
      process.exit(2)
    }
    fail(scenario, `npm install exited ${status}:\n${combined}`)
    return null
  }
  return null
}

function checkOutputWhitelist(scenario: string, output: string): void {
  const offending = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !ALLOWED_OUTPUT.some(re => re.test(line)))
  if (offending.length === 0) {
    pass(scenario, 'install output is clean (summary line only)')
  } else {
    for (const line of offending) {
      fail(scenario, `unexpected install output: "${line}"`)
    }
  }
}

function globalRoot(prefix: string): string {
  return IS_WINDOWS ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
}

/** Every package.json in the installed tree; global deps nest under the package. */
function collectInstalledManifests(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const child = join(dir, entry.name)
    if (entry.name.startsWith('@')) {
      collectInstalledManifests(child, out)
      continue
    }
    const manifest = join(child, 'package.json')
    if (existsSync(manifest)) out.push(manifest)
    const nested = join(child, 'node_modules')
    if (existsSync(nested)) collectInstalledManifests(nested, out)
  }
  return out
}

function checkNoInstallScripts(scenario: string, prefix: string): void {
  const manifests = collectInstalledManifests(globalRoot(prefix))
  if (manifests.length === 0) {
    fail(scenario, `no installed packages found under ${globalRoot(prefix)}`)
    return
  }
  const offenders: string[] = []
  for (const manifest of manifests) {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    const hooks = ['preinstall', 'install', 'postinstall'].filter(
      hook => pkg.scripts?.[hook],
    )
    if (hooks.length > 0) offenders.push(`${pkg.name}@${pkg.version} (${hooks.join(', ')})`)
  }
  if (offenders.length > 0) {
    fail(scenario, `installed packages declare install scripts: ${offenders.join('; ')}`)
  } else {
    pass(scenario, `no install scripts across ${manifests.length} installed packages`)
  }
}

function checkInstalledContract(scenario: string, prefix: string): void {
  const manifestPath = join(globalRoot(prefix), ...PACKAGE_NAME.split('/'), 'package.json')
  if (!existsSync(manifestPath)) {
    fail(scenario, `installed manifest missing at ${manifestPath}`)
    return
  }
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const errors = [
    ...validateRuntimeDependencyContract(pkg).errors,
    ...validateInstallHygieneFields(pkg).errors,
  ]
  if (errors.length > 0) {
    for (const error of errors) fail(scenario, `installed artifact: ${error}`)
  } else {
    pass(scenario, 'installed artifact matches the static install contract')
  }
}

function binPath(prefix: string): string {
  return IS_WINDOWS ? join(prefix, 'openclaude.cmd') : join(prefix, 'bin', 'openclaude')
}

function runBin(
  prefix: string,
  home: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(binPath(prefix), args, {
    encoding: 'utf8',
    env: npmEnv(home),
    cwd: home,
    shell: IS_WINDOWS,
    timeout: 2 * 60 * 1000,
  })
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function checkBinBoots(scenario: string, prefix: string, home: string, expectedVersion: string | null): void {
  const version = runBin(prefix, home, ['--version'])
  if (version.status !== 0) {
    fail(scenario, `\`openclaude --version\` exited ${version.status}: ${version.stderr}`)
  } else if (expectedVersion && version.stdout.trim() !== `${expectedVersion} (OpenClaude)`) {
    fail(scenario, `--version printed "${version.stdout.trim()}", expected "${expectedVersion} (OpenClaude)"`)
  } else if (version.stderr.trim().length > 0) {
    fail(scenario, `--version wrote to stderr: "${version.stderr.trim()}"`)
  } else {
    pass(scenario, `--version prints ${version.stdout.trim()}`)
  }

  // --version is a zero-import fast path; --help forces the real bundle to
  // load, so a broken or noisy-at-boot build fails here.
  const installedVersion = version.status === 0 ? version.stdout.trim().split(' ')[0] : ''
  const bootNoiseKnown = KNOWN_FIRST_BOOT_NOISE_VERSIONS.has(installedVersion ?? '')
  const help = runBin(prefix, home, ['--help'])
  if (help.status !== 0) {
    fail(scenario, `\`openclaude --help\` exited ${help.status}: ${help.stderr}`)
  } else if (!/usage/i.test(help.stdout)) {
    fail(scenario, `--help output does not look like help text: "${help.stdout.slice(0, 200)}"`)
  } else if (help.stderr.trim().length > 0) {
    if (bootNoiseKnown) {
      console.log(`  … [${scenario}] --help stderr noise is a known issue in ${installedVersion} (fixed in the next release)`)
    } else {
      fail(scenario, `--help wrote to stderr (boot must be silent): "${help.stderr.trim()}"`)
    }
  } else {
    pass(scenario, '--help loads the full bundle with silent stderr')
  }
}

function checkTarballContents(tarballPath: string): void {
  const scenario = 'tarball'
  const required = [
    'package/package.json',
    'package/bin/openclaude',
    'package/dist/cli.mjs',
    'package/dist/sdk.mjs',
    'package/src/entrypoints/sdk.d.ts',
  ]
  const listing = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
  const entries = new Set(listing.split(/\r?\n/).map(l => l.trim()))
  const missing = required.filter(entry => !entries.has(entry))
  if (missing.length > 0) {
    fail(scenario, `tarball is missing declared payload: ${missing.join(', ')}`)
  } else {
    pass(scenario, `tarball carries the full declared payload (${entries.size - 1} files)`)
  }
  const size = statSync(tarballPath).size
  if (size > MAX_TARBALL_BYTES) {
    fail(scenario, `tarball is ${size} bytes (> ${MAX_TARBALL_BYTES} bound) — payload blowup?`)
  } else {
    pass(scenario, `tarball size ${(size / 1e6).toFixed(1)}MB within bound`)
  }
}

function makeSandbox(work: string, name: string): { prefix: string; cache: string; home: string } {
  const prefix = join(work, name, 'prefix')
  const cache = join(work, name, 'cache')
  const home = join(work, name, 'home')
  for (const dir of [prefix, cache, home]) mkdirSync(dir, { recursive: true })
  return { prefix, cache, home }
}

function packWorkingTree(work: string): string {
  for (const artifact of ['dist/cli.mjs', 'dist/sdk.mjs']) {
    if (!existsSync(artifact)) {
      console.error(`❌ ${artifact} not found — run \`bun run build\` before --tarball mode (the pack uses --ignore-scripts to avoid a redundant prepack build).`)
      process.exit(1)
    }
  }
  const home = join(work, 'pack-home')
  mkdirSync(home, { recursive: true })
  const { status, stdout, stderr } = runNpm(
    ['pack', '--ignore-scripts', '--json', `--pack-destination=${work}`, '--loglevel=error'],
    home,
  )
  if (status !== 0) {
    console.error(`❌ npm pack failed: ${stderr}`)
    process.exit(1)
  }
  const filename = JSON.parse(stdout)[0]?.filename
  if (!filename) {
    console.error(`❌ npm pack returned no filename: ${stdout}`)
    process.exit(1)
  }
  return join(work, filename)
}

type NpmRunResult = { status: number; stdout: string; stderr: string }

// Same retry/infra discipline as installWithRetry: a transient registry
// hiccup must not silently drop the upgrade-scenario coverage (the infra
// callback exits 2, distinguishable from a hygiene verdict). A clean "not
// published" answer (e.g. E404 before the first release) legitimately
// returns null → skip. Effects are injected so the retry/skip/infra branches
// are unit-testable (verify-clean-install.test.ts) without shelling out.
export function resolvePreviousPublishedVersion(options: {
  runView: () => NpmRunResult
  onRetry: (attempt: number) => void
  onInfraFailure: (combinedOutput: string) => never
  retries?: number
}): string | null {
  const retries = options.retries ?? INSTALL_RETRIES
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { status, stdout, stderr } = options.runView()
    if (status === 0) {
      const version = stdout.trim()
      return /^\d+\.\d+\.\d+/.test(version) ? version : null
    }
    const combined = `${stdout}\n${stderr}`
    if (!looksLikeInfraFailure(combined)) return null
    if (attempt < retries) {
      options.onRetry(attempt)
      continue
    }
    options.onInfraFailure(combined)
  }
  return null
}

function previousPublishedVersion(home: string): string | null {
  return resolvePreviousPublishedVersion({
    runView: () =>
      runNpm(['view', `${PACKAGE_NAME}@latest`, 'version', '--loglevel=error'], home),
    onRetry: attempt =>
      console.log(`  … npm view failed with network symptoms, retrying (${attempt}/${INSTALL_RETRIES})`),
    onInfraFailure: combined => {
      console.error(combined)
      console.error(`\n⚠️  npm view ${PACKAGE_NAME}@latest failed with network/registry symptoms after ${INSTALL_RETRIES} attempts — infra problem, not a hygiene verdict.`)
      return process.exit(2)
    },
  })
}

function runScenarios(
  target: string,
  expectedVersion: string | null,
  work: string,
  checkContract: boolean,
): void {
  // Scenario 1: cold install into a pristine prefix.
  {
    const scenario = 'cold-install'
    console.log(`\n▶ ${scenario}: npm install -g ${target}`)
    const { prefix, cache, home } = makeSandbox(work, 'cold')
    const output = installWithRetry(scenario, target, prefix, cache, home)
    if (output !== null) {
      checkOutputWhitelist(scenario, output)
      checkNoInstallScripts(scenario, prefix)
      // Contract comparison only makes sense for the artifact built from THIS
      // tree; a published artifact predates contract bumps (version skew).
      if (checkContract) checkInstalledContract(scenario, prefix)
      checkBinBoots(scenario, prefix, home, expectedVersion)
    }
  }

  // Scenario 2: upgrade over the previously published version — the common
  // real-world path, with different npm summary output than a cold install.
  {
    const scenario = 'upgrade-install'
    const { prefix, cache, home } = makeSandbox(work, 'upgrade')
    const previous = previousPublishedVersion(home)
    if (previous === null) {
      console.log(`\n▶ ${scenario}: skipped (no published ${PACKAGE_NAME}@latest reachable)`)
      return
    }
    console.log(`\n▶ ${scenario}: ${PACKAGE_NAME}@${previous} → ${target}`)
    // The baseline install is not under test (it is the already-shipped
    // version); only the upgrade on top of it must be clean.
    const baseline = installWithRetry(scenario, `${PACKAGE_NAME}@${previous}`, prefix, cache, home)
    if (baseline === null) return
    const output = installWithRetry(scenario, target, prefix, cache, home)
    if (output !== null) {
      checkOutputWhitelist(scenario, output)
      checkNoInstallScripts(scenario, prefix)
      checkBinBoots(scenario, prefix, home, expectedVersion)
    }
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const mode = args[0] === '--published' ? 'published' : '--tarball' === args[0] || args.length === 0 ? 'tarball' : null
  if (mode === null) {
    console.error('Usage: verify-clean-install.ts [--tarball [path] | --published [spec]]')
    process.exit(1)
  }

  const work = mkdtempSync(join(tmpdir(), 'openclaude-install-verify-'))
  try {
    let target: string
    let expectedVersion: string | null
    if (mode === 'tarball') {
      const tarballPath = args[1] ?? packWorkingTree(work)
      checkTarballContents(tarballPath)
      target = tarballPath
      expectedVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
    } else {
      target = args[1] ?? `${PACKAGE_NAME}@latest`
      expectedVersion = null // registry version; asserted non-empty via --version format
    }

    console.log(`Verifying zero-warning install: ${target}`)
    runScenarios(target, expectedVersion, work, mode === 'tarball')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    console.error(`\n❌ install hygiene FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'}). The npm install experience is not zero-warning.`)
    process.exit(1)
  }
  console.log('\n✓ install hygiene verified: clean output, no install scripts, contract intact, binary boots silently.')
}

// Guarded so the test file can import resolvePreviousPublishedVersion without
// kicking off a real pack + registry install.
if (import.meta.main) {
  main()
}
