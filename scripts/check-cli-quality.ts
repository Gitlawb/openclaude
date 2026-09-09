import { readFileSync } from 'node:fs'

const pinnedBun = readFileSync('.bun-version', 'utf8').trim()
if (Bun.version !== pinnedBun) throw new Error(`Quality checks require Bun ${pinnedBun}; got ${Bun.version}`)
const node = process.env.CLI_TEST_NODE || 'node'
function run(command: string[]) {
  const result = Bun.spawnSync(command, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', env: process.env })
  if (result.exitCode !== 0) process.exit(result.exitCode || 1)
}
const terminalOnly = process.argv.includes('--terminal')
if (!terminalOnly) {
  run([process.execPath, 'scripts/build.ts'])
  run([node, 'node_modules/typescript/bin/tsc', '--project', 'tsconfig.agent-contracts.json'])
  run([process.execPath, 'scripts/run-tests-isolated.ts'])
  run([node, 'dist/cli.mjs', '--version'])
  run([node, 'dist/cli.mjs', '--internal-protocol-self-test'])
  run([node, 'scripts/prepare-cli-package.mjs', '--pack-only'])
}
if (!process.argv.includes('--suite')) {
  run([node, 'scripts/setup-pty.mjs'])
  run([node, 'scripts/prepare-cli-package.mjs', '--install-only'])
  run([node, '--test', '--test-concurrency=1', 'scripts/e2e/cli.e2e.mjs'])
}
