import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

// Build once before this script. Neither packing nor installing may rebuild it.
const output = resolve('.artifacts/package')
mkdirSync(output, { recursive: true })
function npm(args, cwd) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', timeout: 300_000 })
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
  const consumer = mkdtempSync(join(tmpdir(), 'verboo-cli-consumer-'))
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'verboo-consumer-fixture', private: true, type: 'module' }))
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--omit=dev', tarball], consumer)
  writeFileSync(join(output, 'consumer-path.txt'), `${consumer}\n`)
  console.log(`Installed ${info.tarball} in an independent consumer directory`)
}
console.log(`Verified SHA-256: ${checksum}`)
