import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

// Build once before this script. Neither packing nor installing may rebuild it.
const output = resolve('.artifacts/package')
mkdirSync(output, { recursive: true })
function npm(args, cwd) {
  const windowsNpm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  const directWindowsNpm = process.platform === 'win32' && existsSync(windowsNpm)
  const command = directWindowsNpm ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const installing = args[0] === 'install'
  const evidence = resolve('.artifacts/pty/package-setup.json')
  const started = Date.now()
  if (installing) {
    mkdirSync(dirname(evidence), { recursive: true })
    writeFileSync(evidence, JSON.stringify({ status: 'installing', started, cwd }))
    console.log('Installing the tested package in an independent consumer directory...')
  }
  // Invoke npm directly on Windows so a timeout terminates npm itself, not
  // only its cmd.exe wrapper. Dependency extraction on hosted Windows disks
  // can exceed five minutes even with install scripts disabled.
  const result = spawnSync(command, directWindowsNpm ? [windowsNpm, ...args] : args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' && !directWindowsNpm, timeout: installing ? 600_000 : 300_000 })
  if (installing) writeFileSync(evidence, JSON.stringify({ status: result.status, error: result.error?.message, durationMs: Date.now() - started, stdout: result.stdout, stderr: result.stderr }, null, 2))
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout)
  return result.stdout
}
if (!process.argv.includes('--install-only') && !process.argv.includes('--verify-only')) {
  const [pack] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', output]))
  writeFileSync(join(output, 'sha256.txt'), `${createHash('sha256').update(readFileSync(join(output, pack.filename))).digest('hex')}  ${pack.filename}\n`)
  writeFileSync(join(output, 'package-info.json'), JSON.stringify({ tarball: pack.filename, files: pack.files.map(file => file.path) }, null, 2))
}
const info = JSON.parse(readFileSync(join(output, 'package-info.json'), 'utf8'))
if (!/^verboo-code-[\w.+-]+\.tgz$/.test(info.tarball)) throw new Error('Invalid package artifact name')
const tarball = join(output, info.tarball)
const checksum = createHash('sha256').update(readFileSync(tarball)).digest('hex')
if (readFileSync(join(output, 'sha256.txt'), 'utf8') !== `${checksum}  ${info.tarball}\n`) throw new Error('Tested package checksum mismatch')
if (!process.argv.includes('--pack-only') && !process.argv.includes('--verify-only')) {
  // Outside the repository so missing package dependencies cannot resolve from
  // the development node_modules via Node's ancestor-directory lookup.
  const consumer = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'verboo-cli-consumer-'))
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'verboo-consumer-fixture', private: true, type: 'module' }))
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--omit=dev', tarball], consumer)
  writeFileSync(join(output, 'consumer-path.txt'), `${consumer}\n`)
  console.log(`Installed ${info.tarball} in an independent consumer directory`)
}
console.log(`Verified SHA-256: ${checksum}`)
