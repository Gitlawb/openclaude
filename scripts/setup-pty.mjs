import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = dirname(require.resolve('node-pty/package.json'))
function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', timeout: 180_000 })
  if (result.error || result.status !== 0) throw new Error(result.error?.message || 'node-pty native setup failed')
}
// Run only native installation, not the dependency's unpublished development
// test/TypeScript toolchain. Linux needs compilation; macOS/Windows ship N-API builds.
if (!existsSync(join(root, 'prebuilds', `${process.platform}-${process.arch}`))) {
  run(require.resolve('node-gyp/bin/node-gyp.js'), ['rebuild'])
}
run(join(root, 'scripts/post-install.js'))
// node-pty 1.1.0 ships the macOS spawn helper without its executable bit.
if (process.platform !== 'win32') {
  for (const folder of ['build/Release', `prebuilds/${process.platform}-${process.arch}`]) {
    const helper = join(root, folder, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
require('node-pty')
