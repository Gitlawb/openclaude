import type { Command, LocalCommandCall } from '../../types/command.js'

function parseArgs(args: string): { json: boolean; fix: boolean } {
  const tokens = args.split(/\s+/).filter(Boolean)
  return {
    json: tokens.includes('--json'),
    fix: tokens.includes('--fix'),
  }
}

const call: LocalCommandCall = async (args) => {
  const { resolveVaultConfig } = await import('../../vault/config.js')
  const { lintVault } = await import('../../vault/lint.js')
  const { getOriginalCwd } = await import('../../bootstrap/state.js')

  const { json, fix } = parseArgs(args ?? '')
  const cfg = resolveVaultConfig(getOriginalCwd())
  const result = await lintVault(cfg, {
    fix,
    format: json ? 'json' : 'text',
  })

  process.exitCode = result.exitCode

  if (json) {
    return { type: 'text', value: JSON.stringify(result, null, 2) }
  }

  const lines: string[] = []
  for (const issue of result.issues) {
    lines.push(`${issue.kind}\t${issue.file}\t${issue.detail}`)
  }
  lines.push(
    `Found ${result.issues.length} issues (${result.fixed.length} autofixed).`,
  )
  return { type: 'text', value: lines.join('\n') }
}

const vaultLint = {
  type: 'local',
  name: 'vault-lint',
  description: 'Lint the vault for structural and convention issues',
  argumentHint: '[--json] [--fix]',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default vaultLint
